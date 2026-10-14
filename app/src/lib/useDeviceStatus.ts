import { useEffect, useState } from "react";
import { api, errorMessage, type DeviceStatus } from "./api";

export function useDeviceStatus() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await api.deviceStatus(controller.signal);
        if (!controller.signal.aborted) { setStatus(next); setError(null); }
      } catch (failure) {
        if (!controller.signal.aborted) { setStatus(null); setError(errorMessage(failure)); }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 5000);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  return { status, error };
}
