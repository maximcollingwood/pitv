import { useEffect } from "react";
import { api, type RemoteAction } from "../lib/api";

function press(action: RemoteAction) {
  api.press(action);
  if (navigator.vibrate) navigator.vibrate(10); // brief haptic where supported
}

export function Remote() {
  // Lock the page against scrolling/bounce so it behaves like a native remote.
  useEffect(() => {
    document.documentElement.classList.add("lock");
    document.body.classList.add("lock");
    return () => {
      document.documentElement.classList.remove("lock");
      document.body.classList.remove("lock");
    };
  }, []);

  return (
    <div className="remote">
      <div className="remote__head">
        <h1 className="remote__brand">Temple Library</h1>
        <p className="remote__hint">Use this as your remote</p>
      </div>

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
        Back
      </button>

      <a className="remote__edit" href="/admin">
        Edit content
      </a>
    </div>
  );
}
