import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { api, type Item } from "../lib/api";
import { useConfig } from "../lib/useConfig";
import { useRemoteBack } from "../lib/useRemoteBack";
import { Grid } from "../components/Grid";
import { Tile } from "../components/Tile";

export function Section() {
  useRemoteBack();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const { config } = useConfig();
  const section = config?.sections.find((s) => String(s.id) === id);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .sectionItems(id)
      .then(setItems)
      .catch(() => setError("Could not load."));
  }, [id]);

  // Focus the first focusable once we know the type + data.
  useEffect(() => {
    if (!section || items.length === 0) return;
    if (section.type === "media") {
      setFocus("cat-0");
    } else {
      setFocus(`item-${items[0].id}`);
    }
  }, [section, items]);

  if (!section) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">{section.name}</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!error && items.length === 0 && <p className="muted">Nothing here yet.</p>}

      {section.type === "articles" && (
        <Grid className="grid grid--list">
          {items.map((it) => (
            <Tile
              key={it.id}
              focusKey={`item-${it.id}`}
              className="tile--list"
              onEnter={() => navigate(`/s/${id}/article/${it.id}`)}
            >
              <span className="tile__title">{String(it.title)}</span>
            </Tile>
          ))}
        </Grid>
      )}

      {section.type === "catalog" && (
        <Grid className="grid grid--cards">
          {items.map((it) => (
            <Tile key={it.id} focusKey={`item-${it.id}`} className="tile--card">
              <h3 className="tile__title">{String(it.title)}</h3>
              <p className="tile__meta">
                {String(it.author ?? "")}
                {it.year != null ? ` · ${it.year}` : ""}
              </p>
              {it.category ? <span className="tag">{String(it.category)}</span> : null}
              {it.description ? <p className="tile__desc">{String(it.description)}</p> : null}
            </Tile>
          ))}
        </Grid>
      )}

      {section.type === "media" && (
        <Grid className="grid grid--nav">
          {[...new Set(items.map((it) => String(it.category)))].sort().map((cat, i) => (
            <Tile
              key={cat}
              focusKey={`cat-${i}`}
              className="tile--nav"
              onEnter={() => navigate(`/s/${id}/category/${encodeURIComponent(cat)}`)}
            >
              <span className="tile__label">{cat}</span>
            </Tile>
          ))}
        </Grid>
      )}
    </div>
  );
}
