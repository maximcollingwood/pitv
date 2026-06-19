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
  // FAQ: which question's answer is shown in the right pane.
  const [selectedFaq, setSelectedFaq] = useState<number | null>(null);

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

  // Reset selection when the section changes; otherwise a stale id leaks
  // through if the user navigates between two FAQ sections.
  useEffect(() => {
    setSelectedFaq(null);
  }, [id]);

  if (!section) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">{section.name}</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!error && items.length === 0 && <p className="muted">Nothing here yet.</p>}

      {(section.type === "articles" || section.type === "lyrics") && (
        <Grid className="grid grid--list">
          {items.map((it) => (
            <Tile
              key={it.id}
              focusKey={`item-${it.id}`}
              className="tile--list"
              onEnter={() =>
                navigate(
                  section.type === "lyrics"
                    ? `/s/${id}/lyrics/${it.id}`
                    : `/s/${id}/article/${it.id}`,
                )
              }
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

      {section.type === "faq" && (
        <div className="faq">
          <Grid className="grid grid--list faq__questions">
            {items.map((it) => (
              <Tile
                key={it.id}
                focusKey={`item-${it.id}`}
                className="tile--list tile--faq"
                onEnter={() => setSelectedFaq(Number(it.id))}
              >
                <span className="tile__title">{String(it.question ?? "")}</span>
              </Tile>
            ))}
          </Grid>
          <aside className={`faq__pane ${selectedFaq != null ? "is-open" : ""}`}>
            {(() => {
              const sel = items.find((it) => Number(it.id) === selectedFaq);
              if (!sel) {
                return <p className="muted faq__hint">Select a question to see the answer.</p>;
              }
              return (
                // Re-key on selection so the slide-in animation re-fires.
                <div className="faq__answer" key={sel.id}>
                  {sel.cover_url ? (
                    <img
                      className="faq__cover"
                      src={String(sel.cover_url)}
                      alt={String(sel.book_title ?? "")}
                    />
                  ) : null}
                  <div className="faq__text">
                    {sel.book_title ? (
                      <h2 className="faq__book">{String(sel.book_title)}</h2>
                    ) : null}
                    {sel.quote ? (
                      <blockquote className="faq__quote">{String(sel.quote)}</blockquote>
                    ) : null}
                    {sel.location ? (
                      <p className="faq__location">{String(sel.location)}</p>
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </aside>
        </div>
      )}
    </div>
  );
}
