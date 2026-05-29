import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../lib/api";

// Persistent corner QR so anyone can scan to control the screen at any time —
// the bootstrap entry point that needs no remote to reach.
export function RemoteBadge() {
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);

  useEffect(() => {
    api.info().then((i) => setRemoteUrl(i.remoteUrl)).catch(() => {});
  }, []);

  if (!remoteUrl) return null;

  return (
    <div className="remote-badge">
      <QRCodeSVG value={remoteUrl} size={84} fgColor="#1d1d1f" />
      <span className="remote-badge__label">Scan to control</span>
    </div>
  );
}
