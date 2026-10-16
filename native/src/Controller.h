#pragma once
#include "SseParser.h"
#include <QObject>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QPointer>
#include <QStringList>
#include <QThread>
#include <QTimer>
#include <QVariantList>
#include <atomic>
#include <functional>

class QNetworkReply;
class Controller final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantMap config READ config NOTIFY libraryChanged)
    Q_PROPERTY(QVariantList entries READ entries NOTIFY viewChanged)
    Q_PROPERTY(QVariantMap current READ current NOTIFY viewChanged)
    Q_PROPERTY(QString page READ page NOTIFY viewChanged)
    Q_PROPERTY(QString heading READ heading NOTIFY viewChanged)
    Q_PROPERTY(QString sectionType READ sectionType NOTIFY viewChanged)
    Q_PROPERTY(int selected READ selected NOTIFY selectionChanged)
    // Arrow focus: "content" (the grid/list) or the "header"/"footer" control bars.
    Q_PROPERTY(QString focusZone READ focusZone NOTIFY selectionChanged)
    Q_PROPERTY(QString focusedControl READ focusedControl NOTIFY selectionChanged)
    Q_PROPERTY(bool connected READ connected NOTIFY connectionChanged)
    Q_PROPERTY(QString remoteUrl READ remoteUrl NOTIFY libraryChanged)
    // Guest Wi-Fi as a "WIFI:" QR payload phone cameras offer to join; empty when unset.
    Q_PROPERTY(QString wifiCode READ wifiCode NOTIFY libraryChanged)
    Q_PROPERTY(QString notice READ notice NOTIFY viewChanged)
    // The video: "resolving" (looked up at YouTube), "loading", "ready" or "error".
    Q_PROPERTY(QString mediaStatus READ mediaStatus NOTIFY playbackChanged)
    Q_PROPERTY(QString mediaError READ mediaError NOTIFY playbackChanged)
    // Shown over a playing video: "Buffering…" or "Reconnecting…".
    Q_PROPERTY(QString mediaNote READ mediaNote NOTIFY playbackChanged)
    Q_PROPERTY(bool playing READ playing NOTIFY playbackChanged)
    Q_PROPERTY(double position READ position NOTIFY playbackChanged)
    Q_PROPERTY(double duration READ duration NOTIFY playbackChanged)
    Q_PROPERTY(QString backgroundTitle READ backgroundTitle NOTIFY backgroundChanged)
    Q_PROPERTY(QString backgroundStatus READ backgroundStatus NOTIFY backgroundChanged)
    Q_PROPERTY(bool backgroundPlaying READ backgroundPlaying NOTIFY backgroundChanged)
    Q_PROPERTY(double volume READ volume NOTIFY playbackChanged)
    // The volume the player shows: the TV's own when the server reaches it, else PiTV's.
    Q_PROPERTY(QString volumeText READ volumeText NOTIFY playbackChanged)
    // A test card for judging the TV's colours, opened from the admin page.
    Q_PROPERTY(bool colourCheck READ colourCheck NOTIFY colourCheckChanged)
public:
    explicit Controller(QObject *parent = nullptr);
    ~Controller() override;
    QVariantMap config() const { return library_.value("config").toObject().toVariantMap(); }
    QVariantList entries() const { return entries_; }
    QVariantMap current() const { return current_; }
    QString page() const { return view_.page; }
    QString heading() const { return view_.heading; }
    QString sectionType() const { return view_.type; }
    int selected() const { return view_.selected; }
    QString focusZone() const { return zone_; }
    QString focusedControl() const;
    bool connected() const { return connected_; }
    QString remoteUrl() const;
    QString wifiCode() const;
    QString notice() const { return notice_; }
    QString mediaStatus() const { return video_.status; }
    QString mediaError() const { return video_.error; }
    QString mediaNote() const { return video_.note; }
    bool playing() const { return playing_; }
    double position() const { return position_; }
    double duration() const { return duration_; }
    QString backgroundTitle() const { return backgroundTitle_; }
    QString backgroundStatus() const { return background_.error.isEmpty() ? background_.asset.value("status").toString() : background_.error; }
    bool backgroundPlaying() const { return backgroundPlaying_; }
    double volume() const { return volume_; }
    QString volumeText() const;
    bool colourCheck() const { return colourCheck_; }
    bool tvAsleep() const { return tvAsleep_; }
    // HDMI-CEC reaches the TV, so the screen follows its power and can turn it on.
    void setCec(bool available) { cec_ = available; }
    void start(const QString &fixture = {});
    Q_INVOKABLE void action(const QString &key, int columns = 1);
    Q_INVOKABLE void selectIndex(int index);
    Q_INVOKABLE void openIndex(int index);
    Q_INVOKABLE void home();
    Q_INVOKABLE void back();
    Q_INVOKABLE void toggleDark();
    Q_INVOKABLE void toggleBackground();
    Q_INVOKABLE void openBackground();
    Q_INVOKABLE void retry();
    Q_INVOKABLE void activateControl(const QString &control);
    Q_INVOKABLE void setScrollEdges(bool atStart, bool atEnd);
    Q_INVOKABLE QString absoluteUrl(const QString &path) const;
    Q_INVOKABLE QVariantMap lyrics(const QString &body, double width, double height) const;
    Q_INVOKABLE QString clockText(double seconds) const;
    Q_INVOKABLE void showColourCheck(bool show);
