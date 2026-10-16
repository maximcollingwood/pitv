#include "Cec.h"
#include "Controller.h"
#include "LyricsLayout.h"
#include "SseParser.h"
#include <QJsonArray>
#include <QJsonDocument>
#include <QSignalSpy>
#include <QTemporaryFile>
#include <QtTest>

class CoreTests final : public QObject {
    Q_OBJECT
private slots:
    void eventsAcceptFragmentedFrames() {
        SseParser parser;
        QVERIFY(parser.feed("data: {\"type\":").isEmpty());
        QVERIFY(parser.feed("\"remote\"}\r").isEmpty());
        QCOMPARE(parser.feed("\n\r\n"), QList<QByteArray>{"{\"type\":\"remote\"}"});
        QCOMPARE(parser.feed(": keepalive\n\ndata: first\ndata: second\n\n"), QList<QByteArray>{"first\nsecond"});
        QVERIFY(parser.feed("data: incomplete").isEmpty());
        parser.reset();
        QCOMPARE(parser.feed("data: fresh\n\n"), QList<QByteArray>{"fresh"});
    }
    void eventsBoundMemoryAndRecover() {
        SseParser parser;
        QVERIFY(parser.feed("data: " + QByteArray(1024 * 1024 + 1, 'x') + "\n\n").isEmpty());
        QCOMPARE(parser.feed("data: next\n\n"), QList<QByteArray>{"next"});
    }
    void lyricsPreserveVersesAndProvideOverflow() {
        const QString body = "First line\nSecond line\n\nतीसरी पंक्ति\nचौथी पंक्ति\n\nLast verse";
        const auto fit = fitLyrics(body, 1408, 547);
        const auto columns = fit.value("columns").toStringList();
        QCOMPARE(columns.join("\n\n"), body);
        QVERIFY(fit.value("fontSize").toInt() >= 14);
        QVERIFY(!fit.value("overflow").toBool());
        const auto longFit = fitLyrics(QString("A long verse that must remain readable\n").repeated(500), 800, 400);
        QVERIFY(longFit.value("overflow").toBool());
        QVERIFY(longFit.value("contentHeight").toDouble() > 400);
        QCOMPARE(longFit.value("fontSize").toInt(), 22);
    }
    void navigationPreservesSelectionAndBoundaries() {
        Controller controller;
        controller.start(TEST_FIXTURE);
        QCOMPARE(controller.page(), "home");
        QCOMPARE(controller.entries().size(), 7);
        controller.action("up", 2);
        QCOMPARE(controller.focusZone(), "header");
        controller.action("down", 2);
        QCOMPARE(controller.focusZone(), "content");
        QCOMPARE(controller.selected(), 0);
        controller.action("down", 2);
        QCOMPARE(controller.selected(), 2);
        controller.action("select");
        QCOMPARE(controller.sectionType(), "media");
        QCOMPARE(controller.entries().size(), 2);
        controller.openIndex(0);
        QCOMPARE(controller.page(), "category");
        QCOMPARE(controller.entries().size(), 2);
        controller.openIndex(1);
        QCOMPARE(controller.page(), "playlist");
        QCOMPARE(controller.entries().size(), 2);
        controller.openIndex(0);
        QCOMPARE(controller.page(), "player");
        QSignalSpy stop(&controller, &Controller::stopMedia);
        controller.back();
        QCOMPARE(controller.page(), "playlist");
        QVERIFY(stop.count() > 0);
        QCOMPARE(stop.first().first().toBool(), true);
        controller.back();
        QCOMPARE(controller.page(), "category");
        QCOMPARE(controller.selected(), 1);
        controller.back(); controller.back();
        QCOMPARE(controller.page(), "home");
        QCOMPARE(controller.selected(), 2);
        controller.home();
        QCOMPARE(controller.selected(), 0);
    }
    void headerAndFooterControlsAreReachableWithArrows() {
        Controller controller;
        controller.start(TEST_FIXTURE);
        const bool dark = controller.config().value("dark").toBool();
        controller.action("up", 2);
        QCOMPARE(controller.focusedControl(), "theme");
        controller.action("select", 2);
        QCOMPARE(controller.config().value("dark").toBool(), !dark);
        QCOMPARE(controller.focusZone(), "header");
        controller.action("down", 2);
        // Down from the last row (a partial row included) reaches the footer.
        for (int i = 0; i < 3; ++i) controller.action("down", 2);
        QCOMPARE(controller.selected(), 6);
        QCOMPARE(controller.focusZone(), "content");
        controller.action("down", 2);
        QCOMPARE(controller.focusZone(), "footer");
        QCOMPARE(controller.focusedControl(), "background");
        QSignalSpy load(&controller, &Controller::loadMedia);
        controller.action("select", 2);
        QCOMPARE(load.count(), 1);
        controller.action("right", 2);
        QCOMPARE(controller.focusedControl(), "remote");
        controller.action("select", 2);
        QCOMPARE(controller.page(), "connect");
        QCOMPARE(controller.focusZone(), "content");
        controller.home(); controller.openIndex(0);
        QCOMPARE(controller.page(), "section");
        controller.action("up");
        QCOMPARE(controller.focusedControl(), "back");
        controller.action("right");
        QCOMPARE(controller.focusedControl(), "theme");
        controller.action("right");
        QCOMPARE(controller.focusedControl(), "theme");
        controller.action("left");
        controller.action("select");
        QCOMPARE(controller.page(), "home");
        controller.openIndex(0); controller.openIndex(0);
        QCOMPARE(controller.page(), "reader");
        QSignalSpy scroll(&controller, &Controller::scrollRequested);
        controller.setScrollEdges(false, false);
        controller.action("up");
        QCOMPARE(scroll.count(), 1);
        controller.setScrollEdges(true, false);
        controller.action("up");
        QCOMPARE(controller.focusZone(), "header");
        controller.action("down");
        controller.setScrollEdges(false, true);
        controller.action("down");
        QCOMPARE(controller.focusZone(), "footer");
    }
    void anyButtonClosesTheColourCheck() {
        Controller controller;
        controller.start(TEST_FIXTURE);
        QSignalSpy changed(&controller, &Controller::colourCheckChanged);
        controller.showColourCheck(true);
        QVERIFY(controller.colourCheck());
        controller.action("down", 2);
        QVERIFY(!controller.colourCheck());
        QCOMPARE(changed.count(), 2);
        QCOMPARE(controller.page(), "home");
        QCOMPARE(controller.selected(), 0);
        controller.action("down", 2);
        QCOMPARE(controller.selected(), 2);
    }
    void guestWifiBecomesAJoinCode() {
        Controller controller;
        controller.start(TEST_FIXTURE);
        // Reserved characters are escaped so phones read the name and password intact.
        QCOMPARE(controller.wifiCode(), "WIFI:T:WPA;S:Lotus\\; Guest;P:hare\\:krishna;;");
    }
    void accentedLettersAreDecomposedExceptTheWifiPassword() {
        QTemporaryFile fixture;
        QVERIFY(fixture.open());
        const QString title = QString::fromUtf8("\u015Ar\u012B K\u1E5B\u1E63\u1E47a");
        const QString password = QString::fromUtf8("p\u0101ssword");
        fixture.write(QJsonDocument(QJsonObject{{"config", QJsonObject{{"title", title}, {"sections", QJsonArray{}},
            {"wifi", QJsonObject{{"ssid", "Guest"}, {"password", password}}}}}, {"items", QJsonObject{}}}).toJson());
        fixture.close();
        Controller controller;
        controller.start(fixture.fileName());
        QCOMPARE(controller.heading(), title.normalized(QString::NormalizationForm_D));
        QVERIFY(controller.heading() != title);
        QVERIFY(controller.wifiCode().contains(password));
    }
    void readerLyricsAndFaqControls() {
        Controller controller;
        controller.start(TEST_FIXTURE);
        QSignalSpy scroll(&controller, &Controller::scrollRequested);
        controller.openIndex(0); controller.openIndex(0);
        QCOMPARE(controller.page(), "reader");
        controller.action("down");
        QCOMPARE(scroll.takeFirst().first().toInt(), 1);
        controller.home(); controller.openIndex(1); controller.openIndex(0);
        QCOMPARE(controller.page(), "lyrics");
        controller.action("left");
        QCOMPARE(controller.current().value("id").toInt(), 202);
        controller.action("right");
        QCOMPARE(controller.current().value("id").toInt(), 201);
        controller.home(); controller.openIndex(4);
        QCOMPARE(controller.current().value("id").toInt(), 501);
        controller.action("down");
        QCOMPARE(controller.current().value("id").toInt(), 502);
        controller.action("right");
        QCOMPARE(scroll.takeFirst().first().toInt(), 1);
        controller.action("select");
        QCOMPARE(controller.page(), "section");
        controller.home(); controller.openIndex(3); controller.openIndex(0);
        QCOMPARE(controller.page(), "book");
    }
    void libraryRefreshDoesNotResetReadingPosition() {
        Controller controller;
        controller.start(TEST_FIXTURE);
        controller.openIndex(0); controller.openIndex(0);
        QSignalSpy reset(&controller, &Controller::resetScroll);
        controller.start(TEST_FIXTURE);
        QCOMPARE(controller.page(), "reader");
        QCOMPARE(controller.current().value("id").toInt(), 101);
        QCOMPARE(reset.count(), 0);
        controller.back();
        QCOMPARE(reset.count(), 1);
    }
    void backgroundPausesForForegroundAndLoopsOnlyWhenWanted() {
        Controller controller;
        controller.start(TEST_FIXTURE);
        QSignalSpy load(&controller, &Controller::loadMedia);
        QSignalSpy pause(&controller, &Controller::pauseMedia);
        controller.toggleBackground();
        QCOMPARE(load.count(), 1);
        QCOMPARE(load.first().at(1).toBool(), false);
        QVERIFY(load.first().at(0).toString().endsWith("/api/media/audio-fixture/file"));
        controller.mediaState(false, true, 0, 20, {});
        QVERIFY(controller.backgroundPlaying());
        controller.mediaEnded(false);
        QCOMPARE(load.count(), 2);
        controller.openIndex(2); controller.openIndex(0); controller.openIndex(0);
        QCOMPARE(controller.page(), "player");
        QCOMPARE(pause.last().at(0).toBool(), true);
        controller.mediaEnded(false);
        QCOMPARE(load.count(), 2);
        controller.back();
        QCOMPARE(pause.last().at(0).toBool(), false);
        controller.toggleBackground();
        controller.mediaEnded(false);
        QCOMPARE(load.count(), 2);
    }
    void playbackCommandsAndExitState() {
        Controller controller;
        controller.start(TEST_FIXTURE);
        QSignalSpy toggle(&controller, &Controller::toggleVideo);
        QSignalSpy seek(&controller, &Controller::seekVideo);
        QSignalSpy activity(&controller, &Controller::playerActivity);
        controller.openIndex(2); controller.openIndex(0); controller.openIndex(0);
        controller.action("select"); QCOMPARE(toggle.count(), 1);
        controller.action("left"); QCOMPARE(seek.takeFirst().first().toDouble(), -10.);
        controller.action("right"); QCOMPARE(seek.takeFirst().first().toDouble(), 10.);
        controller.action("up"); QCOMPARE(controller.volume(), .20);
        controller.action("down"); QCOMPARE(controller.volume(), .15);
        QCOMPARE(activity.count(), 5);
        controller.mediaState(true, true, 12, 60, {});
        QVERIFY(controller.playing());
        controller.mediaState(true, false, 12, 60, "Device disconnected");
        QCOMPARE(controller.mediaError(), "Device disconnected");
        controller.retry();
        QVERIFY(controller.mediaError().isEmpty());
        controller.home();
        controller.mediaState(true, false, 12, 60, "Old player failure");
        QVERIFY(!controller.playing());
        QVERIFY(controller.mediaError().isEmpty());
        QCOMPARE(controller.position(), 0.);
    }
    void cecFollowsTheTvAndAnswersIt() {
        Cec cec;
        QList<QByteArray> sent;
        cec.simulate(4, 0x1000, [&sent](const QByteArray &frame) { sent.append(frame); });
        QSignalSpy keys(&cec, &Cec::key), standby(&cec, &Cec::tvStandby), on(&cec, &Cec::tvOn);
        cec.handle(QByteArray::fromHex("0f36")); // TV to all: Standby
        QCOMPARE(standby.count(), 1);
        cec.handle(QByteArray::fromHex("0f84000000")); // TV to all: Report Physical Address, as it powers on
        QCOMPARE(on.count(), 1);
        QCOMPARE(on.last().at(0).toBool(), true);
        cec.handle(QByteArray::fromHex("044401")); // TV to us: User Control Pressed, Up
        cec.handle(QByteArray::fromHex("0445"));
        cec.handle(QByteArray::fromHex("04440d")); // Back
        cec.handle(QByteArray::fromHex("044461")); // Pause-Play Function
        QCOMPARE(keys.count(), 3);
        QCOMPARE(keys.at(0).at(0).toString(), "up");
        QCOMPARE(keys.at(1).at(0).toString(), "back");
        QCOMPARE(keys.at(2).at(0).toString(), "playpause");
        QCOMPARE(on.last().at(0).toBool(), false);
        QVERIFY(sent.isEmpty());
        // Power status, menu status and Feature Abort for what a playback device does not do.
        cec.handle(QByteArray::fromHex("048f"));
        QCOMPARE(sent.last(), QByteArray::fromHex("409000"));
        cec.setAsleep(true);
        cec.handle(QByteArray::fromHex("048f"));
        QCOMPARE(sent.last(), QByteArray::fromHex("409001"));
        cec.handle(QByteArray::fromHex("048d00"));
        QCOMPARE(sent.last(), QByteArray::fromHex("408e00"));
        cec.handle(QByteArray::fromHex("041a01"));
        QCOMPARE(sent.last(), QByteArray::fromHex("40001a00"));
        cec.handle(QByteArray::fromHex("040090")); // a Feature Abort is not answered
        QCOMPARE(sent.size(), 4);
        // Routing: we answer for our input only while the TV shows it.
        sent.clear();
        cec.handle(QByteArray::fromHex("0f85"));
        QCOMPARE(sent, QList<QByteArray>{QByteArray::fromHex("4f821000")});
        cec.handle(QByteArray::fromHex("0f862000")); // Set Stream Path to another input
        sent.clear();
        cec.handle(QByteArray::fromHex("0f85"));
        QVERIFY(sent.isEmpty());
        cec.handle(QByteArray::fromHex("0f8020001000")); // Routing Change back to us
        QCOMPARE(sent, QList<QByteArray>{QByteArray::fromHex("4f821000")});
        // One Touch Play: Image View On, then Active Source. Standby turns the TV off.
        sent.clear();
        cec.oneTouchPlay();
        cec.standbyTv();
        QCOMPARE(sent, (QList<QByteArray>{QByteArray::fromHex("4004"), QByteArray::fromHex("4f821000"), QByteArray::fromHex("4036")}));
    }
    void tvPowerPutsTheScreenToSleepAndWakesIt() {
        Controller controller;
        controller.start(TEST_FIXTURE);
        controller.tvStandby();
        QVERIFY(!controller.tvAsleep()); // without CEC the screen cannot know the TV's power
        controller.setCec(true);
        QSignalSpy pause(&controller, &Controller::pauseMedia), turnOn(&controller, &Controller::oneTouchPlay),
            turnOff(&controller, &Controller::standbyTv), restart(&controller, &Controller::restartAudio);
        const QList<QVariant> playing{false, false}, paused{true, false};
        controller.press("play"); // Play on the TV remote starts the background music
        QCOMPARE(pause.last(), playing);
        controller.press("down");
        QCOMPARE(controller.selected(), 2);
        controller.tvStandby();
        QVERIFY(controller.tvAsleep());
        QCOMPARE(controller.page(), "home");
        QCOMPARE(controller.selected(), 0);
        QCOMPARE(pause.last(), paused);
        // A button while the TV is off turns it on, and does nothing else.
        controller.press("down");
        QCOMPARE(turnOn.count(), 1);
        QVERIFY(!controller.tvAsleep());
        QCOMPARE(controller.selected(), 0);
        QCOMPARE(pause.last(), paused);
        // A button from the TV remote means the TV is up: the sound restarts,
        // then the music plays again.
        controller.tvStandby();
        controller.tvOn(false);
        QVERIFY(restart.wait(3000));
        QCOMPARE(pause.last(), paused);
        QTRY_COMPARE_WITH_TIMEOUT(pause.last(), playing, 6000);
        // The phone remote's power button turns the TV off and on.
        controller.press("power");
        QCOMPARE(turnOff.count(), 1);
        QVERIFY(controller.tvAsleep());
        controller.press("power");
        QCOMPARE(turnOn.count(), 2);
        QVERIFY(!controller.tvAsleep());
    }
};
QTEST_MAIN(CoreTests)
#include "CoreTests.moc"
