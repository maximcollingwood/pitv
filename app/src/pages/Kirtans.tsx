import { useRemoteBack } from "../lib/useRemoteBack";

export function Kirtans() {
  useRemoteBack();
  return (
    <div className="page page--placeholder">
      <h1 className="page__title">Kirtans</h1>
      <p className="muted">Coming soon — browse kirtans by category and play.</p>
      <p className="reader__hint">Back to return</p>
    </div>
  );
}
