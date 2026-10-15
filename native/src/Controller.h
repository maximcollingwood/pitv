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
    Q_PROPERTY(QString mediaStatus READ mediaStatus NOTIFY playbackChanged)
    Q_PROPERTY(QString mediaError READ mediaError NOTIFY playbackChanged)
    Q_PROPERTY(double progress READ progress NOTIFY playbackChanged)
    Q_PROPERTY(bool playing READ playing NOTIFY playbackChanged)
    Q_PROPERTY(double position READ position NOTIFY playbackChanged)
    Q_PROPERTY(double duration READ duration NOTIFY playbackChanged)
    Q_PROPERTY(QString backgroundTitle READ backgroundTitle NOTIFY backgroundChanged)
    Q_PROPERTY(QString backgroundStatus READ backgroundStatus NOTIFY backgroundChanged)
    Q_PROPERTY(bool backgroundPlaying READ backgroundPlaying NOTIFY backgroundChanged)
    Q_PROPERTY(double volume READ volume NOTIFY playbackChanged)
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
    QString mediaStatus() const { return foreground_.asset.value("status").toString(); }
    QString mediaError() const { return foreground_.error; }
    double progress() const { return foreground_.asset.value("progress").toDouble(); }
    bool playing() const { return playing_; }
    double position() const { return position_; }
    double duration() const { return duration_; }
    QString backgroundTitle() const { return backgroundTitle_; }
    QString backgroundStatus() const { return background_.error.isEmpty() ? background_.asset.value("status").toString() : background_.error; }
    bool backgroundPlaying() const { return backgroundPlaying_; }
    double volume() const { return volume_; }
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
public slots:
    void mediaState(bool video, bool playing, double position, double duration, const QString &error);
    void mediaEnded(bool video);
signals:
    void libraryChanged();
    void viewChanged();
    void selectionChanged();
    void connectionChanged();
    void playbackChanged();
    void backgroundChanged();
    void resetScroll();
    void scrollRequested(int direction);
    void loadMedia(const QString &uri, bool video);
    void stopMedia(bool video);
    void pauseMedia(bool paused, bool video);
    void toggleVideo();
    void seekVideo(double seconds);
    void changeVolume(double level);
    // A key reached the player; the overlay shows its controls again.
    void playerActivity();
private:
    struct View { QString page = "home", heading, type, section, category, playlist; QVariantMap item; int selected = 0; };
    struct Preparation { QString source, error, loaded; QJsonObject asset; int generation = 0; bool pending = false; };
    QNetworkAccessManager network_;
    QUrl base_;
    QJsonObject library_, cachedAssets_, playlists_;
    QVariantList entries_;
    QVariantMap current_;
    View view_;
    QList<View> history_;
    Preparation foreground_, background_;
    QPointer<QNetworkReply> stream_;
    SseParser parser_;
    QTimer reconnect_, heartbeat_, poll_, refresh_, watchdog_;
    QString cachePath_, notice_, backgroundTitle_, backgroundSource_;
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
    QStringList chromeControls(const QString &zone) const;
    void enterChrome(const QString &zone);
    double position_ = 0, duration_ = 0, volume_ = .05;
    using Response = std::function<void(const QJsonObject &, const QString &)>;
    void request(const QString &path, const QJsonObject *body, Response done);
    void fetchLibrary();
    void applyLibrary(const QJsonObject &library);
    void saveCache();
    void connectEvents();
    void event(const QJsonObject &object);
    void navigate(View view, bool remember = true);
    void rebuild();
    void openItem(const QVariantMap &item);
    void fetchPlaylist(bool retry = false);
    void prepare(bool video, const QString &url, bool retry = false);
    void asset(bool video, const QJsonObject &object);
    void pollAsset(bool video);
    void syncBackground();
    void sendBackground(int track, bool playing);
    void setVolume(double level);
    void publishStatus();
};
