#include "Controller.h"
#include "Fonts.h"
#include "MediaEngine.h"
#include "QrProvider.h"
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickItem>
#include <QQuickWindow>
#include <QRunnable>
#include <QThread>
#include <QTimer>
#include <QImage>
#include <QDebug>
#include <functional>

class RenderJob final : public QRunnable {
public:
    explicit RenderJob(std::function<void()> fn) : fn_(std::move(fn)) {}
    void run() override { fn_(); }
private:
    std::function<void()> fn_;
};
int main(int argc, char **argv) {
    QGuiApplication app(argc, argv);
    QCoreApplication::setApplicationName("pitv-native");
    QCoreApplication::setOrganizationName("PiTV");
    const auto args = app.arguments();
    const bool smoke = args.contains("--smoke") || args.contains("--smoke-test");
    const bool verifyPlayback = args.contains("--verify-playback");
    const bool fullscreen = !args.contains("--windowed") && !smoke && !verifyPlayback;
    auto argument = [&args](const QString &name) { int i = args.indexOf(name); return i >= 0 && i + 1 < args.size() ? args[i + 1] : QString(); };
    gst_init(nullptr, nullptr);
    GstElement *sink = nullptr;
    if (!smoke) {
        QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
        // Creating the plugin before loading QML registers its Qt6 item type.
        sink = gst_element_factory_make("qml6glsink", nullptr);
        if (!sink) { qCritical() << "qml6glsink is missing. Install gstreamer1.0-qt6."; return 2; }
        gst_object_ref_sink(sink);
    }
    Controller controller;
    QThread mediaThread;
    auto *media = new MediaEngine(sink);
    media->moveToThread(&mediaThread);
    QObject::connect(&mediaThread, &QThread::started, media, &MediaEngine::initialize);
    QObject::connect(&mediaThread, &QThread::finished, media, &QObject::deleteLater);
    QObject::connect(&controller, &Controller::loadMedia, media, &MediaEngine::load);
    QObject::connect(&controller, &Controller::stopMedia, media, &MediaEngine::stop);
    QObject::connect(&controller, &Controller::pauseMedia, media, &MediaEngine::setPaused);
    QObject::connect(&controller, &Controller::toggleVideo, media, &MediaEngine::toggleVideo);
    QObject::connect(&controller, &Controller::seekVideo, media, &MediaEngine::seek);
    QObject::connect(&controller, &Controller::changeVolume, media, &MediaEngine::setVolume);
    QObject::connect(media, &MediaEngine::status, &controller, &Controller::mediaState);
    QObject::connect(media, &MediaEngine::ended, &controller, &Controller::mediaEnded);
    mediaThread.start();
    QQmlApplicationEngine engine;
    Fonts::load();
    engine.rootContext()->setContextProperty("brandFonts", Fonts::families());
    engine.rootContext()->setContextProperty("kiosk", &controller);
    engine.rootContext()->setContextProperty("videoEnabled", !smoke);
    engine.rootContext()->setContextProperty("startFullscreen", fullscreen);
    engine.addImageProvider("qr", new QrProvider);
    bool qmlWarnings = false;
    QObject::connect(&engine, &QQmlEngine::warnings, &app, [&qmlWarnings](const QList<QQmlError> &errors) {
        qmlWarnings = true; for (const auto &error : errors) qWarning().noquote() << error.toString();
    });
    controller.start(argument("--fixture"));
    // Development: PITV_QML_DIR loads QML from disk, so UI edits need only a restart.
    const auto qmlDir = qEnvironmentVariable("PITV_QML_DIR");
    engine.load(qmlDir.isEmpty() ? QUrl("qrc:/qml/Main.qml") : QUrl::fromLocalFile(qmlDir + "/Main.qml"));
    auto *window = engine.rootObjects().isEmpty() ? nullptr : qobject_cast<QQuickWindow *>(engine.rootObjects().first());
    if (!window) {
        QMetaObject::invokeMethod(media, &MediaEngine::shutdown, Qt::BlockingQueuedConnection);
        mediaThread.quit(); mediaThread.wait(); if (sink) gst_object_unref(sink); return 3;
    }
    if (sink) {
        auto *surface = window->findChild<QQuickItem *>("videoSurface");
        if (!surface) { qCritical() << "Video surface did not load."; QTimer::singleShot(0, &app, [&app] { app.exit(4); }); }
        else {
            g_object_set(sink, "widget", surface, nullptr);
            window->scheduleRenderJob(new RenderJob([sink, media] {
                const bool ok = gst_element_set_state(sink, GST_STATE_READY) != GST_STATE_CHANGE_FAILURE;
                QMetaObject::invokeMethod(media, [media, ok] { media->videoReady(ok); }, Qt::QueuedConnection);
            }), QQuickWindow::BeforeSynchronizingStage);
        }
    }
    if (smoke || verifyPlayback) {
        const QString screenshot = argument("--screenshot");
        if (args.contains("--light") && controller.config().value("dark").toBool()) controller.toggleDark();
        const QString page = argument("--page");
        if (!page.isEmpty()) {
            for (int i = 0; i < controller.entries().size(); ++i) {
                if (controller.entries()[i].toMap().value("type").toString() == page) { controller.openIndex(i); break; }
            }
            if (args.contains("--detail") && !controller.entries().isEmpty()) controller.openIndex(0);
        }
        for (const auto &index : argument("--route").split(',', Qt::SkipEmptyParts)) {
            bool ok = false;
            const int item = index.toInt(&ok);
            if (!ok || item < 0 || item >= controller.entries().size()) {
                qCritical() << "Invalid smoke route";
                QTimer::singleShot(0, &app, [&app] { app.exit(7); });
                break;
            }
            controller.openIndex(item);
        }
        if (args.contains("--simulate-error")) controller.mediaState(true, false, 0, 0, "Audio output is unavailable. Check the TV connection and try again.");
        auto finish = [&, screenshot] {
            const auto frame = window->grabWindow();
            if (!screenshot.isEmpty() && !frame.save(screenshot)) { qCritical() << "Could not save screenshot"; app.exit(5); return; }
            if (verifyPlayback) {
                // verify-playback.sh supplies a saturated test pattern. Checking
                // the rendered pixels catches a black video item even when the
                // pipeline clock and audio output are advancing successfully.
                int vivid = 0, sampled = 0;
                for (int y = frame.height() / 4; y < frame.height() * 3 / 4; y += 16) {
                    for (int x = frame.width() / 10; x < frame.width() * 9 / 10; x += 16) {
                        const auto pixel = frame.pixelColor(x, y);
                        const int maximum = qMax(pixel.red(), qMax(pixel.green(), pixel.blue()));
                        const int minimum = qMin(pixel.red(), qMin(pixel.green(), pixel.blue()));
                        if (maximum > 100 && maximum - minimum > 80) ++vivid;
                        ++sampled;
                    }
                }
                if (!sampled || vivid < sampled / 10) {
                    qCritical() << "Playback verification failed: video test pattern was not rendered";
                    app.exit(10); return;
                }
            }
            app.exit(qmlWarnings ? 6 : 0);
        };
        if (verifyPlayback) {
            QObject::connect(media, &MediaEngine::status, &app, [&, finish](bool video, bool playing, double position, double duration, const QString &error) {
                if (!video) return;
                if (!error.isEmpty()) { qCritical().noquote() << "Playback verification failed:" << error; app.exit(8); }
                else if (playing && position >= 1 && duration > 1) finish();
            });
            QTimer::singleShot(15000, &app, [&app] { qCritical() << "Playback verification timed out"; app.exit(9); });
        } else QTimer::singleShot(1400, &app, finish);
    }
    int result = app.exec();
    QMetaObject::invokeMethod(media, &MediaEngine::shutdown, Qt::BlockingQueuedConnection);
    mediaThread.quit(); mediaThread.wait();
    if (sink) { gst_element_set_state(sink, GST_STATE_NULL); gst_object_unref(sink); }
    return result;
}
