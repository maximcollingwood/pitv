import { useEffect, useState } from "react";
import { api, ApiError, errorMessage, type MediaLibrary } from "../lib/api";

function size(bytes: number): string { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`; }
export function MediaPreparation({ onError }: { onError: (error: unknown) => void }) {
  const [library, setLibrary] = useState<MediaLibrary | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try { const next = await api.media(); if (active) { setLibrary(next); setError(null); } }
      catch (failure) {
        if (active) {
          setError(errorMessage(failure));
          if (failure instanceof ApiError && failure.status === 401) onError(failure);
        }
      }
      finally { if (active) timer = setTimeout(refresh, 5000); }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [onError, revision]);
  async function retry(key: string, playlist = false) {
    setRetrying(key);
    setError(null);
    try {
      if (playlist) await api.retryPlaylist(key); else await api.retryMedia(key);
      setRevision((value) => value + 1);
    }
    catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ApiError && failure.status === 401) onError(failure);
    }
    finally { setRetrying(null); }
  }
  return <>
    <p className="muted">New YouTube links are prepared automatically. Ready items can play without internet. This page updates as preparation progresses.</p>
    {error && <p className="notice notice--error" role="alert">{error}<button className="text-link" onClick={() => setRevision((value) => value + 1)}>Try again</button></p>}
    {library && <div className="storage-meter panel"><div className="section-heading"><span>Media storage</span><span className="small muted">{size(library.cacheBytes)} of {size(library.cacheLimitBytes)}</span></div><progress aria-label="Media storage used" value={library.cacheBytes} max={library.cacheLimitBytes || 1} /></div>}
    {!library && !error && <p role="status">Loading prepared media…</p>}
    {library?.assets.length === 0 && library.playlists.length === 0 && <div className="empty-state"><h2>Your media will appear here</h2><p>Add a YouTube link to a video section or background audio to get started.</p></div>}
    <ul className="content-list">
      {library?.playlists.map((playlist) => <li className="content-row media-row" key={`playlist-${playlist.id}`}>
        <div className="row-heading"><span className={`tag tag--${playlist.status}`}>{playlist.status === "ready" ? "Playlist imported" : playlist.status === "downloading" ? "Reading playlist" : playlist.status === "error" ? "Needs attention" : "In queue"}</span><span className="small muted">playlist</span></div>
        <h2>{playlist.title || "YouTube playlist"}</h2>
        <p className="small muted source-url">{playlist.sourceUrl}</p>
        {playlist.status === "ready" && <p className="small muted">{playlist.videoCount} {playlist.videoCount === 1 ? "video" : "videos"} found. Individual videos become ready offline as they are prepared.</p>}
        {playlist.status === "downloading" && <progress aria-label={`Reading ${playlist.title || "playlist"}`} />}
        {playlist.error && <p className="notice notice--error">{playlist.error}</p>}
        {playlist.status === "error" && <button className="btn btn--small" disabled={retrying !== null} onClick={() => void retry(playlist.id, true)}>{retrying === playlist.id ? "Retrying…" : "Try again"}</button>}
      </li>)}
      {library?.assets.map((asset) => <li className="content-row media-row" key={asset.key}>
        <div className="row-heading"><span className={`tag tag--${asset.status}`}>{asset.status === "ready" ? "Ready offline" : asset.status === "downloading" ? "Preparing" : asset.status === "error" ? "Needs attention" : "In queue"}</span><span className="small muted">{asset.kind}</span></div>
        <h2>{asset.title || "YouTube import"}</h2>
        <p className="small muted source-url">{asset.sourceUrl}</p>
        {asset.status === "downloading" && <progress aria-label={`Preparing ${asset.title || "media"}`} value={asset.progress || 0} max={100} />}
        {asset.error && <p className="notice notice--error">{asset.error}</p>}
        {asset.status === "error" && <button className="btn btn--small" disabled={retrying !== null} onClick={() => void retry(asset.key)}>{retrying === asset.key ? "Retrying…" : "Try again"}</button>}
      </li>)}
    </ul>
  </>;
}
