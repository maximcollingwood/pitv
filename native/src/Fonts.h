#pragma once
#include <QString>
#include <QVariantMap>

// Bhakti House typefaces, bundled in the binary (offline-safe): Parkinsans for
// display headings, Raleway for everything else, Font Awesome for icons.
namespace Fonts {
// Registers the bundled files. Call once the QGuiApplication exists.
void load();
// Family names to use; Noto Sans until load() has run (the tests never load).
QString body();
QString display();
QString icons();
QVariantMap families();
}
