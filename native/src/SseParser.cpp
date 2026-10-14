#include "SseParser.h"

void SseParser::reset() { line_.clear(); data_.clear(); pendingCr_ = false; dropping_ = false; }

void SseParser::finishLine(QList<QByteArray> &events) {
    if (line_.isEmpty()) {
        if (!dropping_ && !data_.isEmpty()) {
            data_.chop(1);
            events.append(data_);
        }
        data_.clear();
        dropping_ = false;
    } else if (!dropping_ && (line_ == "data" || line_.startsWith("data:"))) {
        QByteArray value = line_.mid(5);
        if (value.startsWith(' ')) value.remove(0, 1);
        data_ += value + '\n';
        if (data_.size() > 1024 * 1024) { data_.clear(); dropping_ = true; }
    }
    line_.clear();
}

QList<QByteArray> SseParser::feed(const QByteArray &bytes) {
    QList<QByteArray> events;
    for (char ch : bytes) {
        if (pendingCr_) { pendingCr_ = false; if (ch == '\n') continue; }
        if (ch == '\r' || ch == '\n') {
            finishLine(events);
            pendingCr_ = ch == '\r';
        } else {
            line_ += ch;
            if (line_.size() > 1024 * 1024) { line_.clear(); data_.clear(); dropping_ = true; }
        }
    }
    return events;
}
