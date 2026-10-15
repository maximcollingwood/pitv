import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import lotus from "../assets/lotus-purple.png";
import { Icon } from "../components/Icon";
import { SoundSheet } from "../components/SoundSheet";
import { TouchPad } from "../components/TouchPad";
import { api, errorMessage, type BgState, type BgTrack, type DeviceStatus, type RemoteAction } from "../lib/api";
import { useDeviceStatus } from "../lib/useDeviceStatus";

// What a swipe or tap does on the page the screen is showing.
function padHint(status: DeviceStatus | null, offline: boolean) {
  if (offline) return { title: "Waiting for the screen", detail: "The pad comes back when the screen reconnects." };
  if (status?.page === "player") return { title: status.playing ? "Tap to pause" : "Tap to play", detail: "Swipe left or right to skip 10 seconds, up or down for volume." };
  if (status?.page === "lyrics") return { title: "Swipe up or down to scroll", detail: "Swipe left or right for the next song." };
  if (status?.page === "reader" || status?.page === "book") return { title: "Swipe up or down to read", detail: "Keep swiping up at the top to reach the menu." };
  return { title: "Swipe to move", detail: "Tap anywhere to select." };
}

export function Remote() {
  const connection = useDeviceStatus();
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<BgTrack[]>([]);
  const [background, setBackground] = useState<BgState>({ trackId: null, playing: false });
  const [volume, setVolume] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const presses = useRef<Promise<void>>(Promise.resolve());
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeRevision = useRef(0);
  const volumeWriting = useRef(false);
  const pendingVolume = useRef<number | null>(null);
  const backgroundRevision = useRef(0);
  const tracksRevision = useRef(0);
  const mounted = useRef(false);

  const { push } = connection;
  useEffect(() => {
    // A remote is a fixed surface: no page scroll, pull-to-refresh or bounce.
    document.documentElement.classList.add("remote-mode");
    return () => document.documentElement.classList.remove("remote-mode");
  }, []);

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
        if (message.type === "status") push(message as DeviceStatus);
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
  }, [push]);

  function press(action: RemoteAction) {
    navigator.vibrate?.(8);
    // One request at a time keeps a fast swipe's steps in order.
    presses.current = presses.current.then(() => api.press(action)).then(() => setError(null), (failure) => setError(errorMessage(failure)));
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

  const { status, error: statusError } = connection;
  const disabled = !status?.connected;
  const hint = padHint(status, disabled);
  const label = statusError ? "Library unreachable" : status?.connected ? "Screen connected" : status ? "Screen offline" : "Connecting…";
  const problem = error || syncError || (status?.connected ? status.error : null);
  return <main className="remote">
    <header className="remote__bar">
      <div className="remote__brand">
        <img className="brand-mark" src={lotus} alt="" />
        <div className="remote__status" role="status">
          <span className={`status-dot ${status?.connected ? "is-online" : ""}`} />
          <span>{label}</span>
          {status?.connected && status.title && <span className="remote__showing">{status.title}</span>}
        </div>
      </div>
      <Link className="text-link" to="/admin">Edit library</Link>
    </header>
    <TouchPad disabled={disabled} title={hint.title} detail={hint.detail} onAction={press} />
    {problem && <p className="notice notice--error remote__notice" role="alert">{problem}{(error || syncError) && <button className="text-link" onClick={() => { setError(null); setSyncError(null); }}>Dismiss</button>}</p>}
    <nav className="remote__keys" aria-label="Screen shortcuts">
      <button className="remote__key" disabled={disabled} onClick={() => press("back")}><Icon name="arrow-left" />Back</button>
      <button className="remote__key" disabled={disabled} onClick={() => press("home")}><Icon name="house" />Home</button>
      <button className="remote__key" aria-haspopup="dialog" onClick={() => setSoundOpen(true)}><Icon name="volume-high" />Sound</button>
    </nav>
    {soundOpen && <SoundSheet volume={volume} tracks={tracks} background={background} busy={backgroundBusy} live={live}
      onVolume={changeVolume} onBackground={(next) => void changeBackground(next)} onClose={() => setSoundOpen(false)} />}
  </main>;
}
