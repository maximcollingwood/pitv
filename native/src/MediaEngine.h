#pragma once
#include <QObject>
#include <QTimer>
#include <QVariantMap>
#include <atomic>

struct mpv_handle;

// Plays the video and the background music, each with its own libmpv player.
// libmpv decodes, buffers and reads the network on its own threads and every
// command here is asynchronous, so nothing a stream or decoder does can hold up
// navigation or the other player. Lives on its own QThread all the same.
class MediaEngine final : public QObject {
    Q_OBJECT
public:
    // The video player is created before the QML loads, because the video item
    // draws its frames; the engine owns it from then on.
    static mpv_handle *createPlayer(bool video);
    explicit MediaEngine(mpv_handle *video, QObject *parent = nullptr);
    ~MediaEngine() override;
public slots:
    void initialize();
    // The video item can show mpv's pictures; videos wait for it.
    void videoReady(bool success);
    // source: "url", optional "audio" (the sound, when it streams separately),
    // "start" (seconds), and "userAgent" and "headers" for a stream opened at
    // YouTube directly (a live video).
    void load(const QVariantMap &source, bool video);
    void stop(bool video);
    void setPaused(bool paused, bool video);
    void toggleVideo();
    void seek(double seconds);
    void setVolume(double level);
    // The TV came back on: restart the HDMI sound output for it.
    void restartAudio();
    void shutdown();
signals:
    // buffering: playback waits for the network. error: playback stopped.
    void status(bool video, bool playing, bool buffering, double position, double duration, const QString &error);
    void ended(bool video);
private:
    struct Channel {
        mpv_handle *mpv = nullptr;
        MediaEngine *engine = nullptr;
        bool video = false;
        QVariantMap source;
        QString error;
        bool desired = false, loaded = false, paused = true, buffering = false, eof = false;
        double position = 0, duration = 0;
        int retries = 0;
        bool positionChanged = false;
        std::atomic<bool> wake{false};
    };
    Channel video_, background_;
    // Created on the engine's thread, in initialize().
    QTimer *tick_ = nullptr, *retry_ = nullptr;
    double volume_ = .05;
    bool closing_ = false, outputReady_ = false, videoWaiting_ = false;
    static void wakeup(void *channel);
    void attach(Channel &channel);
    void open(Channel &channel);
    void drain(Channel &channel);
    void publish(Channel &channel);
    void fail(Channel &channel, const QString &error);
};
