import { useEffect, useRef } from "react";
import type { BgState, BgTrack, TvVolume } from "../lib/api";

export function SoundSheet({ volume, tv, tracks, background, busy, live, onVolume, onTvVolume, onTvMute, onBackground, onClose }: {
  volume: number | null;
  tv: TvVolume | null;
  tracks: BgTrack[];
  background: BgState;
  busy: boolean;
  live: boolean;
  onVolume: (level: number) => void;
  onTvVolume: (level: number) => void;
  onTvMute: (muted: boolean) => void;
  onBackground: (next: Partial<BgState>) => void;
  onClose: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    sheet.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close.current(); };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); opener?.focus(); };
  }, []);

  return <div className="sheet-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sound-title" tabIndex={-1} ref={sheet}>
      <div className="sheet__heading">
        <h2 id="sound-title">Sound</h2>
        <button className="btn btn--small" onClick={onClose}>Done</button>
      </div>
      {tv?.available ? <>
        <label className="volume-label" htmlFor="volume">TV volume <output>{tv.muted ? "Muted" : tv.level}</output></label>
        <input id="volume" type="range" min="0" max="100" step="1" value={tv.level} onChange={(event) => onTvVolume(Number(event.target.value))} />
        <div className="volume-actions">
          <button className="btn btn--small" aria-pressed={tv.muted} onClick={() => onTvMute(!tv.muted)}>{tv.muted ? "Unmute" : "Mute"}</button>
          <p className="small muted">The TV's own volume, the same one its remote changes.</p>
        </div>
      </> : <>
        <label className="volume-label" htmlFor="volume">Screen volume <output>{volume === null ? "—" : `${Math.round(volume * 100)}%`}</output></label>
        <input id="volume" type="range" min="0" max="100" step="1" value={Math.round((volume ?? 0) * 100)} disabled={volume === null} onChange={(event) => onVolume(Number(event.target.value) / 100)} />
      </>}
      <div className="background-picker">
        <label htmlFor="background">Background audio</label>
        <div className="inline-controls">
          <select id="background" value={background.trackId ?? ""} disabled={busy} onChange={(event) => onBackground({ trackId: event.target.value ? Number(event.target.value) : null, playing: Boolean(event.target.value) })}>
            <option value="">No background audio</option>
            {tracks.map((track) => <option key={track.id} value={track.id}>{track.title || "Preparing audio…"}</option>)}
          </select>
          <button className="btn" disabled={busy || background.trackId === null} onClick={() => onBackground({ playing: !background.playing })}>{busy ? "Saving…" : background.playing ? "Pause" : "Play"}</button>
        </div>
        <p className="small muted">{live ? "Sound settings are shared with the screen." : "Reconnecting live updates…"}</p>
      </div>
    </div>
  </div>;
}
