import QtQuick
import QtQuick.Window

Window {
    id: window
    width: 1600; height: 900
    visible: true
    visibility: startFullscreen ? Window.FullScreen : Window.Windowed
    title: "PiTV"
    color: theme.canvas

    // Bhakti House Design System (bhio-ui tokens.css): deep purple and gold on
    // warm cream, Parkinsans for display headings, Raleway for text, Font
    // Awesome for icons. The remote's focus is the brand's gold pill.
    QtObject {
        id: theme
        property bool dark: kiosk.config.dark === undefined || kiosk.config.dark
        readonly property color purple900: "#290849"
        readonly property color purple700: "#55185D"
        readonly property color gold600: "#ECB602"
        readonly property color yellow400: "#FFD524"
        readonly property color cream200: "#F0E8DC"
        readonly property color cream100: "#F5F0E8"
        readonly property color cream50: "#F8F4ED"
        readonly property color cream0: "#FFFBF1"
        // Light is the brand's cream page; dark is its deep purple, for quiet rooms.
        readonly property color canvas: dark ? "#1B0532" : cream100
        readonly property color panel: dark ? "#2A0A48" : cream0
        readonly property color line: dark ? "#43205F" : "#E4D8C8"
        readonly property color heading: dark ? cream0 : purple900
        readonly property color ink: dark ? "#EDE5EC" : "#4A4A4A"
        readonly property color muted: dark ? "#B4A3C2" : "#666666"
        // Small caps labels: gold reads on purple, but is too faint on cream.
        readonly property color label: dark ? gold600 : purple700
        readonly property color onGold: purple900
        // YouTube's live red, for streams on air now.
        readonly property color live: "#FF4E45"
        readonly property Gradient gold: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: theme.gold600 }
            GradientStop { position: 1; color: theme.yellow400 }
        }
        readonly property string display: brandFonts.display
        readonly property string body: brandFonts.body
        readonly property string icons: brandFonts.icons
    }

    component Label: Text { font.family: theme.body; color: theme.ink }
    component Heading: Text { font.family: theme.display; font.weight: Font.Bold; color: theme.heading }
    component Eyebrow: Text { font.family: theme.body; font.weight: Font.DemiBold; font.pixelSize: 13; font.letterSpacing: 2.5; color: theme.label }
    component Glyph: Text { font.family: theme.icons; font.weight: Font.Black; color: theme.gold600 }
    // The signature gold bar under a heading.
    component Underline: Rectangle { width: 72; height: 4; radius: 2; color: theme.gold600 }

    // A card or row; it fills with the gold gradient while it holds the remote's focus.
    component Surface: Rectangle {
        id: surface
        property bool focused: false
        radius: 15
        color: theme.panel
        border.width: focused ? 0 : 1
        border.color: theme.line
        Rectangle { anchors.fill: parent; radius: parent.radius; gradient: theme.gold; opacity: surface.focused ? 1 : 0; Behavior on opacity { NumberAnimation { duration: 110 } } }
    }

    // The brand's icon circle: a purple glyph on gold, inverted on a gold surface.
    component IconBadge: Rectangle {
        id: badge
        property string glyph
        property bool inverted: false
        width: 52; height: 52; radius: width / 2
        color: theme.purple900
        Rectangle { anchors.fill: parent; radius: parent.radius; gradient: theme.gold; visible: !badge.inverted }
        Glyph { anchors.centerIn: parent; text: badge.glyph; font.pixelSize: badge.width * 0.4; color: badge.inverted ? theme.gold600 : theme.purple900 }
    }

    // The brand pill (btn-brand): gold for the primary action or the remote's focus.
    component Pill: Rectangle {
        id: pill
        property string label
        property string glyph
        property bool focused: false
        property bool primary: false
        property color ink: theme.heading
        property color fill: theme.panel
        property color edge: theme.line
        readonly property bool lit: focused || primary
        signal clicked()
        width: pillRow.implicitWidth + 40; height: 48; radius: 24
        color: pillMouse.containsMouse && !lit ? Qt.tint(fill, "#22ECB602") : fill
        border.width: lit ? 0 : 1
        border.color: edge
        Rectangle { anchors.fill: parent; radius: parent.radius; gradient: theme.gold; opacity: pill.lit ? 1 : 0; Behavior on opacity { NumberAnimation { duration: 110 } } }
        Row {
            id: pillRow; anchors.centerIn: parent; spacing: 10
            Glyph { visible: pill.glyph.length > 0; anchors.verticalCenter: parent.verticalCenter; text: pill.glyph; font.pixelSize: 16; color: pill.lit ? theme.onGold : pill.ink }
            Label { anchors.verticalCenter: parent.verticalCenter; text: pill.label; font.pixelSize: 17; font.weight: Font.DemiBold; font.letterSpacing: 0.4; color: pill.lit ? theme.onGold : pill.ink }
        }
        MouseArea { id: pillMouse; anchors.fill: parent; hoverEnabled: true; onClicked: pill.clicked() }
    }

    // A key hint in the footer: an icon and what it does.
    component Hint: Row {
        property string glyph
        property string text
        property color tint: theme.muted
        spacing: 10
        Glyph { visible: parent.glyph.length > 0; anchors.verticalCenter: parent.verticalCenter; text: parent.glyph; font.pixelSize: 15 }
        Label { anchors.verticalCenter: parent.verticalCenter; text: parent.text; font.pixelSize: 17; color: parent.tint }
    }

    // One join step: a QR code and what scanning it does.
    component JoinStep: Row {
        id: joinStep
        property string step
        property string code
        property string title
        property string detail
        property string note
        property int qr: 108
        property real textScale: 1
        property color ink: theme.purple900
        property color muted: "#4A4A4A"
        property color label: theme.purple700
        // Put the code after the text, so two stacked steps never line their
        // codes up one above the other (a camera would catch both).
        property bool qrRight: false
        layoutDirection: qrRight ? Qt.RightToLeft : Qt.LeftToRight
        spacing: 18 * textScale
        Rectangle {
            width: joinStep.qr; height: joinStep.qr; radius: joinStep.qr / 11; color: "white"
            border.width: 1; border.color: "#E4D8C8"
            Image { anchors.fill: parent; anchors.margins: joinStep.qr / 22; source: "image://qr/" + encodeURIComponent(joinStep.code); smooth: false }
        }
        Column {
            anchors.verticalCenter: parent.verticalCenter; width: joinStep.width - joinStep.qr - joinStep.spacing; spacing: 5 * joinStep.textScale
            Row {
                spacing: 10 * joinStep.textScale
                Rectangle {
                    visible: joinStep.step.length > 0; width: 24 * joinStep.textScale; height: width; radius: width / 2; anchors.verticalCenter: parent.verticalCenter
                    gradient: theme.gold
                    Text { anchors.centerIn: parent; text: joinStep.step; color: theme.purple900; font.family: theme.display; font.weight: Font.Bold; font.pixelSize: 14 * joinStep.textScale }
                }
                Eyebrow { anchors.verticalCenter: parent.verticalCenter; text: joinStep.title.toUpperCase(); color: joinStep.label; font.pixelSize: 13 * joinStep.textScale; font.letterSpacing: 1.6 }
            }
            Heading { width: parent.width; text: joinStep.detail; color: joinStep.ink; font.pixelSize: 23 * joinStep.textScale; font.weight: Font.DemiBold; wrapMode: Text.WordWrap; maximumLineCount: 2; elide: Text.ElideRight }
            Label { width: parent.width; text: joinStep.note; color: joinStep.muted; font.pixelSize: 18 * joinStep.textScale; wrapMode: Text.Wrap; maximumLineCount: 2; elide: Text.ElideRight }
        }
    }

    // The video is drawn at the screen's own resolution, outside the scaled scene.
    // It stays in the scene, transparent, so mpv can draw the moment a video opens.
    Loader { id: video; anchors.fill: parent; active: videoEnabled; source: "VideoSurface.qml"; opacity: scene.player ? 1 : 0 }

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
        // Font Awesome 6 Free (solid) code points.
        function icon(type) { return ({articles:"", lyrics:"", media:"", catalog:"", faq:"", background:"", connect:""})[type] || "" }
        Keys.onPressed: function(event) {
            var key = ({16777234:"left",16777236:"right",16777235:"up",16777237:"down",16777220:"select",16777221:"select",32:"select",16777216:"back",16777219:"back",16777232:"home"})[event.key]
            if (key) { kiosk.action(key, scene.home ? 2 : 1); event.accepted = true }
            else if (event.key === Qt.Key_M) { kiosk.openBackground(); event.accepted = true }
            else if (event.key === Qt.Key_D) { kiosk.toggleDark(); event.accepted = true }
        }
        Rectangle { anchors.fill: parent; color: theme.canvas; visible: !scene.player }

        Item {
            id: header
            x: 64; y: 36; width: 1472; height: 84
            visible: !scene.player
            Row {
                anchors.verticalCenter: parent.verticalCenter; spacing: 18
                Image {
                    anchors.verticalCenter: parent.verticalCenter; height: 52; width: 85
                    source: theme.dark ? "assets/lotus-gold.png" : "assets/lotus-purple.png"
                    fillMode: Image.PreserveAspectFit; smooth: true; mipmap: true
                    MouseArea { anchors.fill: parent; onClicked: kiosk.home() }
                }
                Column {
                    anchors.verticalCenter: parent.verticalCenter; spacing: 5
                    Heading { text: kiosk.config.title || "PiTV"; font.pixelSize: 25; font.weight: Font.DemiBold }
                    Eyebrow { text: scene.home ? "A SPACE TO LEARN, REFLECT & CONNECT" : "LIBRARY  /  " + kiosk.heading.toUpperCase(); font.pixelSize: 12; font.letterSpacing: 2 }
                }
            }
            Row {
                anchors.right: remoteBadge.visible ? remoteBadge.left : parent.right; anchors.rightMargin: remoteBadge.visible ? 24 : 0
                anchors.verticalCenter: parent.verticalCenter; spacing: 12
                Pill { visible: !scene.home; glyph: ""; label: "Back"; focused: kiosk.focusedControl === "back"; onClicked: kiosk.activateControl("back") }
                Pill { glyph: theme.dark ? "" : ""; label: theme.dark ? "Light appearance" : "Dark appearance"; focused: kiosk.focusedControl === "theme"; onClicked: kiosk.activateControl("theme") }
                Item { width: 6; height: 1 }
                Rectangle { width: 10; height: 10; radius: 5; anchors.verticalCenter: parent.verticalCenter; color: kiosk.connected ? theme.gold600 : theme.muted }
                Label { anchors.verticalCenter: parent.verticalCenter; text: kiosk.connected ? "Connected" : "Local library"; color: theme.muted; font.pixelSize: 16 }
            }
            Rectangle {
                id: remoteBadge
                visible: !scene.home
                anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; width: 88; height: 88; radius: 10; color: "white"
                border.width: 2; border.color: theme.gold600
                Image { anchors.fill: parent; anchors.margins: 5; source: "image://qr/" + encodeURIComponent(kiosk.remoteUrl); smooth: false }
                MouseArea { anchors.fill: parent; onClicked: { kiosk.home(); kiosk.openIndex(kiosk.entries.length - 1) } }
            }
        }
        Item {
            id: homePage
            visible: scene.home
            x: 64; y: 144; width: 1472; height: 644
            Rectangle {
                width: 594; height: parent.height; radius: 20; color: theme.purple900; clip: true
                Image { anchors.fill: parent; source: kiosk.absoluteUrl(kiosk.config.hero || ""); fillMode: Image.PreserveAspectCrop; asynchronous: true; sourceSize.width: 1200; sourceSize.height: 1300 }
                // The brand's purple gradient, deep behind the text and the join card.
                Rectangle { anchors.fill: parent; gradient: Gradient { GradientStop { position: 0; color: "#EB290849" } GradientStop { position: 0.55; color: "#73290849" } GradientStop { position: 1; color: "#E0290849" } } }
                // Rounds the image's corners: a frame in the page colour whose inner
                // edge is the card's radius (Qt 6.4 has no clip-to-radius).
                Rectangle { anchors.fill: parent; anchors.margins: -20; radius: 40; color: "transparent"; border.width: 20; border.color: theme.canvas }
                Underline { x: 48; y: 44; width: 100 }
                Eyebrow { x: 48; y: 64; text: "WELCOME"; color: theme.gold600; font.pixelSize: 16; font.letterSpacing: 5 }
                Heading {
                    id: heroTitle; x: 48; y: 96; width: parent.width - 96
                    text: kiosk.config.title || "A little space\nfor inspiration."; color: theme.cream0; font.pixelSize: 42
                    wrapMode: Text.WordWrap; maximumLineCount: 2; elide: Text.ElideRight; lineHeight: 0.92
                }
                // The subtitle gets whatever room the join card leaves, in whole lines.
                Label {
                    x: 48; y: heroTitle.y + heroTitle.height + 12; width: parent.width - 96
                    readonly property int room: Math.floor((joinCard.y - 18 - y) / 31)
                    visible: room > 0
                    text: kiosk.config.subtitle || "Discover something meaningful.\nMake yourself at home."; color: "#E6FFFBF1"; font.pixelSize: 21
                    wrapMode: Text.WordWrap; maximumLineCount: Math.max(1, room); elide: Text.ElideRight; lineHeight: 1.2
                }
                // How a visitor gets the remote without navigating anywhere: join
                // the Wi-Fi (when the admin set one), then open the remote.
                Rectangle {
                    id: joinCard
                    x: 24; width: parent.width - 48; anchors.bottom: parent.bottom; anchors.bottomMargin: 24
                    // The brand's top-line card: a gold edge that follows the corners.
                    height: joinSteps.y + joinSteps.height + 22; radius: 15; color: theme.gold600
                    Rectangle { anchors.fill: parent; anchors.topMargin: 4; radius: 15; color: theme.cream50 }
                    Heading { x: 24; y: 20; text: "Use your phone as the remote"; color: theme.purple900; font.pixelSize: 21; font.weight: Font.DemiBold }
                    Column {
                        id: joinSteps; x: 24; y: 58; width: parent.width - 48; spacing: 14
                        JoinStep { width: parent.width; visible: kiosk.wifiCode.length > 0; step: "1"; code: kiosk.wifiCode; title: "Join the Wi-Fi"
                            detail: kiosk.config.wifi ? kiosk.config.wifi.ssid : ""
                            note: kiosk.config.wifi && kiosk.config.wifi.password ? "Password  " + kiosk.config.wifi.password : "No password needed" }
                        JoinStep { width: parent.width; step: kiosk.wifiCode.length > 0 ? "2" : ""; qrRight: kiosk.wifiCode.length > 0; code: kiosk.remoteUrl; title: "Open the remote"; detail: "Scan with your phone's camera"; note: kiosk.remoteUrl.replace(/^https?:\/\//, "") }
                    }
                }
            }
            Column {
                x: 638; width: parent.width - x; spacing: 12
                Heading { text: "Explore the library"; font.pixelSize: 30 }
                Underline {}
                Item { width: 1; height: 6 }
                GridView {
                    id: homeGrid
                    width: parent.width + 16; height: 560; clip: true
                    cellWidth: width / 2; cellHeight: 140
                    model: kiosk.entries
                    currentIndex: kiosk.selected
                    highlightMoveDuration: 0
                    onCurrentIndexChanged: positionViewAtIndex(currentIndex, GridView.Contain)
                    delegate: Item {
                        required property var modelData
                        required property int index
                        width: homeGrid.cellWidth; height: homeGrid.cellHeight
                        Surface {
                            id: tile
                            anchors.fill: parent; anchors.rightMargin: 16; anchors.bottomMargin: 16
                            focused: scene.contentFocus && kiosk.selected === index
                            IconBadge { x: 24; anchors.verticalCenter: parent.verticalCenter; glyph: scene.icon(modelData.type); inverted: tile.focused }
                            Column {
                                x: 94; anchors.verticalCenter: parent.verticalCenter; width: parent.width - 118; spacing: 8
                                Label { width: parent.width; text: scene.label(modelData); color: tile.focused ? theme.onGold : theme.heading; font.pixelSize: 23; font.weight: Font.DemiBold; elide: Text.ElideRight }
                                Eyebrow { text: scene.typeLabel(modelData.type); color: tile.focused ? theme.onGold : theme.muted; font.pixelSize: 11; font.letterSpacing: 1.6 }
                            }
                            MouseArea { anchors.fill: parent; onClicked: kiosk.openIndex(index) }
                        }
                    }
                }
            }
        }
        Item {
            id: browse
            visible: ["section", "category", "playlist", "channel", "background"].indexOf(kiosk.page) >= 0
            x: 64; y: 144; width: 1472; height: 644
            property bool faq: kiosk.sectionType === "faq" && kiosk.page === "section"
            Heading { text: kiosk.heading; font.pixelSize: 44; width: parent.width - 280; elide: Text.ElideRight }
            Underline { y: 62 }
            Label { anchors.right: parent.right; y: 18; text: kiosk.entries.length + (kiosk.entries.length === 1 ? " item" : " items"); color: theme.muted; font.pixelSize: 18 }
            ListView {
                id: itemList
                x: 0; y: 90; width: browse.faq ? 555 : 1472; height: 554
                clip: true; spacing: 12; model: kiosk.entries; currentIndex: kiosk.selected
                highlightMoveDuration: 0
                onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
                delegate: Surface {
                    id: row
                    required property var modelData
                    required property int index
                    width: itemList.width; height: browse.faq ? 108 : (kiosk.sectionType === "catalog" ? 128 : 102)
                    focused: scene.contentFocus && kiosk.selected === index
                    Heading { x: 26; anchors.verticalCenter: parent.verticalCenter; text: (index + 1).toString().padStart(2, "0"); color: row.focused ? theme.onGold : theme.muted; font.pixelSize: 20; font.weight: Font.Medium }
                    Column {
                        x: 81; anchors.verticalCenter: parent.verticalCenter; width: parent.width - 140; spacing: 8
                        Label { width: parent.width; text: scene.label(modelData); color: row.focused ? theme.onGold : theme.heading; font.pixelSize: browse.faq ? 23 : 27; font.weight: Font.DemiBold; wrapMode: Text.WordWrap; maximumLineCount: browse.faq ? 2 : 1; elide: Text.ElideRight }
                        // A video's length, "Playlist", "YouTube channel", or a live stream in red.
                        Label { visible: kiosk.sectionType === "catalog" || modelData.count !== undefined || modelData.detail !== undefined; width: parent.width
                            text: modelData.detail !== undefined ? modelData.detail : modelData.count !== undefined ? modelData.count + " videos & playlists" : (modelData.author || "") + (modelData.year ? " · " + modelData.year : "") + (modelData.category ? "  /  " + modelData.category : "")
                            color: row.focused ? theme.onGold : (modelData.live ? theme.live : theme.muted); font.pixelSize: 18; font.weight: modelData.live ? Font.DemiBold : Font.Normal; elide: Text.ElideRight }
                    }
                    Glyph { anchors.right: parent.right; anchors.rightMargin: 28; anchors.verticalCenter: parent.verticalCenter; text: ""; font.pixelSize: 20; color: row.focused ? theme.onGold : theme.gold600 }
                    MouseArea { anchors.fill: parent; onClicked: kiosk.openIndex(index) }
                }
            }
            Rectangle {
                visible: browse.faq; x: 589; y: 90; width: 883; height: 554; radius: 20; color: theme.panel
                border.width: 1; border.color: theme.line
                Flickable {
                    id: faqScroll
                    anchors.fill: parent; anchors.margins: 36; contentWidth: width; contentHeight: faqContent.height; clip: true; boundsBehavior: Flickable.StopAtBounds
                    Column {
                        id: faqContent; width: faqScroll.width; spacing: 24
                        Row {
                            width: parent.width; spacing: 26
                            Image { width: kiosk.current.cover_url ? 134 : 0; height: kiosk.current.cover_url ? 180 : 0; source: kiosk.absoluteUrl(kiosk.current.cover_url || ""); fillMode: Image.PreserveAspectFit; asynchronous: true; sourceSize.width: 268 }
                            Column { width: parent.width - (kiosk.current.cover_url ? 160 : 0); spacing: 12
                                Eyebrow { text: "FROM THE LIBRARY"; font.pixelSize: 12; font.letterSpacing: 2 }
                                Heading { width: parent.width; text: kiosk.current.book_title || "Select a question"; font.pixelSize: 31; font.weight: Font.DemiBold; wrapMode: Text.WordWrap }
                                Label { width: parent.width; text: kiosk.current.location || ""; color: theme.muted; font.pixelSize: 18; wrapMode: Text.WordWrap }
                            }
                        }
                        // The brand's callout: the passage with a gold rule beside it.
                        Item {
                            width: parent.width; height: quote.implicitHeight
                            Rectangle { width: 4; height: parent.height; radius: 2; color: theme.gold600 }
                            Label { id: quote; x: 26; width: parent.width - 26; text: kiosk.current.quote || ""; font.pixelSize: 28; wrapMode: Text.WordWrap; lineHeight: 1.4; textFormat: Text.PlainText }
                        }
                    }
                }
            }
            Label { visible: kiosk.entries.length === 0; x: 28; y: 142; width: parent.width - 56; text: kiosk.notice || "Nothing here yet. Add content from the phone editor."; color: theme.muted; font.pixelSize: 28; wrapMode: Text.WordWrap }
            Label { visible: kiosk.notice.length > 0 && kiosk.entries.length > 0; anchors.bottom: parent.bottom; anchors.right: parent.right; text: kiosk.notice; color: theme.label; font.pixelSize: 16 }
        }
        Item {
            id: reader
            visible: scene.reading
            x: 96; y: 142; width: 1408; height: 646
            Heading { id: readerTitle; width: parent.width; text: kiosk.heading; font.pixelSize: 38; elide: Text.ElideRight }
            Label { id: bookMeta; y: 60; width: parent.width; visible: kiosk.page === "book"; text: (kiosk.current.author || "") + (kiosk.current.year ? " · " + kiosk.current.year : "") + (kiosk.current.category ? "  /  " + kiosk.current.category : ""); color: theme.label; font.pixelSize: 22; font.weight: Font.DemiBold }
            Underline { y: kiosk.page === "book" ? 102 : 62 }
            Flickable {
                id: textScroll
                onAtYBeginningChanged: scene.reportScrollEdges()
                onAtYEndChanged: scene.reportScrollEdges()
                x: 0; y: kiosk.page === "book" ? 128 : 92; width: parent.width; height: parent.height - y
                contentWidth: width; contentHeight: kiosk.page === "lyrics" ? lyricsRow.height : article.implicitHeight
                clip: true; boundsBehavior: Flickable.StopAtBounds
                Label {
                    id: article; visible: kiosk.page !== "lyrics"; width: parent.width
                    text: kiosk.page === "book" ? (kiosk.current.description || "No description has been added.") : (kiosk.current.body || "")
                    font.pixelSize: 30; wrapMode: Text.WordWrap; lineHeight: 1.5; textFormat: Text.PlainText
                }
                Row {
                    id: lyricsRow; visible: kiosk.page === "lyrics"; width: parent.width; spacing: 56
                    property var fit: kiosk.page === "lyrics" ? kiosk.lyrics(kiosk.current.body || "", width, textScroll.height - 8) : ({})
                    Repeater {
                        model: lyricsRow.fit.columns || []
                        Label { required property string modelData; width: (lyricsRow.width - (lyricsRow.fit.columns.length - 1) * 56) / lyricsRow.fit.columns.length; text: modelData; font.pixelSize: lyricsRow.fit.fontSize || 32; wrapMode: Text.WordWrap; lineHeight: 1.12; textFormat: Text.PlainText }
                    }
                }
            }
        }
        Item {
            id: connectPage; visible: kiosk.page === "connect"; x: 140; y: 205; width: 1320; height: 530
            property bool wifi: kiosk.wifiCode.length > 0
            // With guest Wi-Fi set, the page walks through both steps at full size.
            Column {
                visible: connectPage.wifi; y: -40; width: parent.width; spacing: 44
                Column { spacing: 14
                    Eyebrow { text: "MAKE YOURSELF COMFORTABLE"; font.pixelSize: 15; font.letterSpacing: 3 }
                    Heading { text: "Your phone is the remote."; font.pixelSize: 56 }
                    Underline {}
                }
                Row { spacing: 44
                    Repeater {
                        model: 2
                        JoinStep {
                            required property int index
                            width: 638; qr: 280; textScale: 1.5; ink: theme.heading; muted: theme.ink; label: theme.label; step: String(index + 1)
                            code: index === 0 ? kiosk.wifiCode : kiosk.remoteUrl
                            title: index === 0 ? "Join the Wi-Fi" : "Open the remote"
                            detail: index === 0 ? (kiosk.config.wifi ? kiosk.config.wifi.ssid : "") : "Scan with your phone's camera"
                            note: index === 0 ? (kiosk.config.wifi && kiosk.config.wifi.password ? "Password  " + kiosk.config.wifi.password : "No password needed") : kiosk.remoteUrl.replace(/^https?:\/\//, "")
                        }
                    }
                }
            }
            Rectangle { visible: !connectPage.wifi; width: 430; height: 430; radius: 28; color: "white"; border.width: 3; border.color: theme.gold600
                Image { anchors.fill: parent; anchors.margins: 20; source: "image://qr/" + encodeURIComponent(kiosk.remoteUrl); smooth: false }
            }
            Column { visible: !connectPage.wifi; x: 510; y: 38; width: 740; spacing: 25
                Eyebrow { text: "MAKE YOURSELF COMFORTABLE"; font.pixelSize: 15; font.letterSpacing: 3 }
                Heading { width: parent.width; text: "Your phone is\nthe remote."; font.pixelSize: 60; lineHeight: 1.1 }
                Label { width: parent.width; text: "Connect to the same Wi-Fi, then scan the code with your camera to explore the library."; color: theme.muted; font.pixelSize: 28; wrapMode: Text.WordWrap; lineHeight: 1.3 }
                Label { width: parent.width; text: kiosk.remoteUrl; color: theme.label; font.pixelSize: 24; font.weight: Font.DemiBold; wrapMode: Text.WrapAnywhere }
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
            Rectangle { anchors.fill: parent; color: "#1B0532"; visible: kiosk.mediaStatus !== "ready" || kiosk.mediaError.length > 0 }
            Column {
                anchors.centerIn: parent; width: 1080; spacing: 28; visible: kiosk.mediaStatus !== "ready" || kiosk.mediaError.length > 0
                Heading { anchors.horizontalCenter: parent.horizontalCenter; text: kiosk.mediaStatus === "offair" ? "Not live right now" : kiosk.mediaError ? "Playback needs attention" : "Getting your video ready"; color: theme.cream0; font.pixelSize: 44 }
                Label { width: parent.width; text: kiosk.mediaError || (kiosk.mediaStatus === "resolving" ? "Finding the video on YouTube…" : "Starting the video…"); horizontalAlignment: Text.AlignHCenter; color: "#B4A3C2"; font.pixelSize: 26; wrapMode: Text.WordWrap }
                // A gold band sweeps along while the video starts.
                Rectangle { id: track; visible: !kiosk.mediaError; width: 700; height: 8; anchors.horizontalCenter: parent.horizontalCenter; radius: 4; color: "#43205F"; clip: true
                    Rectangle { id: sweep; x: -width; width: 180; height: parent.height; radius: 4; gradient: theme.gold }
                    NumberAnimation { target: sweep; property: "x"; from: -sweep.width; to: track.width; duration: 1400; loops: Animation.Infinite; easing.type: Easing.InOutQuad
                        running: kiosk.page === "player" && kiosk.mediaStatus !== "ready" && !kiosk.mediaError } }
                Label { visible: !!kiosk.mediaError; anchors.horizontalCenter: parent.horizontalCenter; text: kiosk.mediaStatus === "offair" ? "Press Select to check again, or Back to return to the library." : "Press Select to retry, or Back to return to the library."; color: theme.gold600; font.pixelSize: 22 }
            }
            // Over a playing video: waiting for the network, or reconnecting.
            Rectangle {
                anchors.centerIn: parent; height: 64; width: note.implicitWidth + 72; radius: 32; color: "#D9160428"
                visible: kiosk.mediaStatus === "ready" && kiosk.mediaNote.length > 0 && !kiosk.mediaError
                Label { id: note; anchors.centerIn: parent; text: kiosk.mediaNote; color: theme.cream0; font.pixelSize: 24; font.weight: Font.Medium }
            }
            Rectangle {
                x: 0; y: 0; width: parent.width; height: 140
                opacity: playback.controlsShown ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                gradient: Gradient { GradientStop { position: 0; color: "#E6160428" } GradientStop { position: 1; color: "transparent" } }
                Heading { x: 64; y: 44; width: parent.width - 300; text: kiosk.heading; color: theme.cream0; font.pixelSize: 30; font.weight: Font.DemiBold; elide: Text.ElideRight }
                Pill { anchors.right: parent.right; anchors.rightMargin: 64; y: 36; glyph: ""; label: "Back"; ink: theme.cream0; fill: "#40160428"; edge: "#59FFFBF1"; onClicked: kiosk.back() }
            }
            Rectangle {
                x: 0; y: parent.height - 160; width: parent.width; height: 160
                opacity: playback.controlsShown ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                gradient: Gradient { GradientStop { position: 0; color: "transparent" } GradientStop { position: 1; color: "#F0160428" } }
                Rectangle { visible: !kiosk.live; x: 64; y: 62; width: 1472; height: 5; radius: 3; color: "#4DFFFBF1"
                    Rectangle { width: parent.width * (kiosk.duration > 0 ? kiosk.position / kiosk.duration : 0); height: parent.height; radius: 3; gradient: theme.gold } }
                Row { x: 64; y: 90; spacing: 24
                    Pill { primary: true; glyph: kiosk.playing ? "" : ""; label: kiosk.playing ? "Pause" : "Play"; onClicked: kiosk.action("select") }
                    Label { visible: !kiosk.live; anchors.verticalCenter: parent.verticalCenter; text: kiosk.clockText(kiosk.position) + "  /  " + kiosk.clockText(kiosk.duration); color: theme.cream0; font.pixelSize: 20; font.weight: Font.Medium }
                    // A live stream has no length: a red LIVE badge instead.
                    Rectangle { visible: kiosk.live; anchors.verticalCenter: parent.verticalCenter; width: liveLabel.implicitWidth + 28; height: 32; radius: 6; color: theme.live
                        Label { id: liveLabel; anchors.centerIn: parent; text: "LIVE"; color: "white"; font.pixelSize: 17; font.weight: Font.Bold; font.letterSpacing: 1.5 } }
                }
                Row { anchors.right: parent.right; anchors.rightMargin: 64; y: 102; spacing: 30
                    Hint { glyph: ""; text: "Seek"; tint: "#D9FFFBF1" }
                    Hint { glyph: ""; text: kiosk.volumeText; tint: "#D9FFFBF1" }
                    Hint { glyph: ""; text: "OK  Play / pause"; tint: "#D9FFFBF1" }
                }
            }
        }
        Item {
            id: footer; visible: !scene.player; x: 64; y: 818; width: 1472; height: 56
            Row {
                anchors.verticalCenter: parent.verticalCenter; spacing: 30
                Hint { glyph: ""; text: scene.reading ? (kiosk.page === "lyrics" ? "Scroll" : "Scroll to read") : (kiosk.sectionType === "faq" && kiosk.page === "section" ? "Questions" : "Navigate") }
                Hint { visible: kiosk.page === "lyrics" || (kiosk.sectionType === "faq" && kiosk.page === "section"); glyph: ""; text: kiosk.page === "lyrics" ? "Change song" : "Scroll answer" }
                Hint { visible: !scene.reading && !(kiosk.sectionType === "faq" && kiosk.page === "section"); text: "OK  Select" }
                Hint { visible: !scene.home; text: "Back  Return" }
            }
            Row { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; spacing: 12
                Pill { visible: !!kiosk.backgroundTitle; glyph: kiosk.backgroundPlaying ? "" : ""; label: kiosk.backgroundTitle.substring(0, 30); focused: kiosk.focusedControl === "background"; onClicked: kiosk.activateControl("background") }
                Pill { glyph: ""; label: "Phone remote"; focused: kiosk.focusedControl === "remote"; onClicked: kiosk.activateControl("remote") }
            }
        }
        // The colour check (admin page, System, Picture): the brand colours and grey
        // steps next to black and white, for judging the TV's colour range and
        // picture settings. Any button closes it.
        Rectangle {
            id: colourCheck
            anchors.fill: parent; visible: kiosk.colourCheck; color: "black"
            MouseArea { anchors.fill: parent; onClicked: kiosk.showColourCheck(false) }
            Heading { x: 80; y: 52; text: "Colour check"; color: theme.cream0; font.pixelSize: 40 }
            Label { anchors.right: parent.right; anchors.rightMargin: 80; y: 66; text: "Press any button to close"; color: "#B4A3C2"; font.pixelSize: 20 }
            Row {
                x: 80; y: 132; spacing: 24
                Repeater {
                    model: [{ name: "Night purple", value: "#1B0532" }, { name: "Purple", value: "#290849" }, { name: "Plum", value: "#55185D" },
                            { name: "Gold", value: "#ECB602" }, { name: "Cream", value: "#F5F0E8" }, { name: "White", value: "#FFFFFF" }]
                    Column {
                        spacing: 8
                        Rectangle { width: 220; height: 170; radius: 12; color: modelData.value; border.width: 1; border.color: "#3A3A3A" }
                        Label { text: modelData.name; color: theme.cream0; font.pixelSize: 20; font.weight: Font.DemiBold }
                        Label { text: modelData.value; color: "#8C8C8C"; font.pixelSize: 16 }
                    }
                }
            }
            Repeater {
                model: [{ title: "NEXT TO BLACK", steps: [0, 8, 16, 24, 32, 40, 48, 56] }, { title: "NEXT TO WHITE", steps: [199, 207, 215, 223, 231, 239, 247, 255] }]
                Column {
                    x: 80 + index * 736; y: 418; spacing: 12
                    Eyebrow { text: modelData.title; color: theme.gold600 }
                    Row {
                        Repeater {
                            model: modelData.steps
                            Rectangle { width: 88; height: 110; color: Qt.rgba(modelData / 255, modelData / 255, modelData / 255, 1) }
                        }
                    }
                    Row {
                        Repeater {
                            model: modelData.steps.length
                            Text { width: 88; horizontalAlignment: Text.AlignHCenter; text: index + 1; color: "#8C8C8C"; font.family: theme.display; font.pixelSize: 16 }
                        }
                    }
                }
            }
            Column {
                x: 80; y: 640; width: 1440; spacing: 14
                Label { width: parent.width; text: "Every grey square should look a little different from the next, the first one black and the last one white. Cream should look warmer than white."; color: theme.cream0; font.pixelSize: 23; wrapMode: Text.WordWrap; lineHeight: 1.25 }
                Label { width: parent.width; text: "Bright squares merging into one white, and cream looking white: try the Limited colour range. The first square grey rather than black, and colours faded: try Full. Both fine but purple still looks blue: set the TV's colour temperature to Normal or Warm."; color: "#B4A3C2"; font.pixelSize: 20; wrapMode: Text.WordWrap; lineHeight: 1.3 }
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
