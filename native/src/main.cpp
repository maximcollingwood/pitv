#include "Cec.h"
#include "Controller.h"
#include "Fonts.h"
#include "MediaEngine.h"
#include "MpvVideo.h"
#include "QrProvider.h"
#include <QCursor>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickItem>
#include <QQuickWindow>
#include <QThread>
#include <QTimer>
#include <QImage>
#include <QDebug>
#include <clocale>
#include <memory>

int main(int argc, char **argv) {
    QGuiApplication app(argc, argv);
    // libmpv parses numbers itself and refuses to start under a locale with
    // another decimal separator; Qt has just applied the system's.
    std::setlocale(LC_NUMERIC, "C");
    QCoreApplication::setApplicationName("pitv-native");
    QCoreApplication::setOrganizationName("PiTV");
    // A TV shows no pointer. A plugged-in mouse still works (moving it wakes the
    // player controls); PITV_SHOW_CURSOR=1 brings the pointer back for debugging.
    if (!qEnvironmentVariableIsSet("PITV_SHOW_CURSOR")) QGuiApplication::setOverrideCursor(QCursor(Qt::BlankCursor));
    const auto args = app.arguments();
    const bool smoke = args.contains("--smoke") || args.contains("--smoke-test");
    const bool verifyPlayback = args.contains("--verify-playback");
    const bool fullscreen = !args.contains("--windowed") && !smoke && !verifyPlayback;
    auto argument = [&args](const QString &name) { int i = args.indexOf(name); return i >= 0 && i + 1 < args.size() ? args[i + 1] : QString(); };
    // libmpv draws the video with OpenGL into the Qt Quick scene.
    if (!smoke) QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
    qmlRegisterType<MpvVideo>("PiTV", 1, 0, "MpvVideo");
    auto *player = MediaEngine::createPlayer(true);
    if (!player && !smoke) { qCritical() << "The video player could not start. Install libmpv."; return 2; }
    MpvVideo::setPlayer(player);
    Controller controller;
    QThread mediaThread;
    auto *media = new MediaEngine(player);
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
    QObject::connect(&controller, &Controller::restartAudio, media, &MediaEngine::restartAudio);
    mediaThread.start();
    // HDMI-CEC: follow the TV's power and take its remote's buttons. HDMI0 is the
    // first CEC adapter on a Raspberry Pi.
    Cec cec;
    if (!smoke && !verifyPlayback) controller.setCec(cec.open(qEnvironmentVariable("PITV_CEC_DEVICE", "/dev/cec0")));
    QObject::connect(&cec, &Cec::key, &controller, &Controller::press);
    QObject::connect(&cec, &Cec::tvStandby, &controller, &Controller::tvStandby);
    QObject::connect(&cec, &Cec::tvOn, &controller, &Controller::tvOn);
    QObject::connect(&controller, &Controller::oneTouchPlay, &cec, &Cec::oneTouchPlay);
    QObject::connect(&controller, &Controller::standbyTv, &cec, &Cec::standbyTv);
    QObject::connect(&controller, &Controller::tvChanged, &cec, [&cec, &controller] { cec.setAsleep(controller.tvAsleep()); });
    auto engine = std::make_unique<QQmlApplicationEngine>();
    Fonts::load();
    engine->rootContext()->setContextProperty("brandFonts", Fonts::families());
    engine->rootContext()->setContextProperty("kiosk", &controller);
    engine->rootContext()->setContextProperty("videoEnabled", !smoke);
    engine->rootContext()->setContextProperty("startFullscreen", fullscreen);
    engine->addImageProvider("qr", new QrProvider);
    bool qmlWarnings = false;
    QObject::connect(engine.get(), &QQmlEngine::warnings, &app, [&qmlWarnings](const QList<QQmlError> &errors) {
        qmlWarnings = true; for (const auto &error : errors) qWarning().noquote() << error.toString();
    });
    controller.start(argument("--fixture"));
    // Development: PITV_QML_DIR loads QML from disk, so UI edits need only a restart.
    const auto qmlDir = qEnvironmentVariable("PITV_QML_DIR");
    engine->load(qmlDir.isEmpty() ? QUrl("qrc:/qml/Main.qml") : QUrl::fromLocalFile(qmlDir + "/Main.qml"));
    auto *window = engine->rootObjects().isEmpty() ? nullptr : qobject_cast<QQuickWindow *>(engine->rootObjects().first());
    // The video item frees mpv's renderer as it goes, which must happen before the
    // players themselves are destroyed.
    auto shutdown = [&] {
        engine.reset();
        QMetaObject::invokeMethod(media, &MediaEngine::shutdown, Qt::BlockingQueuedConnection);
        mediaThread.quit(); mediaThread.wait();
    };
    if (!window) { shutdown(); return 3; }
    if (!smoke) {
        auto *surface = window->findChild<MpvVideo *>("videoSurface");
        if (!surface) { qCritical() << "Video surface did not load."; QTimer::singleShot(0, &app, [&app] { app.exit(4); }); }
        else QObject::connect(surface, &MpvVideo::outputReady, media, &MediaEngine::videoReady);
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
        if (args.contains("--simulate-error")) for (int i = 0; i < 4; ++i) controller.mediaState(true, false, false, 0, 0, "Audio output is unavailable. Check the TV connection and try again.");
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
            QObject::connect(media, &MediaEngine::status, &app, [&, finish](bool video, bool playing, bool, double position, double duration, const QString &error) {
                if (!video) return;
                if (!error.isEmpty()) { qCritical().noquote() << "Playback verification failed:" << error; app.exit(8); }
                else if (playing && position >= 1 && duration > 1) finish();
            });
            QTimer::singleShot(15000, &app, [&app] { qCritical() << "Playback verification timed out"; app.exit(9); });
        } else QTimer::singleShot(1400, &app, finish);
    }
    int result = app.exec();
    shutdown();
    return result;
}
