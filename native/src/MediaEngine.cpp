#include "MediaEngine.h"
#include <QDebug>
#include <QFileInfo>
#include <QProcess>
#include <algorithm>
#include <cmath>
#include <vector>
#include <mpv/client.h>

namespace {
void option(mpv_handle *mpv, const char *name, const QByteArray &value) {
    if (mpv_set_option_string(mpv, name, value.constData()) < 0) qWarning() << "mpv refused the option" << name << value;
}
enum Property : uint64_t { TimePos = 1, Duration, Pause, PausedForCache, EofReached };
bool flag(const mpv_event_property *property) { return property->format == MPV_FORMAT_FLAG && *static_cast<int *>(property->data); }
}

mpv_handle *MediaEngine::createPlayer(bool video) {
    auto *mpv = mpv_create();
    if (!mpv) { qCritical() << "libmpv could not start"; return nullptr; }
    // None of the machine's own mpv setup, on-screen display or key handling.
    option(mpv, "config", "no"); option(mpv, "load-scripts", "no"); option(mpv, "ytdl", "no");
    option(mpv, "input-default-bindings", "no"); option(mpv, "input-vo-keyboard", "no");
    option(mpv, "idle", "yes");
    // Sound goes to the HDMI output through PipeWire's PulseAudio service.
    option(mpv, "ao", "pulse"); option(mpv, "audio-client-name", "PiTV");
    const auto device = qgetenv("PITV_AUDIO_DEVICE");
    if (!device.isEmpty()) option(mpv, "audio-device", "pulse/" + device);
    option(mpv, "volume-max", "100");
    // A connection that stops answering is given up, so playback can reconnect; one
    // that ends early is picked up where it stopped. (Not for streams without a
    // length: a live stream's playlists would wait between every update.)
    option(mpv, "network-timeout", "15");
    option(mpv, "stream-lavf-o", "reconnect=1,reconnect_delay_max=4");
    if (video) {
        option(mpv, "vo", "libmpv");
        // Software H.264 decoding. The Pi 4's hardware decoder (bcm2835-codec) stops
        // answering when it is flushed for a seek; software decoding of 1080p takes
        // about 15% of the Pi's CPU.
        option(mpv, "hwdec", "no");
        // Stay on the last frame at the end instead of closing the video.
        option(mpv, "keep-open", "yes");
        // Read up to two minutes ahead and keep about a minute behind for jumping back.
        option(mpv, "cache", "yes"); option(mpv, "cache-secs", "120");
        option(mpv, "demuxer-max-bytes", "64MiB"); option(mpv, "demuxer-max-back-bytes", "32MiB");
        // After running dry, gather a couple of seconds before playing on.
        option(mpv, "cache-pause-wait", "2");
        // Cheap scaling for the Pi's GPU, whichever mpv version is installed.
        for (const char *name : {"scale", "cscale", "dscale"}) option(mpv, name, "bilinear");
        for (const char *name : {"dither-depth", "correct-downscaling", "linear-downscaling", "sigmoid-upscaling", "hdr-compute-peak"}) option(mpv, name, "no");
        option(mpv, "sub-auto", "no"); option(mpv, "sid", "no");
    } else {
        option(mpv, "vid", "no"); option(mpv, "audio-display", "no");
        // Background music repeats its track.
        option(mpv, "loop-file", "inf");
    }
    if (mpv_initialize(mpv) < 0) { qCritical() << "libmpv could not initialize"; mpv_destroy(mpv); return nullptr; }
    mpv_request_log_messages(mpv, "warn");
    return mpv;
}
MediaEngine::MediaEngine(mpv_handle *video, QObject *parent) : QObject(parent) {
    video_.mpv = video; video_.video = true;
}
MediaEngine::~MediaEngine() { shutdown(); }
void MediaEngine::initialize() {
    background_.mpv = createPlayer(false);
    attach(video_); attach(background_);
    // Position changes arrive many times a second; they are passed on twice a second.
    tick_ = new QTimer(this);
    tick_->setInterval(500);
    connect(tick_, &QTimer::timeout, this, [this] { for (auto *channel : {&video_, &background_}) if (channel->positionChanged) publish(*channel); });
    tick_->start();
    retry_ = new QTimer(this);
    retry_->setSingleShot(true);
    connect(retry_, &QTimer::timeout, this, [this] {
        if (!background_.desired || background_.error.isEmpty()) return;
        background_.source.insert("start", background_.position);
        open(background_);
    });
}
void MediaEngine::attach(Channel &channel) {
    if (!channel.mpv) return;
    channel.engine = this;
    mpv_observe_property(channel.mpv, TimePos, "time-pos", MPV_FORMAT_DOUBLE);
    mpv_observe_property(channel.mpv, Duration, "duration", MPV_FORMAT_DOUBLE);
    mpv_observe_property(channel.mpv, Pause, "pause", MPV_FORMAT_FLAG);
    mpv_observe_property(channel.mpv, PausedForCache, "paused-for-cache", MPV_FORMAT_FLAG);
    mpv_observe_property(channel.mpv, EofReached, "eof-reached", MPV_FORMAT_FLAG);
    double volume = 100 * std::cbrt(volume_);
    mpv_set_property_async(channel.mpv, 0, "volume", MPV_FORMAT_DOUBLE, &volume);
    mpv_set_wakeup_callback(channel.mpv, wakeup, &channel);
}
// From mpv's own threads: only ask this thread to collect the events.
void MediaEngine::wakeup(void *data) {
    auto *channel = static_cast<Channel *>(data);
    if (channel->wake.exchange(true)) return;
    QMetaObject::invokeMethod(channel->engine, [channel] { channel->wake = false; channel->engine->drain(*channel); }, Qt::QueuedConnection);
}
void MediaEngine::videoReady(bool success) {
    outputReady_ = success;
    if (!success) { fail(video_, "The video output could not start. Restart the screen from the admin page."); return; }
    if (videoWaiting_) { videoWaiting_ = false; open(video_); }
}
void MediaEngine::load(const QVariantMap &source, bool video) {
    if (closing_) return;
    auto &channel = video ? video_ : background_;
    channel.source = source; channel.desired = true; channel.retries = 0;
    if (!video && retry_) retry_->stop();
    open(channel);
}
void MediaEngine::open(Channel &channel) {
    channel.error.clear(); channel.loaded = false; channel.eof = false; channel.buffering = false;
    channel.position = std::max(0.0, channel.source.value("start").toDouble()); channel.duration = 0;
    if (!channel.mpv) { fail(channel, "The player could not start. Restart the screen from the admin page."); return; }
    // mpv opens a video only once there is somewhere to draw it.
    if (channel.video && !outputReady_) { videoWaiting_ = true; publish(channel); return; }
    QByteArray url = channel.source.value("url").toString().toUtf8();
    const auto audio = channel.source.value("audio").toString().toUtf8();
    // Separate picture and sound streams play together, as in mpv's own YouTube support.
    if (!audio.isEmpty()) {
        const auto track = [](const QByteArray &part) { return "!new_stream;!no_clip;!no_chapters;%" + QByteArray::number(part.size()) + "%" + part; };
        url = "edl://" + track(url) + ";" + track(audio);
    }
    // "none": the beginning, or where a live broadcast is now.
    mpv_set_property_string(channel.mpv, "start", channel.position > 0 ? QByteArray::number(channel.position, 'f', 3).constData() : "none");
    // A live stream's master playlist: the best quality up to the bitrate chosen for it.
    const auto bitrate = qint64(channel.source.value("hlsBitrate").toDouble());
    mpv_set_property_string(channel.mpv, "hls-bitrate", bitrate > 0 ? QByteArray::number(bitrate).constData() : "max");
    const auto agent = channel.source.value("userAgent").toString();
    mpv_set_property_string(channel.mpv, "user-agent", (agent.isEmpty() ? QStringLiteral("PiTV") : agent).toUtf8().constData());
    std::vector<QByteArray> fields;
    for (const auto &header : channel.source.value("headers").toStringList()) fields.push_back(header.toUtf8());
    std::vector<mpv_node> items(fields.size());
    for (size_t i = 0; i < fields.size(); ++i) { items[i].format = MPV_FORMAT_STRING; items[i].u.string = fields[i].data(); }
    mpv_node_list list{int(items.size()), items.data(), nullptr};
    mpv_node headers; headers.format = MPV_FORMAT_NODE_ARRAY; headers.u.list = &list;
    mpv_set_property(channel.mpv, "http-header-fields", MPV_FORMAT_NODE, &headers);
    int pause = channel.desired ? 0 : 1;
    mpv_set_property(channel.mpv, "pause", MPV_FORMAT_FLAG, &pause);
    const char *command[]{"loadfile", url.constData(), "replace", nullptr};
    mpv_command_async(channel.mpv, 0, command);
    publish(channel);
}
void MediaEngine::stop(bool video) {
    auto &channel = video ? video_ : background_;
    channel.desired = false; channel.source.clear(); channel.error.clear();
    channel.loaded = false; channel.eof = false; channel.buffering = false; channel.position = channel.duration = 0;
    if (video) videoWaiting_ = false;
    if (!video && retry_) retry_->stop();
    if (channel.mpv) { const char *command[]{"stop", nullptr}; mpv_command_async(channel.mpv, 0, command); }
    publish(channel);
}
void MediaEngine::setPaused(bool paused, bool video) {
    auto &channel = video ? video_ : background_;
    channel.desired = !paused;
    if (!channel.mpv || channel.source.isEmpty()) return;
    // Play after a failure tries again.
    if (!channel.error.isEmpty()) { if (!paused) { channel.retries = 0; open(channel); } return; }
    if (channel.eof && !paused) {
        const char *command[]{"seek", "0", "absolute", nullptr};
        mpv_command_async(channel.mpv, 0, command);
    }
    int pause = paused ? 1 : 0;
    mpv_set_property_async(channel.mpv, 0, "pause", MPV_FORMAT_FLAG, &pause);
}
void MediaEngine::toggleVideo() { setPaused(video_.desired, true); }
void MediaEngine::seek(double seconds) {
    if (!video_.mpv || !video_.loaded) return;
    const auto amount = QByteArray::number(seconds);
    const char *command[]{"seek", amount.constData(), "relative", nullptr};
    mpv_command_async(video_.mpv, 0, command);
}
void MediaEngine::setVolume(double level) {
    volume_ = std::clamp(level, 0.0, 1.0);
    // mpv's volume is cubic; the saved level is a linear gain, as it was with GStreamer.
    double volume = 100 * std::cbrt(volume_);
    for (auto *channel : {&video_, &background_})
        if (channel->mpv) mpv_set_property_async(channel->mpv, 0, "volume", MPV_FORMAT_DOUBLE, &volume);
}
void MediaEngine::drain(Channel &channel) {
    if (!channel.mpv || closing_) return;
    bool changed = false;
    for (;;) {
        auto *event = mpv_wait_event(channel.mpv, 0);
        if (event->event_id == MPV_EVENT_NONE) break;
        switch (event->event_id) {
        case MPV_EVENT_LOG_MESSAGE: {
            const auto *message = static_cast<mpv_event_log_message *>(event->data);
            // ffmpeg's decoder warns about harmless quirks of YouTube's streams
            // ("Late SEI is not implemented") many times a minute; its errors still show.
            if (message->log_level == MPV_LOG_LEVEL_WARN && QByteArray(message->prefix).startsWith("ffmpeg/video")) break;
            qWarning().noquote() << (channel.video ? "Video player:" : "Music player:") << message->prefix << QString::fromUtf8(message->text).trimmed();
            break;
        }
        case MPV_EVENT_START_FILE: channel.loaded = false; changed = true; break;
        case MPV_EVENT_FILE_LOADED: channel.loaded = true; channel.error.clear(); changed = true; break;
        case MPV_EVENT_END_FILE: {
            const auto *end = static_cast<mpv_event_end_file *>(event->data);
            channel.loaded = false; changed = true;
            if (end->reason == MPV_END_FILE_REASON_ERROR && channel.desired)
                fail(channel, channel.video ? QString("The video could not be played (%1).").arg(mpv_error_string(end->error))
                                            : QString("Background music could not play (%1).").arg(mpv_error_string(end->error)));
            break;
        }
        case MPV_EVENT_PROPERTY_CHANGE: {
            const auto *property = static_cast<mpv_event_property *>(event->data);
            const bool known = property->format == MPV_FORMAT_DOUBLE;
            switch (event->reply_userdata) {
            case TimePos: if (known) { channel.position = *static_cast<double *>(property->data); channel.positionChanged = true; } break;
            case Duration: channel.duration = known ? *static_cast<double *>(property->data) : 0; changed = true; break;
            case Pause: channel.paused = flag(property); changed = true; break;
            case PausedForCache: channel.buffering = flag(property); changed = true; break;
            case EofReached:
                channel.eof = flag(property); changed = true;
                if (!channel.eof || !channel.video || !channel.desired) break;
                // A stream that ends well before its length was cut off: say so, so the
                // player reconnects instead of treating the video as finished.
                if (channel.duration > 0 && channel.position < channel.duration - 5) fail(channel, "The video stream stopped.");
                else { channel.desired = false; emit ended(true); }
                break;
            default: break;
            }
            break;
        }
        default: break;
        }
    }
    if (changed) publish(channel);
}
void MediaEngine::publish(Channel &channel) {
    channel.positionChanged = false;
    const bool playing = channel.loaded && !channel.paused && !channel.buffering && !channel.eof && channel.error.isEmpty();
    // Waiting on the network only counts while the video should be playing.
    emit status(channel.video, playing, channel.loaded && channel.buffering && channel.desired, channel.position, channel.duration, channel.error);
}
void MediaEngine::fail(Channel &channel, const QString &error) {
    channel.error = error; channel.loaded = false; channel.buffering = false;
    qWarning().noquote() << (channel.video ? "Video:" : "Background audio:") << error;
    // The video's stream is looked up again by the controller; the music, a file on
    // this device, is simply reopened, less often each time.
    if (!channel.video && channel.desired && retry_ && channel.retries < 5) { retry_->start(std::min(30000, 2000 << channel.retries)); ++channel.retries; }
    publish(channel);
}
// Some TVs (the library's Vizio) stay silent after they come on until the HDMI
// sound output restarts. The script exists only on provisioned systems.
void MediaEngine::restartAudio() {
    const QString script = QStringLiteral("/usr/local/bin/kiosk-audio-reset.sh");
    if (!QFileInfo(script).isExecutable()) return;
    qWarning() << "Restarting HDMI audio for the TV that came on";
    QProcess::startDetached(script, {});
}
void MediaEngine::shutdown() {
    closing_ = true;
    if (tick_) tick_->stop();
    if (retry_) retry_->stop();
    for (auto *channel : {&video_, &background_}) {
        if (!channel->mpv) continue;
        mpv_set_wakeup_callback(channel->mpv, nullptr, nullptr);
        mpv_terminate_destroy(channel->mpv);
        channel->mpv = nullptr;
    }
}
