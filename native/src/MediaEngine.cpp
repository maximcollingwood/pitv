#include "MediaEngine.h"
#include <QDateTime>
#include <QDebug>
#include <QFileInfo>
#include <QProcess>
#include <algorithm>

MediaEngine::MediaEngine(GstElement *sink, QObject *parent) : QObject(parent), sink_(sink) {
    if (sink_) gst_object_ref(sink_);
}
MediaEngine::~MediaEngine() {
    destroy(video_); destroy(background_);
    if (sink_) gst_object_unref(sink_);
}
void MediaEngine::initialize() {
    poll_ = new QTimer(this);
    poll_->setInterval(100);
    connect(poll_, &QTimer::timeout, this, [this] {
        ++ticks_; drain(video_, true); drain(background_, false);
    });
    poll_->start();
}
void MediaEngine::videoReady(bool success) {
    ready_ = success;
    if (!success) { fail(video_, true, "The OpenGL video output could not initialize. Check the display service."); return; }
    if (!video_.uri.isEmpty()) { const auto uri = video_.uri; load(uri, true); }
}
bool MediaEngine::build(Channel &ch, bool video) {
    if (ch.playbin) return true;
    if (video && !ready_) return false;
    auto *playbin = gst_element_factory_make("playbin", nullptr);
    auto *audio = gst_element_factory_make("pulsesink", nullptr);
    if (!playbin || !audio) {
        if (playbin) gst_object_unref(playbin);
        if (audio) gst_object_unref(audio);
        ch.error = "Missing GStreamer playbin or pulsesink. Install the base and good plugins.";
        publish(ch, video); return false;
    }
    const auto device = qgetenv("PITV_AUDIO_DEVICE");
    if (!device.isEmpty()) g_object_set(audio, "device", device.constData(), nullptr);
    g_object_set(audio, "client-name", "PiTV", nullptr);
    g_object_set(playbin, "audio-sink", audio, "volume", volume_, nullptr);
    if (video) {
        auto *bin = gst_element_factory_make("glsinkbin", nullptr);
        if (!bin || !sink_) {
            if (bin) gst_object_unref(bin);
            gst_object_unref(playbin);
            ch.error = "Missing GStreamer glsinkbin/qml6glsink. Install the GL and Qt6 plugins.";
            publish(ch, video); return false;
        }
        // sink_ was initialized to READY on the Qt render thread before any
        // other GL element, so the whole pipeline shares Qt's GstGLDisplay.
        g_object_set(bin, "sink", sink_, nullptr);
        g_object_set(playbin, "video-sink", bin, nullptr);
        guint flags = 0; g_object_get(playbin, "flags", &flags, nullptr);
        g_object_set(playbin, "flags", flags & ~4u, nullptr); // subtitles are not a second QML overlay
    } else {
        guint flags = 0; g_object_get(playbin, "flags", &flags, nullptr);
        g_object_set(playbin, "flags", (flags | 2u) & ~5u, nullptr); // audio only
    }
    ch.playbin = playbin;
    ch.bus = gst_element_get_bus(playbin);
    return true;
}
void MediaEngine::load(const QString &uri, bool video) {
    if (closing_) return;
    auto &ch = video ? video_ : background_;
    ch.uri = uri; ch.desired = true; ch.playing = false; ch.ended = false;
    ch.position = 0; ch.duration = 0; ch.resumeAt = 0; ch.retryAt = 0; ch.retries = 0; ch.error.clear();
    if (!build(ch, video)) { publish(ch, video); return; }
    gst_element_set_state(ch.playbin, GST_STATE_READY);
    gst_bus_set_flushing(ch.bus, TRUE); gst_bus_set_flushing(ch.bus, FALSE);
    g_object_set(ch.playbin, "uri", uri.toUtf8().constData(), nullptr);
    publish(ch, video);
    if (gst_element_set_state(ch.playbin, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE)
        fail(ch, video, "Playback could not start. Check audio output and media availability.");
}
void MediaEngine::stop(bool video) {
    auto &ch = video ? video_ : background_;
    ch.desired = false; ch.playing = false; ch.uri.clear(); ch.error.clear();
    ch.retryAt = 0; ch.position = 0; ch.duration = 0; ch.resumeAt = 0;
    if (ch.playbin) {
        gst_element_set_state(ch.playbin, GST_STATE_READY);
        gst_bus_set_flushing(ch.bus, TRUE); gst_bus_set_flushing(ch.bus, FALSE);
    }
    publish(ch, video);
}
void MediaEngine::setPaused(bool paused, bool video) {
    auto &ch = video ? video_ : background_;
    ch.desired = !paused;
    if (!ch.playbin || ch.uri.isEmpty()) return;
    if (!ch.error.isEmpty()) {
        if (!paused) { ch.retries = 0; ch.retryAt = QDateTime::currentMSecsSinceEpoch() + 1; }
        return;
    }
    if (ch.ended && !paused) {
        gst_element_seek_simple(ch.playbin, GST_FORMAT_TIME, GST_SEEK_FLAG_FLUSH, 0);
        ch.ended = false;
    }
    if (gst_element_set_state(ch.playbin, paused ? GST_STATE_PAUSED : GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE)
        fail(ch, video, "Audio/video output is unavailable. Reconnecting…");
}
void MediaEngine::toggleVideo() { setPaused(video_.desired, true); }
void MediaEngine::seek(double seconds) {
    if (!video_.playbin || video_.uri.isEmpty()) return;
    const auto target = std::clamp(video_.position + seconds, 0.0, std::max(0.0, video_.duration - .1));
    gst_element_seek_simple(video_.playbin, GST_FORMAT_TIME,
        GstSeekFlags(GST_SEEK_FLAG_FLUSH | GST_SEEK_FLAG_KEY_UNIT), gint64(target * GST_SECOND));
}
void MediaEngine::setVolume(double level) {
    volume_ = std::clamp(level, 0.0, 1.0);
    for (auto *channel : {&video_, &background_})
        if (channel->playbin) g_object_set(channel->playbin, "volume", volume_, nullptr);
}
void MediaEngine::publish(const Channel &ch, bool video) {
    emit status(video, ch.playing, ch.position, ch.duration, ch.error);
}
void MediaEngine::fail(Channel &ch, bool video, const QString &error) {
    ch.error = error; ch.playing = false;
    ch.resumeAt = ch.position;
    if (ch.playbin) gst_element_set_state(ch.playbin, GST_STATE_READY);
    if (!ch.uri.isEmpty() && ch.retries < 5) {
        ch.retryAt = QDateTime::currentMSecsSinceEpoch() + std::min(30000, 2000 << ch.retries);
        ++ch.retries;
    } else ch.retryAt = 0;
    qWarning().noquote() << (video ? "Video:" : "Background audio:") << error;
    publish(ch, video);
}
// A playback failure such as a hardware decoder stall can glitch the HDMI
// output, and some TVs then drop the audio and stay silent although the Pi
// keeps sending it. Restarting the HDMI audio output makes them pick it up
// again. At most once a minute; the script exists only on provisioned systems.
bool MediaEngine::resetAudio() {
    const QString script = QStringLiteral("/usr/local/bin/kiosk-audio-reset.sh");
    const auto now = QDateTime::currentMSecsSinceEpoch();
    if (now - lastAudioReset_ < 60000 || !QFileInfo(script).isExecutable()) return false;
    lastAudioReset_ = now;
    qWarning().noquote() << "Restarting HDMI audio after a playback failure";
    return QProcess::startDetached(script, {});
}
void MediaEngine::drain(Channel &ch, bool video) {
    if (!ch.playbin || closing_) return;
    while (auto *msg = gst_bus_pop(ch.bus)) {
        switch (GST_MESSAGE_TYPE(msg)) {
        case GST_MESSAGE_ERROR: {
            GError *error = nullptr; gchar *debug = nullptr;
            gst_message_parse_error(msg, &error, &debug);
            const QString description = error ? QString::fromUtf8(error->message) : "Playback failed.";
            if (debug) qWarning().noquote() << debug;
            if (error) g_error_free(error);
            g_free(debug);
            fail(ch, video, description);
            // Leave the reset time to finish before the retry opens a new stream.
            if (resetAudio() && ch.retryAt) ch.retryAt = std::max(ch.retryAt, QDateTime::currentMSecsSinceEpoch() + 5000);
            break;
        }
        case GST_MESSAGE_EOS:
            ch.playing = false; ch.ended = true; ch.desired = false;
            publish(ch, video); emit ended(video); break;
        case GST_MESSAGE_STATE_CHANGED:
            if (GST_MESSAGE_SRC(msg) == GST_OBJECT(ch.playbin)) {
                GstState old, state, pending;
                gst_message_parse_state_changed(msg, &old, &state, &pending);
                ch.playing = state == GST_STATE_PLAYING;
                if (ch.playing) { ch.error.clear(); ch.retryAt = 0; }
                publish(ch, video);
            }
            break;
        case GST_MESSAGE_ASYNC_DONE:
            if (ch.resumeAt > 0) {
                gst_element_seek_simple(ch.playbin, GST_FORMAT_TIME,
                    GstSeekFlags(GST_SEEK_FLAG_FLUSH | GST_SEEK_FLAG_KEY_UNIT), gint64(ch.resumeAt * GST_SECOND));
                ch.resumeAt = 0;
            }
            break;
        case GST_MESSAGE_CLOCK_LOST:
            if (ch.desired) {
                gst_element_set_state(ch.playbin, GST_STATE_PAUSED);
                gst_element_set_state(ch.playbin, GST_STATE_PLAYING);
            }
            break;
        case GST_MESSAGE_LATENCY: gst_bin_recalculate_latency(GST_BIN(ch.playbin)); break;
        default: break;
        }
        gst_message_unref(msg);
    }
    if (ch.retryAt > 0 && ch.desired && QDateTime::currentMSecsSinceEpoch() >= ch.retryAt) {
        ch.retryAt = 0;
        g_object_set(ch.playbin, "uri", ch.uri.toUtf8().constData(), nullptr);
        if (gst_element_set_state(ch.playbin, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE)
            fail(ch, video, ch.error);
    }
    if (ticks_ % 5 == 0 && !ch.uri.isEmpty()) {
        gint64 position = 0, duration = 0;
        if (gst_element_query_position(ch.playbin, GST_FORMAT_TIME, &position)) ch.position = double(position) / GST_SECOND;
        if (gst_element_query_duration(ch.playbin, GST_FORMAT_TIME, &duration)) ch.duration = double(duration) / GST_SECOND;
        publish(ch, video);
    }
}
void MediaEngine::destroy(Channel &ch) {
    if (ch.playbin) { gst_element_set_state(ch.playbin, GST_STATE_NULL); gst_object_unref(ch.playbin); ch.playbin = nullptr; }
    if (ch.bus) { gst_object_unref(ch.bus); ch.bus = nullptr; }
}
void MediaEngine::shutdown() {
    closing_ = true;
    if (poll_) poll_->stop();
    destroy(video_); destroy(background_);
}
