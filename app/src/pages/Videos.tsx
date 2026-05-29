import { useRemoteBack } from "../lib/useRemoteBack";

export function Videos() {
  useRemoteBack();
  return (
    <div className="page page--placeholder">
      <h1 className="page__title">Videos</h1>
      <p className="muted">Coming soon — browse videos and playlists by category.</p>
      <p className="reader__hint">Back to return</p>
    </div>
  );
}