public slots:
    void mediaState(bool video, bool playing, bool buffering, double position, double duration, const QString &error);
    void mediaEnded(bool video);
    // A remote button, from the phone or the TV's remote over CEC.
    void press(const QString &key);
    // Like a TV box, the screen sleeps while the TV is off and wakes when it comes on.
    void tvStandby();
    void tvOn(bool started);
signals:
    void libraryChanged();
    void viewChanged();
    void selectionChanged();
    void connectionChanged();
    void playbackChanged();
    void backgroundChanged();
    void resetScroll();
    void scrollRequested(int direction);
    // source: "url", and "audio" when the sound streams separately; see MediaEngine::load.
    void loadMedia(const QVariantMap &source, bool video);
    void stopMedia(bool video);
    void pauseMedia(bool paused, bool video);
    void toggleVideo();
    void seekVideo(double seconds);
    void changeVolume(double level);
    // A key reached the player; the overlay shows its controls again.
    void playerActivity();
    void colourCheckChanged();
    void tvChanged();
    // Turn the TV on and switch it to us (CEC One Touch Play), or turn it off.
    void oneTouchPlay();
    void standbyTv();
    // Restart the HDMI sound output, so a TV that just came on gets a fresh stream.
    void restartAudio();
private:
    struct View { QString page = "home", heading, type, section, category, playlist; QVariantMap item; int selected = 0; };
    // Background music, downloaded to the device by the server.
    struct Preparation { QString source, error, loaded; QJsonObject asset; int generation = 0; bool pending = false; };
    // The video, streamed from YouTube through the server. resumeAt: where a
    // reopened stream starts. failures: reconnections since it last played well.
    struct Stream { QString source, status, error, note; double resumeAt = 0; int generation = 0, failures = 0; };
    QNetworkAccessManager network_;
    QUrl base_;
    QJsonObject library_, cachedAssets_, playlists_, fixtureStreams_;
    QVariantList entries_;
    QVariantMap current_;
    View view_;
    QList<View> history_;
    Preparation background_;
    Stream video_;
    QPointer<QNetworkReply> stream_;
    SseParser parser_;
    QTimer reconnect_, heartbeat_, poll_, refresh_, watchdog_, colourCheckTimeout_, audioRestart_, stall_, frozen_, warm_;
    QString cachePath_, notice_, backgroundTitle_, backgroundSource_, warmUrl_;
    QThread cacheThread_;
    QObject *cacheWriter_ = nullptr;
    QByteArray cacheSaved_;
    std::atomic<int> cacheGeneration_{0};
    bool connected_ = false, fixture_ = false, snapshotPending_ = false, snapshotAgain_ = false;
    bool playing_ = false, backgroundPlaying_ = false, backgroundDesired_ = false, playlistPending_ = false;
    int retryDelay_ = 1000, backgroundTrack_ = -1;
    QString zone_ = "content";
    int chromeIndex_ = 0;
    bool scrollAtStart_ = true, scrollAtEnd_ = false;
    bool colourCheck_ = false;
    // tvAsleep_: the TV is off. holdAudio_: background music waits for the sound restart.
    bool cec_ = false, tvAsleep_ = false, holdAudio_ = false;
    bool backgroundAudible() const { return backgroundDesired_ && view_.page != "player" && !tvAsleep_ && !holdAudio_; }
    void wakeTv();
    QStringList chromeControls(const QString &zone) const;
    void enterChrome(const QString &zone);
    double position_ = 0, duration_ = 0, volume_ = .05, movedAt_ = -1;
    // The TV's own volume (a paired Vizio TV, through the server); level -1 while unknown.
    int tvLevel_ = -1;
    bool tvMuted_ = false;
    void stepVolume(int direction);
    using Response = std::function<void(const QJsonObject &, const QString &)>;
    void request(const QString &path, const QJsonObject *body, Response done, int timeout = 12000);
    void fetchLibrary();
    void applyLibrary(const QJsonObject &library);
    void saveCache();
    void connectEvents();
    void event(const QJsonObject &object);
    void navigate(View view, bool remember = true);
    void rebuild();
    void openItem(const QVariantMap &item);
    void fetchPlaylist(bool retry = false);
    void playVideo(const QString &url);
    void openStream(bool fresh);
    void startStream(const QJsonObject &stream);
    void streamFailed(const QString &error);
    void warmSelection();
    void prepareBackground(const QString &url, bool retry = false);
    void backgroundAsset(const QJsonObject &object);
    void pollBackground();
    void syncBackground();
    void sendBackground(int track, bool playing);
    void setVolume(double level);
    void publishStatus();
};
