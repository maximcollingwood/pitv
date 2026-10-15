import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, errorMessage } from "../lib/api";
import { ImageField, readImage } from "./ContentEditor";

export function ScreenSettings({ onSaved, onError }: { onSaved: () => void; onError: (error: unknown) => void }) {
  const [settings, setSettings] = useState<{ title: string; subtitle: string; hero: string; dark: boolean; wifiSsid: string; wifiPassword: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reportError = useCallback((failure: unknown) => {
    setError(errorMessage(failure));
    if (failure instanceof ApiError && failure.status === 401) onError(failure);
  }, [onError]);
  useEffect(() => {
    let active = true;
    setError(null);
    api.getSettings().then((data) => { if (active) setSettings({ title: data.title ?? "", subtitle: data.subtitle ?? "", hero: data.hero_image ?? "", dark: data.dark_mode !== "0", wifiSsid: data.wifi_ssid ?? "", wifiPassword: data.wifi_password ?? "" }); }).catch((failure) => { if (active) reportError(failure); });
    return () => { active = false; };
  }, [reportError, revision]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!settings) return;
    setBusy(true); setError(null);
    try { await api.saveSettings({ title: settings.title, subtitle: settings.subtitle, dark_mode: settings.dark ? "1" : "0", wifi_ssid: settings.wifiSsid, wifi_password: settings.wifiSsid ? settings.wifiPassword : "" }); onSaved(); }
    catch (failure) { reportError(failure); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    setUploading(true); setError(null);
    try {
      let data: string;
      try { data = await readImage(file); } catch (failure) { setError((failure as Error).message); return; }
      const { url } = await api.uploadHero(data, file.type);
      setSettings((current) => current && { ...current, hero: url });
    } catch (failure) { reportError(failure); }
    finally { setUploading(false); }
  }
  async function remove() {
    setUploading(true); setError(null);
    try { await api.deleteHero(); setSettings((current) => current && { ...current, hero: "" }); }
    catch (failure) { reportError(failure); }
    finally { setUploading(false); }
  }
  if (!settings) return error ? <p className="notice notice--error" role="alert">{error}<button className="text-link" onClick={() => setRevision((value) => value + 1)}>Try again</button></p> : <p role="status">Loading screen settings…</p>;
  return <form className="panel editor-form" onSubmit={(event) => void save(event)}>
    <fieldset disabled={busy || uploading}>
      <label>Library title<input value={settings.title} onChange={(event) => setSettings({ ...settings, title: event.target.value })} /></label>
      <label>Subtitle<input value={settings.subtitle} onChange={(event) => setSettings({ ...settings, subtitle: event.target.value })} /></label>
      <label className="checkbox-field"><input type="checkbox" checked={settings.dark} onChange={(event) => setSettings({ ...settings, dark: event.target.checked })} /><span>Dark appearance on the TV<span className="small muted">A softer screen for quiet spaces.</span></span></label>
      <fieldset className="field-group">
        <legend>Guest Wi-Fi</legend>
        <p className="small muted">The phone remote works only on the screen's network. The home screen shows these details and a code that joins the network when scanned. Leave the name empty to hide them.</p>
        <label>Network name<input value={settings.wifiSsid} maxLength={32} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(event) => setSettings({ ...settings, wifiSsid: event.target.value })} /></label>
        <label>Password<input value={settings.wifiPassword} maxLength={63} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Empty for an open network" disabled={!settings.wifiSsid.trim()} onChange={(event) => setSettings({ ...settings, wifiPassword: event.target.value })} /></label>
        <p className="small muted">Shown on the screen as typed, so use a guest network rather than a private one.</p>
      </fieldset>
      <ImageField label="Home screen image" value={settings.hero} busy={busy || uploading} onUpload={(file) => void upload(file)} onRemove={() => void remove()} />
      <p className="small muted">Image changes appear on the screen immediately.</p>
    </fieldset>
    {error && <p className="notice notice--error" role="alert">{error}</p>}
    <button className="btn btn--primary" disabled={busy || uploading}>{busy ? "Saving…" : "Save screen settings"}</button>
  </form>;
}
