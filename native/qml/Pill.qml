import QtQuick

Rectangle {
    id: control
    property string label
    property color ink: "#f0eee7"
    property color fill: "#27362f"
    // Remote focus mirrors the tiles' selected state.
    property bool focused: false
    property color activeFill: "#29483a"
    property color accent: "#b8d99c"
    signal clicked()
    width: caption.implicitWidth + 32
    height: 46
    radius: 23
    color: focused ? activeFill : mouse.containsMouse ? Qt.lighter(fill, 1.25) : fill
    border.width: focused ? 2 : 0
    border.color: accent
    Behavior on color { ColorAnimation { duration: 100 } }
    Text { id: caption; anchors.centerIn: parent; text: control.label; color: control.ink; font.family: "Noto Sans"; font.pixelSize: 17; font.weight: Font.Medium }
    MouseArea { id: mouse; anchors.fill: parent; hoverEnabled: true; onClicked: control.clicked() }
}
