import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { api } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";
import { Grid } from "../components/Grid";
import { Tile } from "../components/Tile";

// Drill into a playlist's individual videos.
export function PlaylistBrowse() {
  useRemoteBack();
  const navigate = useNavigate();
  const { listId = "" } = useParams();
  const [videos, setVideos] = useState<{ id: string; title: string }[]>([]);
  const [source, setSource] = useState<"api" | "rss">("api");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .playlist(listId)
      .then((r) => {
        setVideos(r.videos);
        setSource(r.source);
      })
      .catch(() => setError("Could not load playlist."));
  }, [listId]);

  useEffect(() => {
    if (videos.length > 0) setFocus("pl-0");
  }, [videos]);

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Playlist</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!error && videos.length === 0 && <p className="muted">Loading…</p>}
      {!error && videos.length > 0 && source === "rss" && (
        <p className="muted">
          Showing {videos.length} most recent. Set YOUTUBE_API_KEY on the device
          for the full playlist.
        </p>
      )}
      <Grid className="grid grid--list">
        {videos.map((v, i) => (
          <Tile
            key={v.id}
            focusKey={`pl-${i}`}
            className="tile--list"
            onEnter={() => navigate(`/play/${v.id}`, { state: { title: v.title } })}
          >
            <span className="tile__title">{v.title}</span>
          </Tile>
        ))}
      </Grid>
    </div>
  );
}
