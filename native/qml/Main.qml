import QtQuick
import QtQuick.Window

Window {
    id: window
    width: 1600; height: 900
    visible: true
    visibility: startFullscreen ? Window.FullScreen : Window.Windowed
    title: "PiTV"
    color: theme.canvas
    QtObject {
        id: theme
        property bool dark: kiosk.config.dark === undefined || kiosk.config.dark
        property color canvas: dark ? "#101b19" : "#f0eee7"
        property color panel: dark ? "#192824" : "#ffffff"
        property color active: dark ? "#29483a" : "#d5e6d6"
        property color line: dark ? "#34483e" : "#d5d8ce"
        property color ink: dark ? "#f1f0e8" : "#17342b"
        property color muted: dark ? "#a5b7aa" : "#5c7268"
        property color accent: dark ? "#b8d99c" : "#376941"
    }
    Item {
        id: scene
        width: 1600; height: 900
        scale: Math.min(window.width / width, window.height / height)
        anchors.centerIn: parent
        focus: true
        property bool home: kiosk.page === "home"
        property bool player: kiosk.page === "player"
        property bool reading: ["reader", "lyrics", "book"].indexOf(kiosk.page) >= 0
        // Tiles show the remote highlight only while focus is in the grid/list.
        property bool contentFocus: kiosk.focusZone === "content"
        function reportScrollEdges() { kiosk.setScrollEdges(textScroll.atYBeginning, textScroll.atYEnd) }
        function label(item) { return item.name || item.question || item.title || "Untitled" }
        function typeLabel(type) { return ({articles:"READ & REFLECT", lyrics:"SING TOGETHER", media:"WATCH & LISTEN", catalog:"OUR BOOKS", faq:"QUESTIONS & ANSWERS", background:"SET THE ATMOSPHERE", connect:"CONTROL FROM YOUR PHONE"})[type] || "EXPLORE" }
        function icon(type) { return ({articles:"Aa", lyrics:"♫", media:"▷", catalog:"▤", faq:"?", background:"♪", connect:"⌘"})[type] || "→" }
        Keys.onPressed: function(event) {
            var key = ({16777234:"left",16777236:"right",16777235:"up",16777237:"down",16777220:"select",16777221:"select",32:"select",16777216:"back",16777219:"back",16777232:"home"})[event.key]
            if (key) { kiosk.action(key, scene.home ? 2 : 1); event.accepted = true }
            else if (event.key === Qt.Key_M) { kiosk.openBackground(); event.accepted = true }
            else if (event.key === Qt.Key_D) { kiosk.toggleDark(); event.accepted = true }
        }
        Rectangle { anchors.fill: parent; color: theme.canvas }
        Loader { id: video; anchors.fill: parent; active: videoEnabled; source: "VideoSurface.qml"; visible: scene.player }

        Item {
            id: header
            x: 64; y: 40; width: 1472; height: 78
            visible: !scene.player
            Row {
                spacing: 18
                Rectangle {
                    width: 44; height: 44; radius: 14; color: theme.accent
                    Text { anchors.centerIn: parent; text: "P"; color: theme.canvas; font.pixelSize: 25; font.family: "Noto Sans"; font.bold: true }
                    MouseArea { anchors.fill: parent; onClicked: kiosk.home() }
                }
                Column {
                    spacing: 3
                    Text { text: kiosk.config.title || "PiTV"; color: theme.ink; font.pixelSize: 23; font.family: "Noto Sans"; font.weight: Font.DemiBold }
                    Text { text: scene.home ? "A SPACE TO LEARN, REFLECT & CONNECT" : "LIBRARY  /  " + kiosk.heading.toUpperCase(); color: theme.muted; font.pixelSize: 12; font.letterSpacing: 2; font.family: "Noto Sans" }
                }
            }
            Row {
                anchors.right: remoteBadge.left; anchors.rightMargin: 22; spacing: 12
                Pill { visible: !scene.home; label: "← Back"; ink: theme.ink; fill: theme.panel; activeFill: theme.active; accent: theme.accent; focused: kiosk.focusedControl === "back"; onClicked: kiosk.activateControl("back") }
                Pill { label: theme.dark ? "Light appearance" : "Dark appearance"; ink: theme.ink; fill: theme.panel; activeFill: theme.active; accent: theme.accent; focused: kiosk.focusedControl === "theme"; onClicked: kiosk.activateControl("theme") }
                Rectangle { width: 10; height: 10; radius: 5; anchors.verticalCenter: parent.verticalCenter; color: kiosk.connected ? theme.accent : "#e4ae72" }
                Text { anchors.verticalCenter: parent.verticalCenter; text: kiosk.connected ? "Connected" : "Local library"; color: theme.muted; font.pixelSize: 16; font.family: "Noto Sans" }
            }
            Rectangle {
                id: remoteBadge
                anchors.right: parent.right; y: -16; width: 88; height: 88; radius: 9; color: "white"
                Image { anchors.fill: parent; anchors.margins: 3; source: "image://qr/" + encodeURIComponent(kiosk.remoteUrl); smooth: false }
                MouseArea { anchors.fill: parent; onClicked: { kiosk.home(); kiosk.openIndex(kiosk.entries.length - 1) } }
            }
        }
        Item {
            id: homePage
            visible: scene.home
            x: 64; y: 144; width: 1472; height: 644
            Rectangle {
                width: 594; height: parent.height; radius: 28; color: theme.panel; clip: true
                Image { anchors.fill: parent; source: kiosk.absoluteUrl(kiosk.config.hero || ""); fillMode: Image.PreserveAspectCrop; asynchronous: true; sourceSize.width: 1200; sourceSize.height: 1300 }
                Rectangle { anchors.fill: parent; color: "transparent"; gradient: Gradient { GradientStop { position: 0; color: "#20202b23" } GradientStop { position: 1; color: "#f00c211a" } } }
                Rectangle { x: 56; y: 58; width: 116; height: 4; radius: 2; color: "#bbd89c" }
                Text { x: 56; y: 86; text: "WELCOME"; font.family: "Noto Sans"; font.pixelSize: 17; font.letterSpacing: 5; color: "#e4efdf" }
                Column {
                    x: 56; anchors.bottom: parent.bottom; anchors.bottomMargin: 52; width: parent.width - 112; spacing: 22
                    Text { width: parent.width; text: kiosk.config.title || "A little space\nfor inspiration."; color: "#f4f1e9"; font.family: "Noto Sans"; font.pixelSize: 53; font.weight: Font.Medium; wrapMode: Text.WordWrap; lineHeight: 1.08 }
                    Text { width: parent.width; text: kiosk.config.subtitle || "Discover something meaningful.\nMake yourself at home."; color: "#d0dfd0"; font.family: "Noto Sans"; font.pixelSize: 25; wrapMode: Text.WordWrap; lineHeight: 1.35 }
                }
            }
            Column {
                x: 638; width: parent.width - x; spacing: 22
                Row {
                    width: parent.width
                    Text { text: "Explore the library"; color: theme.ink; font.family: "Noto Sans"; font.pixelSize: 30; font.weight: Font.Medium }
                }
                GridView {
                    id: homeGrid
                    width: parent.width + 16; height: 580; clip: true
                    cellWidth: width / 2; cellHeight: count <= 8 ? 145 : 164
                    model: kiosk.entries
                    currentIndex: kiosk.selected
                    highlightMoveDuration: 0
                    onCurrentIndexChanged: positionViewAtIndex(currentIndex, GridView.Contain)
                    delegate: Item {
                        required property var modelData
                        required property int index
                        width: homeGrid.cellWidth; height: homeGrid.cellHeight
                        Rectangle {
                            anchors.fill: parent; anchors.rightMargin: 16; anchors.bottomMargin: 16; radius: 19
                            color: scene.contentFocus && kiosk.selected === index ? theme.active : theme.panel
                            border.width: scene.contentFocus && kiosk.selected === index ? 2 : 1
                            border.color: scene.contentFocus && kiosk.selected === index ? theme.accent : theme.line
                            Behavior on color { ColorAnimation { duration: 110 } }
                            Text { x: 25; y: 19; text: scene.icon(modelData.type); color: theme.accent; font.family: "Noto Sans"; font.pixelSize: 29 }
                            Text { x: 25; y: 64; width: parent.width - 48; text: scene.label(modelData); color: theme.ink; font.family: "Noto Sans"; font.pixelSize: 22; font.weight: Font.DemiBold; elide: Text.ElideRight }
                            Text { x: 25; y: 108; text: scene.typeLabel(modelData.type); color: theme.muted; font.family: "Noto Sans"; font.pixelSize: 10; font.letterSpacing: 1.3 }
                            MouseArea { anchors.fill: parent; onClicked: kiosk.openIndex(index) }
                        }
                    }
                }
            }
        }
        Item {
            id: browse
            visible: ["section", "category", "playlist", "background"].indexOf(kiosk.page) >= 0
            x: 64; y: 144; width: 1472; height: 644
            property bool faq: kiosk.sectionType === "faq" && kiosk.page === "section"
            Text { text: kiosk.heading; color: theme.ink; font.family: "Noto Sans"; font.pixelSize: 45; font.weight: Font.Medium; width: parent.width - 280; elide: Text.ElideRight }
            Text { anchors.right: parent.right; y: 20; text: kiosk.entries.length + (kiosk.entries.length === 1 ? " item" : " items"); color: theme.muted; font.family: "Noto Sans"; font.pixelSize: 18 }
            ListView {
                id: itemList
                x: 0; y: 85; width: browse.faq ? 555 : 1472; height: 559
                clip: true; spacing: 12; model: kiosk.entries; currentIndex: kiosk.selected
                highlightMoveDuration: 0
                onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
                delegate: Rectangle {
                    required property var modelData
                    required property int index
                    width: itemList.width; height: browse.faq ? 108 : (kiosk.sectionType === "catalog" ? 128 : 102); radius: 17
                    color: scene.contentFocus && kiosk.selected === index ? theme.active : theme.panel
                    border.color: scene.contentFocus && kiosk.selected === index ? theme.accent : theme.line; border.width: scene.contentFocus && kiosk.selected === index ? 2 : 1
                    Behavior on color { ColorAnimation { duration: 100 } }
                    Text { x: 26; anchors.verticalCenter: parent.verticalCenter; text: (index + 1).toString().padStart(2, "0"); color: theme.muted; font.family: "Noto Sans"; font.pixelSize: 18 }
                    Column {
                        x: 81; anchors.verticalCenter: parent.verticalCenter; width: parent.width - 134; spacing: 8
                        Text { width: parent.width; text: scene.label(modelData); color: theme.ink; font.family: "Noto Sans"; font.pixelSize: browse.faq ? 23 : 28; font.weight: Font.Medium; wrapMode: Text.WordWrap; maximumLineCount: browse.faq ? 2 : 1; elide: Text.ElideRight }
                        Text { visible: kiosk.sectionType === "catalog" || modelData.count !== undefined; width: parent.width; text: modelData.count !== undefined ? modelData.count + " videos & playlists" : (modelData.author || "") + (modelData.year ? " · " + modelData.year : "") + (modelData.category ? "  /  " + modelData.category : ""); color: theme.muted; font.family: "Noto Sans"; font.pixelSize: 18; elide: Text.ElideRight }
                    }
                    Text { anchors.right: parent.right; anchors.rightMargin: 25; anchors.verticalCenter: parent.verticalCenter; text: "→"; font.pixelSize: 24; color: theme.accent }
                    MouseArea { anchors.fill: parent; onClicked: kiosk.openIndex(index) }
                }
            }
            Rectangle {
                visible: browse.faq; x: 589; y: 85; width: 883; height: 559; radius: 22; color: theme.panel
                Flickable {
                    id: faqScroll
                    anchors.fill: parent; anchors.margins: 34; contentWidth: width; contentHeight: faqContent.height; clip: true; boundsBehavior: Flickable.StopAtBounds
                    Column {
                        id: faqContent; width: faqScroll.width; spacing: 23
                        Row {
                            width: parent.width; spacing: 26
                            Image { width: kiosk.current.cover_url ? 134 : 0; height: kiosk.current.cover_url ? 180 : 0; source: kiosk.absoluteUrl(kiosk.current.cover_url || ""); fillMode: Image.PreserveAspectFit; asynchronous: true; sourceSize.width: 268 }
                            Column { width: parent.width - (kiosk.current.cover_url ? 160 : 0); spacing: 13
                                Text { text: "FROM THE LIBRARY"; color: theme.accent; font.family: "Noto Sans"; font.pixelSize: 12; font.letterSpacing: 2 }
                                Text { width: parent.width; text: kiosk.current.book_title || "Select a question"; color: theme.ink; font.family: "Noto Sans"; font.pixelSize: 32; wrapMode: Text.WordWrap }
                                Text { width: parent.width; text: kiosk.current.location || ""; color: theme.muted; font.family: "Noto Sans"; font.pixelSize: 18; wrapMode: Text.WordWrap }
                            }
                        }
                        Rectangle { width: parent.width; height: 1; color: theme.line }
                        Text { width: parent.width; text: kiosk.current.quote || ""; color: theme.ink; font.family: "Noto Sans"; font.pixelSize: 28; wrapMode: Text.WordWrap; lineHeight: 1.35; textFormat: Text.PlainText }
                    }
                }
            }
            Text { visible: kiosk.entries.length === 0; x: 28; y: 142; width: parent.width - 56; text: kiosk.notice || "Nothing here yet. Add content from the phone editor."; color: theme.muted; font.family: "Noto Sans"; font.pixelSize: 28; wrapMode: Text.WordWrap }
            Text { visible: kiosk.notice.length > 0 && kiosk.entries.length > 0; anchors.bottom: parent.bottom; anchors.right: parent.right; text: kiosk.notice; color: theme.accent; font.family: "Noto Sans"; font.pixelSize: 16 }
        }
        Item {
            id: reader
            visible: scene.reading
            x: 96; y: 142; width: 1408; height: 646
            Text { id: readerTitle; width: parent.width; text: kiosk.heading; color: theme.ink; font.family: "Noto Sans"; font.pixelSize: 37; font.weight: Font.Medium; elide: Text.ElideRight }
            Text { id: bookMeta; y: 58; width: parent.width; visible: kiosk.page === "book"; text: (kiosk.current.author || "") + (kiosk.current.year ? " · " + kiosk.current.year : "") + (kiosk.current.category ? "  /  " + kiosk.current.category : ""); color: theme.accent; font.family: "Noto Sans"; font.pixelSize: 22 }
            Rectangle { x: 0; y: kiosk.page === "book" ? 103 : 73; width: parent.width; height: 1; color: theme.line }
            Flickable {
                id: textScroll
                onAtYBeginningChanged: scene.reportScrollEdges()
                onAtYEndChanged: scene.reportScrollEdges()
                x: 0; y: kiosk.page === "book" ? 129 : 99; width: parent.width; height: parent.height - y
                contentWidth: width; contentHeight: kiosk.page === "lyrics" ? lyricsRow.height : article.implicitHeight
                clip: true; boundsBehavior: Flickable.StopAtBounds
                Text {
                    id: article; visible: kiosk.page !== "lyrics"; width: parent.width
                    text: kiosk.page === "book" ? (kiosk.current.description || "No description has been added.") : (kiosk.current.body || "")
                    color: theme.ink; font.family: "Noto Sans"; font.pixelSize: 30; wrapMode: Text.WordWrap; lineHeight: 1.45; textFormat: Text.PlainText
                }
                Row {
                    id: lyricsRow; visible: kiosk.page === "lyrics"; width: parent.width; spacing: 56
                    property var fit: kiosk.page === "lyrics" ? kiosk.lyrics(kiosk.current.body || "", width, textScroll.height - 8) : ({})
                    Repeater {
                        model: lyricsRow.fit.columns || []
                        Text { required property string modelData; width: (lyricsRow.width - (lyricsRow.fit.columns.length - 1) * 56) / lyricsRow.fit.columns.length; text: modelData; font.family: "Noto Sans"; font.pixelSize: lyricsRow.fit.fontSize || 32; color: theme.ink; wrapMode: Text.WordWrap; lineHeight: 1.12; textFormat: Text.PlainText }
                    }
                }
            }
        }
        Item {
            id: connectPage; visible: kiosk.page === "connect"; x: 140; y: 205; width: 1320; height: 530
            Rectangle { width: 430; height: 430; radius: 28; color: "white"
                Image { anchors.fill: parent; anchors.margins: 20; source: "image://qr/" + encodeURIComponent(kiosk.remoteUrl); smooth: false }
            }
            Column { x: 510; y: 38; width: 740; spacing: 25
                Text { text: "MAKE YOURSELF COMFORTABLE"; color: theme.accent; font.family: "Noto Sans"; font.pixelSize: 15; font.letterSpacing: 3 }
                Text { width: parent.width; text: "Your phone is\nthe remote."; color: theme.ink; font.family: "Noto Sans"; font.pixelSize: 60; lineHeight: 1.1 }
                Text { width: parent.width; text: "Connect to the same Wi-Fi, then scan the code with your camera to explore the library."; color: theme.muted; font.family: "Noto Sans"; font.pixelSize: 28; wrapMode: Text.WordWrap; lineHeight: 1.3 }
                Text { width: parent.width; text: kiosk.remoteUrl; color: theme.accent; font.family: "Noto Sans"; font.pixelSize: 24; wrapMode: Text.WrapAnywhere }
            }
        }
        Item {
            id: playback; anchors.fill: parent; visible: scene.player
            // Controls fade out while a video plays, like YouTube, and come back on
            // any key, remote press or mouse movement. They stay up while paused,
            // loading or failed.
            property bool awake: true
            readonly property bool hold: !kiosk.playing || kiosk.mediaStatus !== "ready" || kiosk.mediaError.length > 0
            readonly property bool controlsShown: awake || hold
            function wake() { awake = true; idle.restart() }
            onHoldChanged: wake()
            onVisibleChanged: if (visible) wake()
            Timer { id: idle; interval: 3500; onTriggered: playback.awake = false }
            Connections { target: kiosk; function onPlayerActivity() { playback.wake() } }
            MouseArea { anchors.fill: parent; hoverEnabled: true; acceptedButtons: Qt.NoButton; onPositionChanged: playback.wake() }
            Rectangle { anchors.fill: parent; color: "#101b19"; visible: kiosk.mediaStatus !== "ready" || kiosk.mediaError.length > 0 }
            Column {
                anchors.centerIn: parent; width: 1080; spacing: 28; visible: kiosk.mediaStatus !== "ready" || kiosk.mediaError.length > 0
                Text { anchors.horizontalCenter: parent.horizontalCenter; text: kiosk.mediaError ? "Playback needs attention" : "Getting your video ready"; color: "#f1f0e8"; font.family: "Noto Sans"; font.pixelSize: 45; font.weight: Font.Medium }
                Text { width: parent.width; text: kiosk.mediaError || (kiosk.mediaStatus === "downloading" ? "Downloading a local copy · " + Math.round(kiosk.progress) + "%" : "Preparing a local copy for reliable playback."); horizontalAlignment: Text.AlignHCenter; color: "#a5b7aa"; font.family: "Noto Sans"; font.pixelSize: 26; wrapMode: Text.WordWrap }
                Rectangle { visible: !kiosk.mediaError; width: 700; height: 7; anchors.horizontalCenter: parent.horizontalCenter; radius: 4; color: "#34483e"; Rectangle { width: parent.width * kiosk.progress / 100; height: parent.height; color: "#b8d99c"; radius: 4 } }
                Text { visible: !!kiosk.mediaError; anchors.horizontalCenter: parent.horizontalCenter; text: "Press Select to retry, or Back to return to the library."; color: "#b8d99c"; font.family: "Noto Sans"; font.pixelSize: 22 }
            }
            Rectangle {
                x: 0; y: 0; width: parent.width; height: 133
                opacity: playback.controlsShown ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                gradient: Gradient { GradientStop { position: 0; color: "#dd08100d" } GradientStop { position: 1; color: "transparent" } }
                Text { x: 64; y: 44; width: parent.width - 300; text: kiosk.heading; color: "#f4f1e9"; font.family: "Noto Sans"; font.pixelSize: 30; elide: Text.ElideRight }
                Pill { anchors.right: parent.right; anchors.rightMargin: 64; y: 38; label: "← Back"; onClicked: kiosk.back() }
            }
            Rectangle {
                x: 0; y: parent.height - 150; width: parent.width; height: 150
                opacity: playback.controlsShown ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                gradient: Gradient { GradientStop { position: 0; color: "transparent" } GradientStop { position: 1; color: "#ee08100d" } }
                Rectangle { x: 64; y: 56; width: 1472; height: 4; radius: 2; color: "#60746a"; Rectangle { width: parent.width * (kiosk.duration > 0 ? kiosk.position / kiosk.duration : 0); height: 4; radius: 2; color: "#b8d99c" } }
                Row { x: 64; y: 82; spacing: 24
                    Pill { label: kiosk.playing ? "Ⅱ Pause" : "▷ Play"; onClicked: kiosk.action("select") }
                    Text { anchors.verticalCenter: parent.verticalCenter; text: kiosk.clockText(kiosk.position) + "  /  " + kiosk.clockText(kiosk.duration); color: "#f1f0e8"; font.family: "Noto Sans"; font.pixelSize: 20 }
                }
                Text { anchors.right: parent.right; anchors.rightMargin: 64; y: 98; text: "← →  Seek     ·     ↑ ↓  Volume " + Math.round(kiosk.volume * 100) + "%     ·     OK  Play / pause"; color: "#c0cfc3"; font.family: "Noto Sans"; font.pixelSize: 18 }
            }
        }
        Item {
            id: footer; visible: !scene.player; x: 64; y: 822; width: 1472; height: 50
            Row {
                anchors.verticalCenter: parent.verticalCenter; spacing: 14
                Text { text: "↑ ↓"; color: theme.accent; font.family: "Noto Sans"; font.pixelSize: 21 }
                Text { text: scene.reading ? (kiosk.page === "lyrics" ? "Scroll · ← → Change song" : "Scroll to read") : (kiosk.sectionType === "faq" ? "Questions · ← → Scroll answer" : "Navigate  ·  OK Select  ·  Back Return"); color: theme.muted; font.family: "Noto Sans"; font.pixelSize: 17 }
            }
            Row { anchors.right: parent.right; spacing: 12
                Pill { visible: !!kiosk.backgroundTitle; label: (kiosk.backgroundPlaying ? "Ⅱ  " : "♪  ") + kiosk.backgroundTitle.substring(0, 30); ink: theme.accent; fill: theme.panel; activeFill: theme.active; accent: theme.accent; focused: kiosk.focusedControl === "background"; onClicked: kiosk.activateControl("background") }
                Pill { label: "⌘  Phone remote"; ink: theme.ink; fill: theme.panel; activeFill: theme.active; accent: theme.accent; focused: kiosk.focusedControl === "remote"; onClicked: kiosk.activateControl("remote") }
            }
        }
        Connections {
            target: kiosk
            function onViewChanged() { scene.forceActiveFocus(); Qt.callLater(scene.reportScrollEdges) }
            function onResetScroll() { textScroll.contentY = 0; faqScroll.contentY = 0 }
            function onScrollRequested(direction) {
                var target = browse.faq ? faqScroll : textScroll
                target.contentY = Math.max(0, Math.min(target.contentHeight - target.height, target.contentY + direction * target.height * 0.7))
            }
        }
    }
}
