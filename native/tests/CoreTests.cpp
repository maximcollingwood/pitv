#include "Controller.h"
#include "LyricsLayout.h"
#include "SseParser.h"
#include <QSignalSpy>
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
        controller.openIndex(2); controller.openIndex(0); controller.openIndex(0);
        controller.action("select"); QCOMPARE(toggle.count(), 1);
        controller.action("left"); QCOMPARE(seek.takeFirst().first().toDouble(), -10.);
        controller.action("right"); QCOMPARE(seek.takeFirst().first().toDouble(), 10.);
        controller.action("up"); QCOMPARE(controller.volume(), .20);
        controller.action("down"); QCOMPARE(controller.volume(), .15);
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
};
QTEST_MAIN(CoreTests)
#include "CoreTests.moc"
