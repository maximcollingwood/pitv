import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { api, type MediaItem, type MediaType } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";
import { parseYouTube } from "../lib/youtube";
import { Grid } from "../components/Grid";
import { Tile } from "../components/Tile";

const TITLES: Record<MediaType, string> = {
  kirtans: "Kirtans",
  videos: "Videos",
};

// Level 1: pick a category.
export function MediaCategories({ type }: { type: MediaType }) {
  useRemoteBack();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .media(type)
      .then((items) =>
        setCategories([...new Set(items.map((i) => i.category))].sort()),
      )
      .catch(() => setError("Could not load."));
  }, [type]);

  useEffect(() => {
    if (categories.length > 0) setFocus(`cat-0`);
  }, [categories]);

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">{TITLES[type]}</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!error && categories.length === 0 && <p className="muted">Nothing here yet.</p>}

      <Grid className="grid grid--nav">
        {categories.map((cat, i) => (
          <Tile
            key={cat}
            focusKey={`cat-${i}`}
            className="tile--nav"
            onEnter={() => navigate(`/${type}/${encodeURIComponent(cat)}`)}
          >
            <span className="tile__label">{cat}</span>
          </Tile>
        ))}
      </Grid>
    </div>
  );
}

// Level 2: items within a category.
export function MediaItems({ type }: { type: MediaType }) {
  useRemoteBack();
  const navigate = useNavigate();
  const { category = "" } = useParams();
  const cat = decodeURIComponent(category);
  const [items, setItems] = useState<MediaItem[]>([]);

  useEffect(() => {
    api
      .media(type)
      .then((all) => setItems(all.filter((i) => i.category === cat)))
      .catch(() => setItems([]));
  }, [type, cat]);

  useEffect(() => {
    if (items.length > 0) setFocus(`item-${items[0].id}`);
  }, [items]);

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">{cat}</h1>
      </header>

      <Grid className="grid grid--list">
        {items.map((item) => (
          <Tile
            key={item.id}
            focusKey={`item-${item.id}`}
            className="tile--list"
            onEnter={() =>
              navigate(
                parseYouTube(item.youtube_url).kind === "playlist"
                  ? `/playlist/${type}/${item.id}`
                  : `/watch/${type}/${item.id}`,
              )
            }
          >
            <span className="tile__title">{item.title}</span>
          </Tile>
        ))}
      </Grid>
    </div>
  );
}

// Drill into a playlist's individual videos.
export function PlaylistBrowse() {
  useRemoteBack();
  const navigate = useNavigate();
  const { type = "videos", id = "" } = useParams();
  const [videos, setVideos] = useState<{ id: string; title: string }[]>([]);
  const [heading, setHeading] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .media(type as MediaType)
      .then((all) => {
        const item = all.find((i) => String(i.id) === id);
        if (!item) return setError("Not found.");
        setHeading(item.title);
        const parsed = parseYouTube(item.youtube_url);
        if (parsed.kind !== "playlist") return setError("Not a playlist.");
        return api.playlist(parsed.id).then((r) => setVideos(r.videos));
      })
      .catch(() => setError("Could not load playlist."));
  }, [type, id]);

  useEffect(() => {
    if (videos.length > 0) setFocus("pl-0");
  }, [videos]);

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">{heading}</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!error && videos.length === 0 && <p className="muted">Loading…</p>}

      <Grid className="grid grid--list">
        {videos.map((v, i) => (
          <Tile
            key={v.id}
            focusKey={`pl-${i}`}
            className="tile--list"
            onEnter={() => navigate(`/play/${v.id}`)}
          >
            <span className="tile__title">{v.title}</span>
          </Tile>
        ))}
      </Grid>
    </div>
  );
}
