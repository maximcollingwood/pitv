import QtQuick

Rectangle {
    id: control
    property string label
    property color ink: "#f0eee7"
    property color fill: "#27362f"
    signal clicked()
    width: caption.implicitWidth + 32
    height: 46
    radius: 23
    color: mouse.containsMouse ? Qt.lighter(fill, 1.25) : fill
    Text { id: caption; anchors.centerIn: parent; text: control.label; color: control.ink; font.family: "Noto Sans"; font.pixelSize: 17; font.weight: Font.Medium }
    MouseArea { id: mouse; anchors.fill: parent; hoverEnabled: true; onClicked: control.clicked() }
}
