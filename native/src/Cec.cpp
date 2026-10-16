#include "Cec.h"
#include <QDebug>
#include <QSocketNotifier>
#include <algorithm>
#include <cstring>
#include <initializer_list>
#include <fcntl.h>
#include <linux/cec.h>
#include <sys/ioctl.h>
#include <unistd.h>

namespace {
constexpr quint8 Tv = 0, Broadcast = 15;
const char *OsdName = "PiTV";

QByteArray bytes(std::initializer_list<quint8> values) {
    QByteArray out;
    for (auto value : values) out.append(char(value));
    return out;
}

// The TV remote's buttons (CEC user control codes) as PiTV remote actions.
QString keyAction(quint8 command) {
    switch (command) {
    case 0x00: return "select";
    case 0x01: return "up";
    case 0x02: return "down";
    case 0x03: return "left";
    case 0x04: return "right";
    case 0x09: case 0x0b: return "home";        // root menu, contents menu
    case 0x0d: return "back";
    case 0x44: case 0x60: return "play";        // play, play function
    case 0x46: return "pause";
    case 0x61: return "playpause";              // pause-play function
    case 0x45: case 0x64: return "stop";        // stop, stop function
    case 0x48: case 0x4c: return "rewind";      // rewind, skip backward
    case 0x49: case 0x4b: return "forward";     // fast forward, skip forward
    default: return {};
    }
}
// Directed messages that answer a question rather than ask one get no Feature Abort.
bool isReport(quint8 opcode) {
    switch (opcode) {
    case CEC_MSG_FEATURE_ABORT: case CEC_MSG_REPORT_POWER_STATUS: case CEC_MSG_CEC_VERSION:
    case CEC_MSG_SET_OSD_NAME: case CEC_MSG_MENU_STATUS: case CEC_MSG_DECK_STATUS:
    case CEC_MSG_REPORT_AUDIO_STATUS: case CEC_MSG_TUNER_DEVICE_STATUS:
        return true;
    default: return false;
    }
}
}

Cec::Cec(QObject *parent) : QObject(parent) {}
Cec::~Cec() { if (fd_ >= 0) ::close(fd_); }

