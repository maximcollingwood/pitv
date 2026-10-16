#include "MpvVideo.h"
#include <QDebug>
#include <QOpenGLContext>
#include <QOpenGLFramebufferObject>
#include <QOpenGLFunctions>
#include <QQuickOpenGLUtils>
#include <atomic>
#include <mpv/client.h>
#include <mpv/render_gl.h>

namespace {
mpv_handle *player = nullptr;
// mpv asks for a new frame from its own threads; the item may be gone by then.
std::atomic<MpvVideo *> shown{nullptr};
void *procAddress(void *, const char *name) {
    auto *context = QOpenGLContext::currentContext();
    return context ? reinterpret_cast<void *>(context->getProcAddress(name)) : nullptr;
}
void frameReady(void *) {
    if (auto *item = shown.load()) QMetaObject::invokeMethod(item, &QQuickItem::update, Qt::QueuedConnection);
}
class MpvRenderer final : public QQuickFramebufferObject::Renderer {
public:
    ~MpvRenderer() override {
        // Before mpv itself is destroyed, and with Qt's GL context current.
        if (context_) mpv_render_context_free(context_);
    }
    QOpenGLFramebufferObject *createFramebufferObject(const QSize &size) override {
        if (!context_ && player) {
            mpv_opengl_init_params gl{procAddress, nullptr};
            mpv_render_param params[]{{MPV_RENDER_PARAM_API_TYPE, const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
                {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl}, {MPV_RENDER_PARAM_INVALID, nullptr}};
            const bool success = mpv_render_context_create(&context_, player, params) >= 0;
            if (!success) {
                qCritical() << "The video output could not start (mpv render context)";
                context_ = nullptr;
            } else mpv_render_context_set_update_callback(context_, frameReady, nullptr);
            if (auto *item = shown.load()) QMetaObject::invokeMethod(item, [item, success] { emit item->outputReady(success); }, Qt::QueuedConnection);
        }
        return new QOpenGLFramebufferObject(size);
    }
    void render() override {
        auto *fbo = framebufferObject();
        if (!context_) {
            auto *gl = QOpenGLContext::currentContext()->functions();
            gl->glClearColor(0, 0, 0, 1); gl->glClear(GL_COLOR_BUFFER_BIT);
            return;
        }
        mpv_opengl_fbo target{int(fbo->handle()), fbo->width(), fbo->height(), 0};
        int flip = 0;
        mpv_render_param params[]{{MPV_RENDER_PARAM_OPENGL_FBO, &target}, {MPV_RENDER_PARAM_FLIP_Y, &flip}, {MPV_RENDER_PARAM_INVALID, nullptr}};
        mpv_render_context_render(context_, params);
        QQuickOpenGLUtils::resetOpenGLState();
    }
private:
    mpv_render_context *context_ = nullptr;
};
}

MpvVideo::MpvVideo(QQuickItem *parent) : QQuickFramebufferObject(parent) { shown = this; }
MpvVideo::~MpvVideo() { shown = nullptr; }
QQuickFramebufferObject::Renderer *MpvVideo::createRenderer() const { return new MpvRenderer; }
void MpvVideo::setPlayer(mpv_handle *handle) { player = handle; }
