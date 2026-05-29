import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";

export function Manage() {
  useRemoteBack();
  const [adminUrl, setAdminUrl] = useState<string | null>(null);

  useEffect(() => {
    api
      .info()
      .then((info) => setAdminUrl(info.adminUrl))
      .catch(() => setAdminUrl(null));
  }, []);

  return (
    <div className="page page--manage">
      <h1 className="page__title">Manage content</h1>
      <p className="muted">
        Scan with your phone, then enter the 4-digit PIN to add or edit content.
      </p>

      {adminUrl ? (
        <>
          <div className="qr">
            <QRCodeSVG value={adminUrl} size={240} fgColor="#1d1d1f" />
          </div>
          <p className="manage__url">{adminUrl}</p>
        </>
      ) : (
        <p className="muted">Preparing link…</p>
      )}

      <p className="reader__hint">Back to return</p>
    </div>
  );
}
