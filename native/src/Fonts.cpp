#include "Fonts.h"
#include <QDebug>
#include <QDir>
#include <QFontDatabase>

namespace {
QString body_ = QStringLiteral("Noto Sans"), display_ = QStringLiteral("Noto Sans"), icons_ = QStringLiteral("Noto Sans");
}

void Fonts::load() {
    // Files are named after their family (raleway-*, parkinsans-*, fa-solid-*).
    const QDir dir(QStringLiteral(":/fonts"));
    for (const auto &name : dir.entryList({QStringLiteral("*.woff2"), QStringLiteral("*.ttf")}, QDir::Files)) {
        const int id = QFontDatabase::addApplicationFont(dir.filePath(name));
        const auto families = QFontDatabase::applicationFontFamilies(id);
        if (families.isEmpty()) { qWarning() << "Could not load font" << name; continue; }
        if (name.startsWith(QLatin1String("raleway"))) body_ = families.first();
        else if (name.startsWith(QLatin1String("parkinsans"))) display_ = families.first();
        else if (name.startsWith(QLatin1String("fa-"))) icons_ = families.first();
    }
}
QString Fonts::body() { return body_; }
QString Fonts::display() { return display_; }
QString Fonts::icons() { return icons_; }
QVariantMap Fonts::families() { return {{"body", body_}, {"display", display_}, {"icons", icons_}}; }
