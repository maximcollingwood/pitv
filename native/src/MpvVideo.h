#pragma once
#include <QQuickFramebufferObject>

struct mpv_handle;

// The video picture. libmpv draws each frame into this item's framebuffer on Qt's
// render thread, so the QML player controls sit on top of it as usual.
class MpvVideo : public QQuickFramebufferObject {
    Q_OBJECT
public:
    explicit MpvVideo(QQuickItem *parent = nullptr);
    ~MpvVideo() override;
    Renderer *createRenderer() const override;
    // The video player's mpv instance, set once before the QML loads.
    static void setPlayer(mpv_handle *player);
signals:
    // mpv can draw here now; a video opened before this has nowhere to go.
    void outputReady(bool success);
};
