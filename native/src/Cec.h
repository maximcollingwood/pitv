#pragma once
#include <QByteArray>
#include <QObject>
#include <functional>

class QSocketNotifier;

// HDMI-CEC as a playback device, the way TV boxes use it: follow the TV's power,
// take the TV remote's buttons, and turn the TV on and switch it to us (One Touch
// Play). The kernel answers the identity queries (name, address, version).
// Without a CEC adapter, as in the development VM, it stays inactive.
class Cec final : public QObject {
    Q_OBJECT
public:
    explicit Cec(QObject *parent = nullptr);
    ~Cec() override;
    bool open(const QString &device);
    // Tests feed received frames to handle() and capture what would be sent.
    void handle(const QByteArray &frame);
    void simulate(quint8 logical, quint16 physical, std::function<void(const QByteArray &)> send);
public slots:
    void oneTouchPlay();
    void standbyTv();
    // Our own power state, reported to a TV that asks.
    void setAsleep(bool asleep) { asleep_ = asleep; }
signals:
    void key(const QString &action);
    void tvStandby();
    // started: the TV announced itself, as it does when it powers on.
    void tvOn(bool started);
private:
    int fd_ = -1;
    QSocketNotifier *messages_ = nullptr, *events_ = nullptr;
    quint8 logical_ = 15;
    quint16 physical_ = 0xffff;
    bool active_ = true, asleep_ = false;
    std::function<void(const QByteArray &)> send_;
    void transmit(quint8 to, const QByteArray &body);
    void announce();
    void receive();
    void dequeueEvents();
    void readAddresses();
};
