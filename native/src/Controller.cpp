#include "Controller.h"
#include "LyricsLayout.h"
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QSaveFile>
#include <QStandardPaths>
#include <QUrlQuery>
#include <algorithm>

Controller::Controller(QObject *parent) : QObject(parent) {
    base_ = QUrl(qEnvironmentVariable("PITV_API_URL", "http://127.0.0.1:3000"));
    cachePath_ = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation) + "/library.json";
    reconnect_.setSingleShot(true);
    connect(&reconnect_, &QTimer::timeout, this, &Controller::connectEvents);
    heartbeat_.setInterval(5000);
    connect(&heartbeat_, &QTimer::timeout, this, &Controller::publishStatus);
    poll_.setInterval(2500);
    connect(&poll_, &QTimer::timeout, this, [this] {
        pollAsset(true); pollAsset(false);
        if (view_.page == "playlist") {
            auto status = playlists_.value(view_.playlist).toObject().value("status").toString();
            if (status != "ready" && status != "error") fetchPlaylist();
        }
    });
    refresh_.setInterval(60000);
    connect(&refresh_, &QTimer::timeout, this, &Controller::fetchLibrary);
    watchdog_.setInterval(45000); watchdog_.setSingleShot(true);
    connect(&watchdog_, &QTimer::timeout, this, [this] { if (stream_) stream_->abort(); });
    // Cache commits fsync, which can stall for seconds while downloads flush to
    // the SD card, so they never run on the UI thread.
    cacheWriter_ = new QObject;
    cacheWriter_->moveToThread(&cacheThread_);
    connect(&cacheThread_, &QThread::finished, cacheWriter_, &QObject::deleteLater);
    cacheThread_.start();
}
Controller::~Controller() {
    QMetaObject::invokeMethod(cacheWriter_, [] {}, Qt::BlockingQueuedConnection); // finish queued writes
    cacheThread_.quit();
    cacheThread_.wait();
}
QString Controller::remoteUrl() const {
    return library_.value("info").toObject().value("remoteUrl").toString("http://pitv.local/remote");
}
QString Controller::absoluteUrl(const QString &path) const { return path.isEmpty() ? QString() : base_.resolved(QUrl(path)).toString(); }
QVariantMap Controller::lyrics(const QString &body, double width, double height) const { return fitLyrics(body, width, height); }
QString Controller::clockText(double seconds) const {
    int n = std::max(0, int(seconds));
    return n >= 3600 ? QString("%1:%2:%3").arg(n / 3600).arg(n / 60 % 60, 2, 10, QChar('0')).arg(n % 60, 2, 10, QChar('0'))
                     : QString("%1:%2").arg(n / 60).arg(n % 60, 2, 10, QChar('0'));
}
void Controller::start(const QString &fixture) {
    fixture_ = !fixture.isEmpty();
    QFile file(fixture_ ? fixture : cachePath_);
    if (file.open(QIODevice::ReadOnly)) {
        auto object = QJsonDocument::fromJson(file.readAll()).object();
        cachedAssets_ = object.take("_assets").toObject(); playlists_ = object.take("_playlists").toObject();
        applyLibrary(object);
    } else rebuild();
    if (fixture_) return;
    fetchLibrary(); connectEvents(); heartbeat_.start(); poll_.start(); refresh_.start();
}
void Controller::request(const QString &path, const QJsonObject *body, Response done) {
    QNetworkRequest req(base_.resolved(QUrl(path)));
    req.setTransferTimeout(12000);
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    req.setRawHeader("Accept", "application/json");
    QNetworkReply *reply;
    if (body) {
        req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        reply = network_.post(req, QJsonDocument(*body).toJson(QJsonDocument::Compact));
    } else reply = network_.get(req);
    connect(reply, &QNetworkReply::finished, this, [reply, done = std::move(done)] {
        QJsonParseError parse;
        auto document = QJsonDocument::fromJson(reply->readAll(), &parse);
        auto object = document.object();
        QString error;
        if (reply->error() != QNetworkReply::NoError)
            error = object.value("error").toString("Cannot reach the library service. It will reconnect automatically.");
        else if (parse.error != QJsonParseError::NoError || !document.isObject()) error = "The library returned an invalid response.";
        done(object, error); reply->deleteLater();
    });
}
void Controller::fetchLibrary() {
    if (fixture_) return;
    if (snapshotPending_) { snapshotAgain_ = true; return; }
    snapshotPending_ = true;
    request("/api/library", nullptr, [this](const QJsonObject &object, const QString &error) {
        snapshotPending_ = false;
        if (error.isEmpty() && object.value("config").isObject() && object.value("items").isObject()) {
            applyLibrary(object); saveCache();
        }
        if (snapshotAgain_) { snapshotAgain_ = false; fetchLibrary(); }
    });
}
void Controller::applyLibrary(const QJsonObject &object) {
    library_ = object;
    volume_ = std::clamp(object.value("volume").toDouble(.05), 0., 1.);
    emit changeVolume(volume_); emit libraryChanged(); emit playbackChanged();
    rebuild(); syncBackground();
}
void Controller::saveCache() {
    if (fixture_) return;
    auto object = library_; object.insert("_assets", cachedAssets_); object.insert("_playlists", playlists_);
    const auto bytes = QJsonDocument(object).toJson(QJsonDocument::Compact);
    if (bytes == cacheSaved_) return; // the periodic refresh usually changes nothing
    cacheSaved_ = bytes;
    const int generation = ++cacheGeneration_;
    QMetaObject::invokeMethod(cacheWriter_, [this, generation, path = cachePath_, bytes] {
        if (generation != cacheGeneration_) return; // superseded by a newer snapshot
        QDir().mkpath(QFileInfo(path).absolutePath());
        QSaveFile file(path);
        if (file.open(QIODevice::WriteOnly)) { file.write(bytes); file.commit(); }
    }, Qt::QueuedConnection);
}
void Controller::connectEvents() {
    if (fixture_ || stream_) return;
    parser_.reset();
    QNetworkRequest req(base_.resolved(QUrl("/api/device/events")));
    req.setRawHeader("Accept", "text/event-stream"); req.setRawHeader("Cache-Control", "no-cache");
    auto *reply = network_.get(req); stream_ = reply; watchdog_.start();
    connect(reply, &QNetworkReply::readyRead, this, [this, reply] {
        if (reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() != 200) { reply->abort(); return; }
        if (!connected_) { connected_ = true; retryDelay_ = 1000; emit connectionChanged(); fetchLibrary(); }
        watchdog_.start();
        for (const auto &bytes : parser_.feed(reply->readAll())) {
            auto doc = QJsonDocument::fromJson(bytes);
            if (doc.isObject()) event(doc.object());
        }
    });
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        stream_ = nullptr; watchdog_.stop(); parser_.reset(); reply->deleteLater();
        if (connected_) { connected_ = false; emit connectionChanged(); }
        reconnect_.start(retryDelay_); retryDelay_ = std::min(30000, retryDelay_ * 2);
    });
}
void Controller::event(const QJsonObject &object) {
    const auto type = object.value("type").toString();
    if (type == "library") fetchLibrary();
    else if (type == "remote") action(object.value("action").toString(), view_.page == "home" ? 2 : 1);
    else if (type == "volume") {
        volume_ = std::clamp(object.value("level").toDouble(.05), 0., 1.);
        emit changeVolume(volume_); emit playbackChanged();
    } else if (type == "background") {
        library_.insert("background", QJsonObject{{"tracks", object.value("tracks")}, {"state", object.value("state")}});
        syncBackground(); if (page() == "background") rebuild(); saveCache();
    } else if (type == "media") {
        const auto value = object.value("asset").toObject();
        for (bool video : {true, false}) {
            auto &prep = video ? foreground_ : background_;
            if (!prep.source.isEmpty() && value.value("key") == prep.asset.value("key")) asset(video, value);
        }
    }
}
void Controller::navigate(View view, bool remember) {
    if (remember) history_.append(view_);
    if (view_.page == "player" && view.page != "player") {
        ++foreground_.generation; foreground_.source.clear(); foreground_.loaded.clear(); foreground_.pending = false;
        foreground_.error.clear(); foreground_.asset = {};
        emit stopMedia(true); playing_ = false; position_ = duration_ = 0;
        emit playbackChanged();
    }
    view_ = std::move(view); notice_.clear(); rebuild(); emit resetScroll(); syncBackground(); publishStatus();
}
void Controller::home() { history_.clear(); navigate(View{}, false); }
void Controller::back() {
    if (history_.isEmpty()) { home(); return; }
    navigate(history_.takeLast(), false);
}
void Controller::rebuild() {
    entries_.clear(); current_ = view_.item;
    const auto config = library_.value("config").toObject();
    const auto all = library_.value("items").toObject().value(view_.section).toArray();
    if (view_.page == "home") {
        view_.heading = config.value("title").toString("PiTV");
        for (auto value : config.value("sections").toArray()) entries_ << value.toObject().toVariantMap();
        entries_ << QVariantMap{{"name", "Background music"}, {"type", "background"}, {"action", "background"}};
        entries_ << QVariantMap{{"name", "Connect your phone"}, {"type", "connect"}, {"action", "connect"}};
    } else if (view_.page == "background") {
        entries_ = library_.value("background").toObject().value("tracks").toArray().toVariantList();
    } else if (view_.page == "playlist") {
        const auto list = playlists_.value(view_.playlist).toObject();
        for (const auto &value : list.value("videos").toArray()) {
            auto row = value.toObject().toVariantMap(); row.insert("youtube_url", "https://www.youtube.com/watch?v=" + row.value("id").toString());
            entries_ << row;
        }
        auto status = list.value("status").toString();
        notice_ = status == "error" ? list.value("error").toString("Playlist unavailable. Press Select to retry.")
                  : (status != "ready" ? "Preparing playlist…" : QString());
    } else if (view_.page == "section" && view_.type == "media") {
        QStringList categories;
        for (const auto &value : all) {
            auto category = value.toObject().value("category").toString();
            if (category.isEmpty()) category = "General";
            if (!categories.contains(category)) categories << category;
        }
        categories.sort(Qt::CaseInsensitive);
        for (const auto &category : categories) {
            int count = 0;
            for (const auto &value : all) if (value.toObject().value("category").toString("General") == category || (category == "General" && value.toObject().value("category").toString().isEmpty())) ++count;
            entries_ << QVariantMap{{"title", category}, {"category", category}, {"count", count}};
        }
    } else if (view_.page == "section" || view_.page == "category") {
        for (const auto &value : all) {
            auto row = value.toObject();
            auto category = row.value("category").toString(); if (category.isEmpty()) category = "General";
            if (view_.page != "category" || category == view_.category) entries_ << row.toVariantMap();
        }
    }
    view_.selected = std::clamp(view_.selected, 0, std::max(0, int(entries_.size()) - 1));
    if (view_.type == "faq" && view_.page == "section" && !entries_.isEmpty()) current_ = entries_[view_.selected].toMap();
    emit viewChanged(); emit selectionChanged();
}
void Controller::selectIndex(int index) {
    const int previous = view_.selected;
    view_.selected = std::clamp(index, 0, std::max(0, int(entries_.size()) - 1));
    if (view_.type == "faq" && !entries_.isEmpty()) {
        current_ = entries_[view_.selected].toMap(); emit viewChanged();
        if (previous != view_.selected) emit resetScroll();
    }
    emit selectionChanged();
}
void Controller::openIndex(int index) {
    if (index < 0 || index >= entries_.size()) return;
    selectIndex(index);
    auto item = entries_[index].toMap();
    if (view_.page == "home") {
        if (item.value("action") == "background") { openBackground(); return; }
        if (item.value("action") == "connect") { View next; next.page = "connect"; next.heading = "Your phone is the remote"; navigate(next); return; }
        View next; next.page = "section"; next.heading = item.value("name").toString(); next.type = item.value("type").toString(); next.section = item.value("id").toString(); navigate(next);
    } else if (view_.page == "section" && view_.type == "media") {
        View next = view_; next.page = "category"; next.heading = next.category = item.value("category").toString(); next.selected = 0; navigate(next);
    } else if (view_.page == "background") {
        int track = item.value("id").toInt();
        if (track == backgroundTrack_ && !background_.error.isEmpty()) toggleBackground();
        else sendBackground(track, track == backgroundTrack_ ? !backgroundDesired_ : true);
    } else if (view_.type != "faq") openItem(item);
}
void Controller::openItem(const QVariantMap &item) {
    View next = view_; next.item = item; next.heading = item.value("title").toString();
    if (view_.type == "media" || view_.page == "playlist") {
        const auto url = item.value("youtube_url").toString();
        const auto list = QUrlQuery(QUrl(url)).queryItemValue("list");
        if (!list.isEmpty()) { next.page = "playlist"; next.playlist = list; next.selected = 0; navigate(next); fetchPlaylist(); }
        else { next.page = "player"; navigate(next); prepare(true, url); }
    } else {
        next.page = view_.type == "lyrics" ? "lyrics" : view_.type == "catalog" ? "book" : "reader";
        navigate(next);
    }
}
void Controller::action(const QString &key, int columns) {
    if (key == "home") { home(); return; }
    if (key == "back") { back(); return; }
    if (view_.page == "player") {
        if (key == "select") { if (!foreground_.error.isEmpty()) retry(); else emit toggleVideo(); }
        else if (key == "left" || key == "right") emit seekVideo(key == "left" ? -10 : 10);
        else if (key == "up" || key == "down") setVolume(volume_ + (key == "up" ? .05 : -.05));
        return;
    }
    if (view_.page == "lyrics" && (key == "left" || key == "right")) {
        const auto siblings = library_.value("items").toObject().value(view_.section).toArray();
        int at = 0;
        for (int i = 0; i < siblings.size(); ++i) if (siblings[i].toObject().value("id").toVariant() == view_.item.value("id")) at = i;
        if (!siblings.isEmpty()) {
            at = (at + (key == "left" ? -1 : 1) + siblings.size()) % siblings.size();
            view_.item = siblings[at].toObject().toVariantMap(); view_.heading = view_.item.value("title").toString(); rebuild(); emit resetScroll();
        }
        return;
    }
    if (view_.page == "reader" || view_.page == "lyrics" || view_.page == "book") {
        if (key == "up" || key == "down") emit scrollRequested(key == "up" ? -1 : 1);
        return;
    }
    if (key == "select") {
        if (entries_.isEmpty() && view_.page == "playlist") retry(); else openIndex(view_.selected);
    } else if (view_.type == "faq" && (key == "left" || key == "right")) {
        emit scrollRequested(key == "left" ? -1 : 1);
    } else if (!entries_.isEmpty()) {
        int delta = key == "left" ? -1 : key == "right" ? 1 : key == "up" ? -std::max(1, columns) : key == "down" ? std::max(1, columns) : 0;
        selectIndex(view_.selected + delta);
    }
}
void Controller::fetchPlaylist(bool retry) {
    if (fixture_ || view_.page != "playlist" || playlistPending_) return;
    playlistPending_ = true; const auto id = view_.playlist;
    request("/api/playlist?list=" + QString::fromLatin1(QUrl::toPercentEncoding(id)) + (retry ? "&retry=1" : ""), nullptr,
        [this, id](const QJsonObject &object, const QString &error) {
            playlistPending_ = false;
            if (error.isEmpty()) { playlists_.insert(id, object); saveCache(); }
            if (view_.page == "playlist" && view_.playlist == id) {
                rebuild(); if (!error.isEmpty()) { notice_ = error + " Press Select to retry."; emit viewChanged(); }
            }
        });
}
void Controller::prepare(bool video, const QString &url, bool retry) {
    auto &prep = video ? foreground_ : background_;
    ++prep.generation; prep.source = url; prep.loaded.clear(); prep.error.clear(); prep.pending = true;
    prep.asset = QJsonObject{{"status", "queued"}, {"progress", 0}};
    const auto cached = cachedAssets_.value((video ? "video:" : "audio:") + url).toObject();
    if (!retry && cached.value("status") == "ready") asset(video, cached);
    if (video) emit playbackChanged(); else emit backgroundChanged();
    if (fixture_) { prep.pending = false; return; }
    const int generation = prep.generation;
    const QJsonObject body{{"url", url}, {"kind", video ? "video" : "audio"}, {"retry", retry}};
    request("/api/media/prepare", &body, [this, video, generation](const QJsonObject &object, const QString &error) {
        auto &current = video ? foreground_ : background_;
        if (generation != current.generation) return;
        current.pending = false;
        if (error.isEmpty()) asset(video, object);
        else if (current.loaded.isEmpty()) { current.error = error + " Press Select to retry."; if (video) emit playbackChanged(); else emit backgroundChanged(); }
    });
}
void Controller::asset(bool video, const QJsonObject &object) {
    auto &prep = video ? foreground_ : background_;
    prep.asset = object;
    const auto status = object.value("status").toString();
    prep.error = status == "error" ? object.value("error").toString("Media could not be prepared. Try again.") : QString();
    if (status == "ready") {
        const auto uri = absoluteUrl(object.value("playbackUrl").toString());
        // A completed file is local to the appliance. WAN failures never interrupt it.
        if (!uri.isEmpty() && uri != prep.loaded) {
            prep.loaded = uri;
            if (video || (backgroundDesired_ && view_.page != "player")) emit loadMedia(uri, video);
            else prep.loaded.clear();
        }
        cachedAssets_.insert((video ? "video:" : "audio:") + prep.source, object); saveCache();
    }
    if (video) emit playbackChanged(); else emit backgroundChanged();
}
void Controller::pollAsset(bool video) {
    auto &prep = video ? foreground_ : background_;
    auto state = prep.asset.value("status").toString();
    if (prep.pending || prep.source.isEmpty() || state == "ready" || state == "error") return;
    const auto key = prep.asset.value("key").toString();
    if (key.isEmpty()) { if (prep.error.isEmpty()) prepare(video, prep.source); return; }
    prep.pending = true; int generation = prep.generation;
    request("/api/media/" + QString::fromLatin1(QUrl::toPercentEncoding(key)), nullptr,
        [this, video, generation](const QJsonObject &object, const QString &error) {
            auto &current = video ? foreground_ : background_;
            if (current.generation != generation) return;
            current.pending = false;
            if (error.isEmpty()) asset(video, object);
        });
}
void Controller::syncBackground() {
    const auto bg = library_.value("background").toObject();
    const auto state = bg.value("state").toObject();
    int track = state.value("trackId").isNull() ? -1 : state.value("trackId").toInt(-1);
    QString source, title;
    for (const auto &value : bg.value("tracks").toArray()) {
        const auto row = value.toObject();
        if (row.value("id").toInt() == track) { source = row.value("youtube_url").toString(); title = row.value("title").toString(); break; }
    }
    backgroundTrack_ = track; backgroundTitle_ = title; backgroundDesired_ = state.value("playing").toBool() && !source.isEmpty();
    if (source != backgroundSource_) {
        backgroundSource_ = source; ++background_.generation; background_.pending = false; background_.source.clear(); background_.loaded.clear(); background_.error.clear(); background_.asset = {};
        emit stopMedia(false);
        if (!source.isEmpty() && backgroundDesired_) prepare(false, source);
    } else if (backgroundDesired_ && background_.source.isEmpty()) prepare(false, source);
    const bool pause = !backgroundDesired_ || view_.page == "player";
    if (!pause && background_.loaded.isEmpty() && background_.asset.value("status") == "ready") asset(false, background_.asset);
    emit pauseMedia(pause, false); emit backgroundChanged();
}
void Controller::sendBackground(int track, bool playing) {
    const QJsonObject body{{"trackId", track < 0 ? QJsonValue::Null : QJsonValue(track)}, {"playing", playing}};
    auto bg = library_.value("background").toObject(); bg.insert("state", body); library_.insert("background", bg); syncBackground();
    if (fixture_) return;
    request("/api/background/state", &body, [this](const QJsonObject &, const QString &error) { if (!error.isEmpty()) fetchLibrary(); });
}
void Controller::toggleBackground() {
    if (backgroundTrack_ < 0) { openBackground(); return; }
    if (!background_.error.isEmpty()) { prepare(false, backgroundSource_, true); sendBackground(backgroundTrack_, true); }
    else sendBackground(backgroundTrack_, !backgroundDesired_);
}
void Controller::openBackground() { View next; next.page = "background"; next.heading = "Background music"; navigate(next); }
void Controller::toggleDark() {
    auto config = library_.value("config").toObject(); bool dark = !config.value("dark").toBool(true);
    config.insert("dark", dark); library_.insert("config", config); emit libraryChanged(); saveCache();
    if (fixture_) return;
    const QJsonObject body{{"dark", dark}};
    request("/api/dark-mode", &body, [](const QJsonObject &, const QString &) {});
}
void Controller::setVolume(double level) {
    volume_ = std::clamp(level, 0., 1.);
    emit changeVolume(volume_); emit playbackChanged();
    library_.insert("volume", volume_); saveCache();
    if (fixture_) return;
    const QJsonObject body{{"level", volume_}};
    request("/api/system/volume", &body, [](const QJsonObject &, const QString &) {});
}
void Controller::retry() {
    if (view_.page == "playlist") { fetchPlaylist(true); return; }
    if (view_.page == "player") { emit stopMedia(true); prepare(true, foreground_.source, true); }
}
void Controller::mediaState(bool video, bool playing, double position, double duration, const QString &error) {
    if (video) {
        // A queued status from the worker can arrive after Back stopped playback.
        if (view_.page != "player") return;
        playing_ = playing; position_ = position; duration_ = duration;
        if (!error.isEmpty()) foreground_.error = error;
        else if (playing) foreground_.error.clear();
        emit playbackChanged();
    } else { backgroundPlaying_ = playing; if (!error.isEmpty()) background_.error = error; else if (playing) background_.error.clear(); emit backgroundChanged(); }
}
void Controller::mediaEnded(bool video) {
    if (!video && backgroundDesired_ && view_.page != "player" && !background_.loaded.isEmpty()) emit loadMedia(background_.loaded, false);
}
void Controller::publishStatus() {
    if (fixture_) return;
    QJsonObject body{{"page", view_.page}, {"title", view_.heading}, {"playing", playing_}, {"position", position_}, {"duration", duration_}, {"error", foreground_.error}};
    request("/api/device/status", &body, [](const QJsonObject &, const QString &) {});
}
