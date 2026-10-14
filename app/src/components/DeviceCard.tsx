import { useDeviceStatus } from "../lib/useDeviceStatus";

export function DeviceCard({ compact = false }: { compact?: boolean }) {
  return <DeviceStatusCard connection={useDeviceStatus()} compact={compact} />;
}

export function DeviceStatusCard({ connection, compact = false }: { connection: ReturnType<typeof useDeviceStatus>; compact?: boolean }) {
  const { status, error } = connection;
  const label = error ? "Library unreachable" : status?.connected ? "Screen connected" : status ? "Screen offline" : "Connecting to screen…";
  return <section className={`device-card ${compact ? "device-card--compact" : ""}`} aria-label="Screen status">
    <div className="status-line" role="status"><span className={`status-dot ${status?.connected ? "is-online" : ""}`} />{label}</div>
    {!compact && <>
      <p className="device-card__title">{status?.connected ? status.title || "Library home" : "Your library screen"}</p>
      <p className="muted">{error || (status?.connected ? status.playing ? "Playing on the TV" : "Ready to explore" : status ? "Controls will reconnect when the screen is ready." : "Checking the connection…")}</p>
      {status?.error && <p className="notice notice--error" role="alert">{status.error}</p>}
    </>}
  </section>;
}
