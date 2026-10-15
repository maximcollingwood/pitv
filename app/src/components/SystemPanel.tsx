import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, errorMessage, type LatestVersion, type SystemAction, type SystemStatus } from "../lib/api";
import { Icon } from "./Icon";

type Phase = "idle" | "updating" | "restarting" | "off";

const bytes = (value: number) => value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB` : `${Math.round(value / 1e6)} MB`;
const when = (ms: number | string) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
function duration(seconds: number) {
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds / 3600) % 24, minutes = Math.floor(seconds / 60) % 60;
  if (days) return `${days} day${days === 1 ? "" : "s"}, ${hours} hour${hours === 1 ? "" : "s"}`;
  if (hours) return `${hours} hour${hours === 1 ? "" : "s"}, ${minutes} min`;
  return `${minutes} min`;
}

// Destroying or interrupting asks first, saying exactly what will happen.
function Confirm({ label, message, confirm, danger = false, disabled, onConfirm }: { label: ReactNode; message: string; confirm: string; danger?: boolean; disabled?: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button className={`btn ${danger ? "btn--danger-outline" : ""}`} disabled={disabled} onClick={() => setAsking(true)}>{label}</button>;
  return <div className="confirm" role="group" aria-label={message}>
    <p>{message}</p>
    <div className="form-actions"><button className={`btn ${danger ? "btn--danger-solid" : "btn--primary"}`} onClick={() => { setAsking(false); onConfirm(); }}>{confirm}</button><button className="btn" onClick={() => setAsking(false)}>Cancel</button></div>
  </div>;
}

export function SystemPanel({ onError }: { onError: (error: unknown) => void }) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [latest, setLatest] = useState<LatestVersion | null | undefined>(undefined);
  const [log, setLog] = useState<string[] | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const wentDown = useRef(false);
  // The run an update request replaces, so the previous run's result is not mistaken for it.
  const previousRun = useRef<{ startedAt: number | null; requestedAt: number }>({ startedAt: null, requestedAt: 0 });
  // The service restarts during an update; failed polls then are expected.
  const quiet = useRef(false);

  const fail = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 401) onError(failure);
    else setError(errorMessage(failure));
  }, [onError]);

  const check = useCallback(async (force = false) => {
    setChecking(true);
    try { setLatest((await api.systemLatest(force)).latest); }
    catch (failure) { fail(failure); }
    finally { setChecking(false); }
  }, [fail]);

  const load = useCallback(async () => {
    try {
      setStatus(await api.system()); setError(null);
    } catch (failure) {
      if (!quiet.current) fail(failure);
    }
  }, [fail]);

  useEffect(() => { void load(); void check(); }, [load, check]);

  const running = Boolean(status?.update?.running);
  quiet.current = running || phase === "updating";
  // Poll faster while an update runs, and follow its log.
  useEffect(() => {
    if (phase === "restarting" || phase === "off") return;
    const timer = setInterval(() => { void load(); }, running || phase === "updating" ? 3000 : 10000);
    return () => clearInterval(timer);
  }, [load, running, phase]);
  useEffect(() => {
    if (!running && !showLog) return;
    let active = true;
    const read = () => api.updateLog().then((next) => { if (active) setLog(next.lines); }).catch(() => { /* service restarting */ });
    void read();
    const timer = running ? setInterval(read, 3000) : undefined;
    return () => { active = false; if (timer) clearInterval(timer); };
  }, [running, showLog]);
  // An update was requested: it is finished once a new run has started and ended.
  useEffect(() => {
    if (phase !== "updating" || !status?.update) return;
    const { running: busy, startedAt, finishedAt, succeeded } = status.update;
    const newRun = startedAt !== null && startedAt !== previousRun.current.startedAt;
    if (!newRun && Date.now() - previousRun.current.requestedAt > 60000) {
      setPhase("idle"); setNotice(null); setError("The update did not start. Try again, or restart the Pi.");
      return;
    }
    if (!newRun || busy || !finishedAt) return;
    setPhase("idle");
    setNotice(succeeded ? "Update finished. Reload this page to get the newest version of it too." : "The update did not finish. The details below say why.");
    if (!succeeded) setShowLog(true);
    void check(true);
  }, [phase, status, check]);
  // After a restart request, wait for the Pi to go away and come back.
  useEffect(() => {
    if (phase !== "restarting") return;
    wentDown.current = false;
    const timer = setInterval(() => {
      api.health(AbortSignal.timeout(2500)).then(() => {
        if (!wentDown.current) return;
        setPhase("idle"); setNotice("The Pi is back online."); void load(); void check();
      }).catch(() => { wentDown.current = true; });
    }, 3000);
    return () => clearInterval(timer);
  }, [phase, load, check]);

  async function act(action: SystemAction) {
    setError(null); setNotice(null);
    try {
      await api.systemAction(action);
      if (action === "update") { previousRun.current = { startedAt: status?.update?.startedAt ?? null, requestedAt: Date.now() }; setPhase("updating"); setShowLog(true); setNotice("Updating. It usually takes 5 to 15 minutes; the screen restarts near the end."); }
      else if (action === "restart-screen") setNotice("The screen app restarts now and is back in a few seconds.");
      else if (action === "reboot") { setPhase("restarting"); setNotice("Restarting the Pi. This page reconnects when it is back, in about a minute."); }
      else { setPhase("off"); setNotice("Shutting down. When the screen goes dark (about 20 seconds) it is safe to unplug. Plug it back in to turn it on."); }
    } catch (failure) { fail(failure); }
  }

  if (!status) return error ? <p className="notice notice--error" role="alert">{error}<button className="text-link" onClick={() => void load()}>Try again</button></p> : <p role="status">Checking the Pi…</p>;
  const { screen, version, update, device } = status;
  const upToDate = latest?.commit && version.commit ? latest.commit === version.commit : null;
  const offline = phase === "restarting" || phase === "off";
  const power = device.power;

  return <div className="system">
    {notice && <p className={`notice ${phase === "idle" ? "notice--success" : ""}`} role="status">{notice}<button className="text-link" aria-label="Dismiss message" onClick={() => setNotice(null)}><Icon name="xmark" /></button></p>}
    {error && <p className="notice notice--error" role="alert">{error}<button className="text-link" onClick={() => setError(null)}>Dismiss</button></p>}

    <div className="system-grid">
      <section className="panel system-card" aria-labelledby="system-screen">
        <div className="section-heading"><h2 id="system-screen">Screen</h2><span className="status-line"><span className={`status-dot ${screen.connected ? "is-online" : ""}`} />{screen.connected ? "Connected" : "Offline"}</span></div>
        <p className="muted">{screen.connected ? `Showing ${screen.title || "the library"}${screen.playing ? ", playing" : ""}.` : "The screen app is not responding. Restarting it usually helps."}</p>
        {screen.error && <p className="notice notice--error">{screen.error}</p>}
        <div className="form-actions"><button className="btn" disabled={offline} onClick={() => void act("restart-screen")}><Icon name="rotate-left" />Restart the screen app</button></div>
      </section>

      <section className="panel system-card" aria-labelledby="system-software">
        <div className="section-heading"><h2 id="system-software">Software</h2>
          {running || phase === "updating" ? <span className="tag tag--downloading">Updating</span>
            : upToDate === true ? <span className="tag tag--ready">Up to date</span>
            : upToDate === false ? <span className="tag">Update available</span> : null}
        </div>
        <dl className="facts">
          <dt>Version</dt><dd>{version.commit ? <><code>{version.commit.slice(0, 7)}</code> {version.subject}</> : "Development build"}</dd>
          {version.date && <><dt>From</dt><dd>{when(version.date)}</dd></>}
          {update?.finishedAt && !running && <><dt>Last update</dt><dd>{when(update.finishedAt)}, {update.succeeded ? "finished" : "failed"}</dd></>}
        </dl>
        {latest === undefined || checking ? <p className="small muted">Checking for updates…</p>
          : latest?.error ? <p className="small muted">{latest.error}</p>
          : upToDate === false ? <p className="small muted">A newer version is on GitHub. Updating keeps your library, settings and downloads.</p> : null}
        {!version.selfUpdate && <p className="small muted">This machine does not update itself. In the development VM, run <code>vagrant provision</code>.</p>}
        <div className="form-actions">
          <button className="btn btn--primary" disabled={!version.selfUpdate || running || phase !== "idle"} onClick={() => void act("update")}>{running || phase === "updating" ? "Updating…" : "Update now"}</button>
          <button className="btn" disabled={checking || offline} onClick={() => void check(true)}>Check again</button>
          {!running && update?.startedAt && <button className="text-link" onClick={() => setShowLog(!showLog)}>{showLog ? "Hide details" : "Show details"}</button>}
        </div>
        {(running || showLog) && log && <pre className="update-log" aria-label="Update output">{log.length ? log.slice(-30).join("\n") : "No output yet."}</pre>}
      </section>

      <section className="panel system-card" aria-labelledby="system-device">
        <div className="section-heading"><h2 id="system-device">Device</h2></div>
        <dl className="facts">
          <dt>Name</dt><dd>{device.hostname}</dd>
          <dt>Network</dt><dd>{device.wifi ? `Wi-Fi “${device.wifi}”` : "Wired or unknown"}{device.addresses.length ? `, ${device.addresses.join(", ")}` : ""}</dd>
          <dt>Running for</dt><dd>{duration(device.uptimeSeconds)}</dd>
          {device.temperature !== null && <><dt>Temperature</dt><dd>{device.temperature} °C{device.temperature >= 80 ? ", hot: check the ventilation" : ""}</dd></>}
          {power && <><dt>Power supply</dt><dd className={power.underVoltageNow || power.underVoltageSinceBoot ? "is-warning" : ""}>{power.underVoltageNow ? "Too weak right now. Use the official 5.1 V 3 A supply." : power.underVoltageSinceBoot ? "Dipped too low since the last restart. A stronger supply prevents freezes." : "Good"}</dd></>}
          {device.disk && <><dt>Storage</dt><dd>{bytes(device.disk.freeBytes)} free of {bytes(device.disk.totalBytes)}</dd></>}
          <dt>Memory</dt><dd>{bytes(device.memory.freeBytes)} free of {bytes(device.memory.totalBytes)}</dd>
        </dl>
      </section>

      <section className="panel system-card" aria-labelledby="system-power">
        <div className="section-heading"><h2 id="system-power">Restart or shut down</h2></div>
        <p className="muted">Restart if something seems stuck. Shut down before unplugging, so the memory card is not damaged.</p>
        <div className="form-actions system-power">
          <Confirm label={<><Icon name="rotate-left" />Restart the Pi</>} disabled={offline || running} confirm="Restart now"
            message="The screen goes dark for about a minute, then comes back on its own." onConfirm={() => void act("reboot")} />
          <Confirm label={<><Icon name="power-off" />Shut down</>} danger disabled={offline || running} confirm="Shut down now"
            message="The Pi turns off. To turn it on again, unplug the power and plug it back in." onConfirm={() => void act("poweroff")} />
        </div>
      </section>
    </div>
  </div>;
}
