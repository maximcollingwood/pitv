import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { api, type MediaItem, type MediaType } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";
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
            onEnter={() => navigate(`/watch/${type}/${item.id}`)}
          >
            <span className="tile__title">{item.title}</span>
          </Tile>
        ))}
      </Grid>
    </div>
  );
}
