#pragma once
#include <QQuickImageProvider>
#include <QUrl>
#include <qrencode.h>

class QrProvider final : public QQuickImageProvider {
public:
    QrProvider() : QQuickImageProvider(QQuickImageProvider::Image) {}
    QImage requestImage(const QString &id, QSize *size, const QSize &) override {
        const auto bytes = QUrl::fromPercentEncoding(id.toUtf8()).toUtf8();
        QRcode *qr = QRcode_encodeString8bit(bytes.constData(), 0, QR_ECLEVEL_M);
        if (!qr) return {};
        const int quiet = 4, scale = 6, side = (qr->width + quiet * 2) * scale;
        QImage result(side, side, QImage::Format_RGB32);
        result.fill(Qt::white);
        for (int y = 0; y < qr->width; ++y)
            for (int x = 0; x < qr->width; ++x)
                if (qr->data[y * qr->width + x] & 1)
                    for (int yy = 0; yy < scale; ++yy)
                        for (int xx = 0; xx < scale; ++xx)
                            result.setPixel((x + quiet) * scale + xx, (y + quiet) * scale + yy, qRgb(15, 23, 32));
        QRcode_free(qr);
        if (size) *size = result.size();
        return result;
    }
};
