import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import lotus from "../assets/lotus-purple.png";
import { Icon } from "../components/Icon";
import { SoundSheet } from "../components/SoundSheet";
import { TouchPad } from "../components/TouchPad";
import { api, errorMessage, type BgState, type BgTrack, type DeviceStatus, type RemoteAction, type TvVolume } from "../lib/api";
import { useDeviceStatus } from "../lib/useDeviceStatus";

// What a swipe or tap does on the page the screen is showing.
function padHint(status: DeviceStatus | null, offline: boolean) {
  if (offline) return { title: "Waiting for the screen", detail: "The pad comes back when the screen reconnects." };
  if (status?.tv === "standby") return { title: "The TV is off", detail: "Tap to turn it on." };
  if (status?.page === "colour-check") return { title: "Tap to close the colour check", detail: "Any button on this remote closes it." };
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
  // The TV's own volume when PiTV is paired with the TV; PiTV's level otherwise.
  const [tv, setTv] = useState<TvVolume | null>(null);
  const tvTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tvWriting = useRef(false);
  const pendingTv = useRef<number | null>(null);
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
      // Asking the TV can take a few seconds when it is off, so it does not hold up the rest.
      void api.tv().then((next) => { if (active && !tvWriting.current && pendingTv.current === null) setTv(next); }).catch(() => { /* shown as PiTV's volume */ });
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
        if (message.type === "tvVolume" && !tvWriting.current && pendingTv.current === null) setTv({ paired: true, available: message.available, level: message.level, muted: message.muted });
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
      if (tvTimer.current) clearTimeout(tvTimer.current);
      tvTimer.current = null;
      pendingTv.current = null;
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

  async function flushTv() {
    if (tvWriting.current || pendingTv.current === null || !mounted.current) return;
    const level = pendingTv.current;
    pendingTv.current = null;
    tvWriting.current = true;
    try {
      const saved = await api.setTv({ level });
      if (mounted.current && pendingTv.current === null) { setTv(saved); setError(null); }
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      tvWriting.current = false;
      // One write at a time, like PiTV's own volume.
      if (mounted.current && pendingTv.current !== null) void flushTv();
    }
  }

  function changeTvVolume(level: number) {
    setTv((current) => current && { ...current, level });
    pendingTv.current = level;
    if (tvTimer.current) clearTimeout(tvTimer.current);
    tvTimer.current = setTimeout(() => { tvTimer.current = null; void flushTv(); }, 150);
  }

  async function muteTv(muted: boolean) {
    setTv((current) => current && { ...current, muted });
    try { setTv(await api.setTv({ muted })); setError(null); }
    catch (failure) { setError(errorMessage(failure)); }
  }

  const { status, error: statusError } = connection;
  const disabled = !status?.connected;
  const hint = padHint(status, disabled);
  const label = statusError ? "Library unreachable" : status?.connected ? status.tv === "standby" ? "TV is off" : "Screen connected" : status ? "Screen offline" : "Connecting…";
  const problem = error || syncError || (status?.connected ? status.error : null);
  return <main className="remote">
    <header className="remote__bar">
      <div className="remote__brand">
        <img className="brand-mark" src={lotus} alt="" />
        <div className="remote__status" role="status">
          <span className={`status-dot ${status?.connected ? "is-online" : ""}`} />
          <span>{label}</span>
          {status?.connected && status.tv !== "standby" && status.title && <span className="remote__showing">{status.title}</span>}
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
      {status?.tv && <button className="remote__key" disabled={disabled} onClick={() => press("power")}><Icon name="power-off" />{status.tv === "standby" ? "Turn on" : "Turn off"}</button>}
    </nav>
    {soundOpen && <SoundSheet volume={volume} tv={tv} tracks={tracks} background={background} busy={backgroundBusy} live={live}
      onVolume={changeVolume} onTvVolume={changeTvVolume} onTvMute={(muted) => void muteTv(muted)}
      onBackground={(next) => void changeBackground(next)} onClose={() => setSoundOpen(false)} />}
  </main>;
}
