import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { api, type BgTrack } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";
import { Grid } from "../components/Grid";
import { Tile } from "../components/Tile";

// The TV-side "dropdown": a full-page list of background tracks the user picks
// with the remote. The phone has a real <select> for this.
export function BackgroundPicker() {
  useRemoteBack();
  const navigate = useNavigate();
  const [tracks, setTracks] = useState<BgTrack[]>([]);

  useEffect(() => {
    api.backgroundTracks().then(setTracks).catch(() => setTracks([]));
  }, []);

  useEffect(() => {
    if (tracks.length > 0) setFocus(`bgt-${tracks[0].id}`);
  }, [tracks]);

  async function pick(id: number) {
    await api.setBackgroundState({ trackId: id, playing: true }).catch(() => {});
    navigate(-1);
  }

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Background audio</h1>
      </header>
      {tracks.length === 0 && (
        <p className="muted">No background tracks configured yet.</p>
      )}
      <Grid className="grid grid--list">
        {tracks.map((t) => (
          <Tile
            key={t.id}
            focusKey={`bgt-${t.id}`}
            className="tile--list"
            onEnter={() => pick(t.id)}
          >
            <span className="tile__title">{t.title}</span>
          </Tile>
        ))}
      </Grid>
    </div>
  );
}
