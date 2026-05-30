import { useEffect, useRef, useState } from "react";
import { api, type BgState, type BgTrack, type RemoteAction } from "../lib/api";

function press(action: RemoteAction) {
  api.press(action);
  if (navigator.vibrate) navigator.vibrate(10); // brief haptic where supported
}

function BackgroundControl() {
  const [tracks, setTracks] = useState<BgTrack[]>([]);
  const [state, setState] = useState<BgState>({ trackId: null, playing: false });

  useEffect(() => {
    api.backgroundTracks().then(setTracks).catch(() => {});
  }, []);

  useEffect(() => {
    const src = new EventSource("/api/background/events");
    src.onmessage = (e) => {
      try {
        setState(JSON.parse(e.data) as BgState);
      } catch {
        /* ignore */
      }
    };
    return () => src.close();
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    const id = v === "" ? null : Number(v);
    api.setBackgroundState({ trackId: id, playing: id != null }).catch(() => {});
  };

  const toggle = () => {
    if (state.trackId == null) return;
    api.setBackgroundState({ playing: !state.playing }).catch(() => {});
  };

  return (
    <div className="bg-control">
      <select
        className="bg-control__select"
        value={state.trackId ?? ""}
        onChange={onPick}
        aria-label="Background audio track"
      >
        <option value="">— Background audio —</option>
        {tracks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      <button
        className="btn btn--small"
        onClick={toggle}
        disabled={state.trackId == null}
      >
        {state.playing ? "Pause" : "Play"}
      </button>
    </div>
  );
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

  // System-volume slider — controls the pi's default sink directly.
  const [vol, setVol] = useState<number | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api
      .getVolume()
      .then((r) => setVol(r.level))
      .catch(() => setVol(0));
  }, []);

  function onSlide(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value) / 100;
    setVol(v); // optimistic
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      api.setVolume(v).catch(() => {});
    }, 80);
  }

  const pct = vol == null ? 5 : Math.round(vol * 100);

  return (
    <div className="remote">
      <BackgroundControl />
      <div className="remote__head">
        <h1 className="remote__brand">Temple Library</h1>
        <p className="remote__hint">Use this as your remote</p>
      </div>

      <div className="dpad">
        <button className="dpad__btn dpad__up" onClick={() => press("up")} aria-label="Up">▲</button>
        <button className="dpad__btn dpad__left" onClick={() => press("left")} aria-label="Left">◀</button>
        <button className="dpad__btn dpad__ok" onClick={() => press("select")}>OK</button>
        <button className="dpad__btn dpad__right" onClick={() => press("right")} aria-label="Right">▶</button>
        <button className="dpad__btn dpad__down" onClick={() => press("down")} aria-label="Down">▼</button>
      </div>

      <div className="volume">
        <span className="volume__label">Vol</span>
        <input
          className="volume__slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={onSlide}
          aria-label="System volume"
        />
        <span className="volume__pct">{pct}%</span>
      </div>

      <button className="btn remote__back" onClick={() => press("back")}>Back</button>

      <a className="remote__edit" href="/admin">Edit content</a>
    </div>
  );
}
