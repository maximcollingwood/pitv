#pragma once
#include <QObject>
#include <QTimer>
#include <gst/gst.h>

// Lives on its own QThread: device open, state transitions and teardown may
// block in drivers, and must not block navigation or Qt's rendering thread.
class MediaEngine final : public QObject {
    Q_OBJECT
public:
    explicit MediaEngine(GstElement *videoSink, QObject *parent = nullptr);
    ~MediaEngine() override;
public slots:
    void initialize();
    void videoReady(bool success);
    void load(const QString &uri, bool video);
    void stop(bool video);
    void setPaused(bool paused, bool video);
    void toggleVideo();
    void seek(double seconds);
    void setVolume(double level);
    void shutdown();
signals:
    void status(bool video, bool playing, double position, double duration, const QString &error);
    void ended(bool video);
private:
    struct Channel {
        GstElement *playbin = nullptr;
        GstBus *bus = nullptr;
        QString uri, error;
        bool desired = false, playing = false, ended = false;
        double position = 0, duration = 0, resumeAt = 0;
        int retries = 0;
        qint64 retryAt = 0;
    };
    Channel video_, background_;
    GstElement *sink_ = nullptr;
    QTimer *poll_ = nullptr;
    bool ready_ = false, closing_ = false;
    double volume_ = .05;
    int ticks_ = 0;
    qint64 lastAudioReset_ = 0;
    bool build(Channel &channel, bool video);
    void publish(const Channel &channel, bool video);
    void fail(Channel &channel, bool video, const QString &error);
    void drain(Channel &channel, bool video);
    bool resetAudio();
    void destroy(Channel &channel);
};