bool Cec::open(const QString &device) {
    fd_ = ::open(device.toLocal8Bit().constData(), O_RDWR | O_NONBLOCK | O_CLOEXEC);
    if (fd_ < 0) return false;
    cec_caps caps{};
    if (ioctl(fd_, CEC_ADAP_G_CAPS, &caps) < 0 || !(caps.capabilities & CEC_CAP_LOG_ADDRS) || !(caps.capabilities & CEC_CAP_TRANSMIT)) {
        qWarning().noquote() << "CEC:" << device << "cannot act as a playback device";
        ::close(fd_); fd_ = -1; return false;
    }
    // Claim a playback address unless it is already ours. The TV routes its
    // remote's buttons to us as messages; the kernel's own translation into
    // key presses stays off, so no button arrives twice.
    cec_log_addrs current{};
    ioctl(fd_, CEC_ADAP_G_LOG_ADDRS, &current);
    if (current.num_log_addrs != 1 || current.log_addr_type[0] != CEC_LOG_ADDR_TYPE_PLAYBACK || std::strcmp(current.osd_name, OsdName)
        || current.cec_version != CEC_OP_CEC_VERSION_1_4 || (current.flags & CEC_LOG_ADDRS_FL_ALLOW_RC_PASSTHRU)) {
        cec_log_addrs none{};
        ioctl(fd_, CEC_ADAP_S_LOG_ADDRS, &none);
        cec_log_addrs playback{};
        playback.cec_version = CEC_OP_CEC_VERSION_1_4; // what the library's Vizio speaks
        playback.num_log_addrs = 1;
        playback.vendor_id = CEC_VENDOR_ID_NONE;
        std::strncpy(playback.osd_name, OsdName, sizeof playback.osd_name - 1);
        playback.primary_device_type[0] = CEC_OP_PRIM_DEVTYPE_PLAYBACK;
        playback.log_addr_type[0] = CEC_LOG_ADDR_TYPE_PLAYBACK;
        playback.all_device_types[0] = CEC_OP_ALL_DEVTYPE_PLAYBACK;
        if (ioctl(fd_, CEC_ADAP_S_LOG_ADDRS, &playback) < 0) qWarning().noquote() << "CEC: could not claim a playback address:" << std::strerror(errno);
    }
    __u32 mode = CEC_MODE_INITIATOR | CEC_MODE_FOLLOWER;
    if (ioctl(fd_, CEC_S_MODE, &mode) < 0) {
        qWarning().noquote() << "CEC: could not follow messages:" << std::strerror(errno);
        ::close(fd_); fd_ = -1; return false;
    }
    readAddresses();
    messages_ = new QSocketNotifier(fd_, QSocketNotifier::Read, this);
    connect(messages_, &QSocketNotifier::activated, this, &Cec::receive);
    events_ = new QSocketNotifier(fd_, QSocketNotifier::Exception, this);
    connect(events_, &QSocketNotifier::activated, this, &Cec::dequeueEvents);
    qInfo().noquote() << "CEC: playback device on" << device;
    return true;
}
void Cec::simulate(quint8 logical, quint16 physical, std::function<void(const QByteArray &)> send) {
    logical_ = logical; physical_ = physical; send_ = std::move(send);
}
void Cec::readAddresses() {
    __u16 physical = CEC_PHYS_ADDR_INVALID;
    if (ioctl(fd_, CEC_ADAP_G_PHYS_ADDR, &physical) == 0) physical_ = physical;
    cec_log_addrs addresses{};
    if (ioctl(fd_, CEC_ADAP_G_LOG_ADDRS, &addresses) == 0)
        logical_ = addresses.num_log_addrs && addresses.log_addr[0] != CEC_LOG_ADDR_INVALID ? addresses.log_addr[0] : Broadcast;
}
void Cec::receive() {
    for (;;) {
        cec_msg msg{};
        if (ioctl(fd_, CEC_RECEIVE, &msg) < 0) return; // EAGAIN: nothing more queued
        if (msg.tx_status) { // the outcome of one of our own transmits
            if (!(msg.tx_status & CEC_TX_STATUS_OK)) qWarning().noquote() << QString("CEC: message 0x%1 was not delivered").arg(msg.len > 1 ? msg.msg[1] : 0, 2, 16, QChar('0'));
            continue;
        }
        if (msg.rx_status & CEC_RX_STATUS_OK) handle(QByteArray(reinterpret_cast<const char *>(msg.msg), int(msg.len)));
    }
}
void Cec::dequeueEvents() {
    cec_event event{};
    while (ioctl(fd_, CEC_DQEVENT, &event) == 0)
        if (event.event == CEC_EVENT_STATE_CHANGE) readAddresses();
}
void Cec::transmit(quint8 to, const QByteArray &body) {
    QByteArray frame(1, char((logical_ << 4) | to));
    frame += body;
    if (send_) { send_(frame); return; }
    if (fd_ < 0 || logical_ == Broadcast) return;
    cec_msg msg{};
    msg.len = __u32(std::min<qsizetype>(frame.size(), CEC_MAX_MSG_SIZE));
    std::memcpy(msg.msg, frame.constData(), msg.len);
    if (ioctl(fd_, CEC_TRANSMIT, &msg) < 0) qWarning().noquote() << "CEC: could not send:" << std::strerror(errno);
}
void Cec::announce() {
    transmit(Broadcast, bytes({CEC_MSG_ACTIVE_SOURCE, quint8(physical_ >> 8), quint8(physical_ & 0xff)}));
}
void Cec::oneTouchPlay() {
    active_ = true;
    transmit(Tv, bytes({CEC_MSG_IMAGE_VIEW_ON}));
    announce();
}
void Cec::standbyTv() { transmit(Tv, bytes({CEC_MSG_STANDBY})); }
void Cec::handle(const QByteArray &frame) {
    if (frame.size() < 2) return; // a poll
    const quint8 from = quint8(frame[0]) >> 4, to = quint8(frame[0]) & 0xf, opcode = quint8(frame[1]);
    const bool broadcast = to == Broadcast;
    const auto address = [&frame](int at) { return frame.size() >= at + 2 ? quint16(quint8(frame[at]) << 8 | quint8(frame[at + 1])) : quint16(0xffff); };
    // The TV moved to an input: ours makes us the active source, any other does not.
    const auto routedTo = [this](quint16 path) {
        active_ = path == physical_;
        if (!active_) return;
        announce(); emit tvOn(false);
    };
    switch (opcode) {
    case CEC_MSG_STANDBY:
        qInfo() << "CEC: the TV went to standby";
        emit tvStandby(); break;
    case CEC_MSG_REPORT_PHYSICAL_ADDR:
        // The TV announces itself when it powers on (a TV in standby still answers
        // power queries with "on", so asking is no use).
        if (from == Tv && broadcast) { qInfo() << "CEC: the TV announced itself"; emit tvOn(true); }
        break;
    case CEC_MSG_REQUEST_ACTIVE_SOURCE:
        if (active_) announce();
        break;
    case CEC_MSG_SET_STREAM_PATH: routedTo(address(2)); break;
    case CEC_MSG_ROUTING_CHANGE: routedTo(address(4)); break;
    case CEC_MSG_ROUTING_INFORMATION: routedTo(address(2)); break;
    case CEC_MSG_ACTIVE_SOURCE:
        if (address(2) != physical_) active_ = false;
        break;
    case CEC_MSG_GIVE_DEVICE_POWER_STATUS:
        if (!broadcast) transmit(from, bytes({CEC_MSG_REPORT_POWER_STATUS, quint8(asleep_ ? CEC_OP_POWER_STATUS_STANDBY : CEC_OP_POWER_STATUS_ON)}));
        break;
    case CEC_MSG_MENU_REQUEST:
        // Some TVs pass their remote's buttons on only to a device whose menu is active.
        if (!broadcast) transmit(from, bytes({CEC_MSG_MENU_STATUS, CEC_OP_MENU_STATE_ACTIVATED}));
        break;
    case CEC_MSG_USER_CONTROL_PRESSED:
        if (broadcast || frame.size() < 3) break;
        emit tvOn(false); // a button reached us, so the TV is on
        if (const auto action = keyAction(quint8(frame[2])); !action.isEmpty()) emit key(action);
        break;
    case CEC_MSG_USER_CONTROL_RELEASED: break;
    case CEC_MSG_PLAY:
        if (!broadcast && frame.size() >= 3) emit key(quint8(frame[2]) == CEC_OP_PLAY_MODE_PLAY_STILL ? "pause" : "play");
        break;
    case CEC_MSG_DECK_CONTROL:
        if (broadcast || frame.size() < 3) break;
        if (quint8(frame[2]) == CEC_OP_DECK_CTL_MODE_SKIP_FWD) emit key("forward");
        else if (quint8(frame[2]) == CEC_OP_DECK_CTL_MODE_SKIP_REV) emit key("rewind");
        else if (quint8(frame[2]) == CEC_OP_DECK_CTL_MODE_STOP) emit key("stop");
        break;
    default:
        if (!broadcast && to == logical_ && !isReport(opcode))
            transmit(from, bytes({CEC_MSG_FEATURE_ABORT, opcode, CEC_OP_ABORT_UNRECOGNIZED_OP}));
    }
}
