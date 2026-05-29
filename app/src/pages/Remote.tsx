import { api, type RemoteAction } from "../lib/api";

function press(action: RemoteAction) {
  api.press(action);
  // brief haptic on supported phones
  if (navigator.vibrate) navigator.vibrate(10);
}

export function Remote() {
  return (
    <div className="remote">
      <h1 className="remote__brand">Temple Library</h1>
      <p className="remote__hint">Use this as your remote</p>

      <div className="dpad">
        <button className="dpad__btn dpad__up" onClick={() => press("up")} aria-label="Up">
          ▲
        </button>
        <button className="dpad__btn dpad__left" onClick={() => press("left")} aria-label="Left">
          ◀
        </button>
        <button className="dpad__btn dpad__ok" onClick={() => press("select")}>
          OK
        </button>
        <button className="dpad__btn dpad__right" onClick={() => press("right")} aria-label="Right">
          ▶
        </button>
        <button className="dpad__btn dpad__down" onClick={() => press("down")} aria-label="Down">
          ▼
        </button>
      </div>

      <button className="btn remote__back" onClick={() => press("back")}>
        ← Back
      </button>

      <a className="remote__edit" href="/admin">
        Edit content →
      </a>
    </div>
  );
}
