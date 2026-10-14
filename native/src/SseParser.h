#pragma once
#include <QByteArray>
#include <QList>

// Streaming SSE decoder. No event IDs are retained: remote key presses must
// never be replayed following a connection loss.
class SseParser {
public:
    QList<QByteArray> feed(const QByteArray &bytes);
    void reset();
private:
    QByteArray line_, data_;
    bool pendingCr_ = false;
    bool dropping_ = false;
    void finishLine(QList<QByteArray> &events);
};
