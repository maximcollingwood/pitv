#include "LyricsLayout.h"
#include <QFont>
#include <QRegularExpression>
#include <QTextLayout>
#include <QtMath>
#include <algorithm>

namespace {
qreal textHeight(const QString &text, qreal width, int pixels) {
    QFont font(QStringLiteral("Noto Sans"));
    font.setPixelSize(pixels);
    QTextLayout layout(text, font);
    QTextOption option;
    option.setWrapMode(QTextOption::WrapAtWordBoundaryOrAnywhere);
    layout.setTextOption(option);
    layout.beginLayout();
    qreal height = 0;
    for (;;) {
        auto line = layout.createLine();
        if (!line.isValid()) break;
        line.setLineWidth(width);
        height += line.height() * 1.12;
    }
    layout.endLayout();
    return height;
}
qreal verseHeight(const QString &verse, qreal width, int pixels) {
    qreal total = 0;
    for (const auto &line : verse.split('\n')) total += textHeight(line.isEmpty() ? " " : line, width, pixels);
    return total;
}
}

QVariantMap fitLyrics(const QString &body, qreal width, qreal height, qreal maxFont) {
    QString cleaned = body;
    cleaned.replace("\r", "");
    const auto verses = cleaned.trimmed().split(QRegularExpression("\n\\s*\n"), Qt::SkipEmptyParts);
    if (verses.isEmpty() || width <= 0 || height <= 0)
        return {{"fontSize", 32}, {"columns", QStringList{cleaned}}, {"overflow", false}};
    int bestFont = 13, bestSplit = 0;
    qreal bestHeight = 0;
    for (int columns = 1; columns <= std::min(2, int(verses.size())); ++columns) {
        int lo = 14, hi = qMax(14, int(maxFont)), winning = 0;
        qreal winningHeight = 0;
        while (lo <= hi) {
            int size = (lo + hi) / 2;
            const qreal columnWidth = (width - (columns - 1) * 56) / columns;
            // QML renders two newlines between verses, including a complete
            // blank text line. Measure that same line rather than a guessed gap.
            const qreal gap = verseHeight(" ", columnWidth, size);
            QList<qreal> prefix{0};
            for (const auto &verse : verses)
                prefix << prefix.last() + verseHeight(verse.trimmed(), columnWidth, size) + gap;
            qreal candidateHeight = prefix.last() - gap;
            int split = 0;
            if (columns == 2) {
                candidateHeight = 1e10;
                for (int i = 1; i < verses.size(); ++i) {
                    qreal tallest = qMax(prefix[i], prefix.last() - prefix[i]) - gap;
                    if (tallest < candidateHeight) { candidateHeight = tallest; split = i; }
                }
            }
            if (candidateHeight <= height) {
                winning = split; winningHeight = candidateHeight;
                if (size > bestFont) { bestFont = size; bestSplit = winning; bestHeight = winningHeight; }
                lo = size + 1;
            } else hi = size - 1;
        }
    }
    if (bestFont < 14) {
        // Extremely long input remains readable via the usual Up/Down scroll.
        const qreal total = verseHeight(verses.join("\n\n"), width, 22);
        return {{"fontSize", 22}, {"columns", QStringList{verses.join("\n\n")}},
                {"overflow", true}, {"contentHeight", total}};
    }
    QStringList text;
    if (bestSplit) text = {verses.mid(0, bestSplit).join("\n\n"), verses.mid(bestSplit).join("\n\n")};
    else text = {verses.join("\n\n")};
    return {{"fontSize", bestFont}, {"columns", text}, {"overflow", false}, {"contentHeight", bestHeight}};
}
