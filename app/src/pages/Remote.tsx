import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DeviceStatusCard } from "../components/DeviceCard";
import { api, errorMessage, type BgState, type BgTrack, type RemoteAction } from "../lib/api";
import { useDeviceStatus } from "../lib/useDeviceStatus";

export function Remote() {
  const connection = useDeviceStatus();
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<BgTrack[]>([]);
  const [background, setBackground] = useState<BgState>({ trackId: null, playing: false });
  const [volume, setVolume] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeRevision = useRef(0);
  const volumeWriting = useRef(false);
  const pendingVolume = useRef<number | null>(null);
  const backgroundRevision = useRef(0);
  const tracksRevision = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const stream = new EventSource("/api/device/events");
    let active = true;
    async function refresh() {
      const revision = volumeRevision.current;
      const soundRevision = backgroundRevision.current;
      const trackRevision = ++tracksRevision.current;
      try {
        const [nextTracks, nextState, nextVolume] = await Promise.all([api.backgroundTracks(), api.backgroundState(), api.getVolume()]);
        if (active) {
          setSyncError(null);
          if (trackRevision === tracksRevision.current) setTracks(nextTracks);
          if (soundRevision === backgroundRevision.current) setBackground(nextState);
          if (!volumeWriting.current && pendingVolume.current === null && revision === volumeRevision.current) setVolume(nextVolume.level);
        }
      } catch (failure) { if (active) setSyncError(errorMessage(failure)); }
    }
    stream.onopen = () => { setLive(true); void refresh(); };
    stream.onerror = () => setLive(false);
    stream.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "library") {
          // Imports resolve track titles after the original save. Refresh only
          // tracks here so a live volume adjustment is never overwritten.
          const revision = ++tracksRevision.current;
          void api.backgroundTracks().then((next) => { if (active && revision === tracksRevision.current) setTracks(next); }).catch((failure) => { if (active && revision === tracksRevision.current) setSyncError(errorMessage(failure)); });
        }
        if (message.type === "background") {
          if (message.tracks) { tracksRevision.current++; setTracks(message.tracks); }
          if (message.state) { backgroundRevision.current++; setBackground(message.state); }
        }
        if (message.type === "volume" && !volumeWriting.current && pendingVolume.current === null) { volumeRevision.current++; setVolume(message.level); }
      } catch { /* Ignore incomplete or unknown event frames. */ }
    };
    void refresh();
    return () => {
      active = false;
      mounted.current = false;
      stream.close();
      if (volumeTimer.current) clearTimeout(volumeTimer.current);
      volumeTimer.current = null;
      pendingVolume.current = null;
    };
  }, []);

  async function press(action: RemoteAction) {
    setError(null);
    try {
      await api.press(action);
      navigator.vibrate?.(8);
    } catch (failure) { setError(errorMessage(failure)); }
  }

  async function changeBackground(next: Partial<BgState>) {
    const revision = ++backgroundRevision.current;
    setBackgroundBusy(true);
    setError(null);
    try {
      const saved = await api.setBackgroundState(next);
      if (revision === backgroundRevision.current) setBackground(saved);
    }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBackgroundBusy(false); }
  }

  async function flushVolume() {
    if (volumeWriting.current || pendingVolume.current === null || !mounted.current) return;
    const level = pendingVolume.current;
    const revision = volumeRevision.current;
    pendingVolume.current = null;
    volumeWriting.current = true;
    try {
      const saved = await api.setVolume(level);
      if (mounted.current && revision === volumeRevision.current) { setVolume(saved.level); setError(null); }
    } catch (failure) {
      if (mounted.current && revision === volumeRevision.current) setError(errorMessage(failure));
    } finally {
      volumeWriting.current = false;
      // One write at a time keeps delayed requests from restoring an older gain.
      if (mounted.current && pendingVolume.current !== null) void flushVolume();
    }
  }

  function changeVolume(level: number) {
    setVolume(level);
    volumeRevision.current++;
    pendingVolume.current = level;
    if (volumeTimer.current) clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => { volumeTimer.current = null; void flushVolume(); }, 150);
  }

  const disabled = !connection.status?.connected;
  return <main className="shell remote-shell">
    <header className="topbar">
      <Link className="wordmark" to="/remote"><span className="brand-mark" aria-hidden="true">✦</span> PiTV <span>COMPANION</span></Link>
      <Link className="text-link" to="/admin">Edit library <span aria-hidden="true">↗</span></Link>
    </header>
    <div className="page-intro"><p className="eyebrow">A little closer to your library</p><h1>Take a moment.<br /><em>Explore together.</em></h1></div>
    <DeviceStatusCard connection={connection} />
    {(error || syncError) && <p className="notice notice--error" role="alert">{error || syncError}<button className="text-link" onClick={() => { setError(null); setSyncError(null); }}>Dismiss</button></p>}
    <section className="remote-controls" aria-label="TV navigation">
      <div className="dpad">
        <button className="dpad__up" disabled={disabled} onClick={() => void press("up")} aria-label="Move up">↑</button>
        <button className="dpad__left" disabled={disabled} onClick={() => void press("left")} aria-label="Move left">←</button>
        <button className="dpad__select" disabled={disabled} onClick={() => void press("select")} aria-label="Select highlighted item">Select</button>
        <button className="dpad__right" disabled={disabled} onClick={() => void press("right")} aria-label="Move right">→</button>
        <button className="dpad__down" disabled={disabled} onClick={() => void press("down")} aria-label="Move down">↓</button>
      </div>
      <div className="remote-shortcuts"><button className="btn" disabled={disabled} onClick={() => void press("back")}><span aria-hidden="true">↶</span> Back</button><button className="btn" disabled={disabled} onClick={() => void press("home")}><span aria-hidden="true">⌂</span> Home</button></div>
    </section>
    <section className="panel sound-panel" aria-labelledby="sound-title">
      <div className="section-heading"><h2 id="sound-title">Set the atmosphere</h2><span className="eyebrow">SOUND</span></div>
      <label className="volume-label" htmlFor="volume">Screen volume <output>{volume === null ? "—" : `${Math.round(volume * 100)}%`}</output></label>
      <input id="volume" type="range" min="0" max="100" step="1" value={Math.round((volume ?? 0) * 100)} disabled={volume === null} onChange={(event) => changeVolume(Number(event.target.value) / 100)} />
      <div className="background-picker">
        <label htmlFor="background">Background audio</label>
        <div className="inline-controls">
          <select id="background" value={background.trackId ?? ""} disabled={backgroundBusy} onChange={(event) => void changeBackground({ trackId: event.target.value ? Number(event.target.value) : null, playing: Boolean(event.target.value) })}>
            <option value="">No background audio</option>
            {tracks.map((track) => <option key={track.id} value={track.id}>{track.title || "Preparing audio…"}</option>)}
          </select>
          <button className="btn" disabled={backgroundBusy || background.trackId === null} onClick={() => void changeBackground({ playing: !background.playing })}>{backgroundBusy ? "Saving…" : background.playing ? "Pause" : "Play"}</button>
        </div>
        <p className="small muted">{live ? "Sound settings are shared with the screen." : "Reconnecting live updates…"}</p>
      </div>
    </section>
    <footer className="page-footer">A space for reading, listening &amp; reflection.</footer>
  </main>;
}
