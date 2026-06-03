import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Item } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";

// Maximize text size: for each candidate column count, binary-search the largest
// font that still fits without overflowing into extra columns, then keep the
// column-count/font-size pair that gives the biggest font. (Targets Chromium's
// multi-column overflow behavior, which is what the kiosk runs.)
function fitLyrics(el: HTMLElement) {
  const MAX_COLUMNS = 2;
  const MIN_FONT = 14;
  const MAX_FONT = 240;
  const fits = () => el.scrollWidth <= el.clientWidth + 1;

  let best = { font: MIN_FONT, cols: 1 };
  for (let cols = 1; cols <= MAX_COLUMNS; cols++) {
    el.style.columnCount = String(cols);
    let lo = MIN_FONT;
    let hi = MAX_FONT;
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = `${mid}px`;
      if (fits()) lo = mid;
      else hi = mid;
    }
    if (lo > best.font) best = { font: lo, cols };
  }
  el.style.columnCount = String(best.cols);
  el.style.fontSize = `${best.font}px`;
}

export function LyricsView() {
  useRemoteBack();
  const navigate = useNavigate();
  const { id = "", itemId = "" } = useParams();
  const [item, setItem] = useState<Item | null>(null);
  const [siblings, setSiblings] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const colsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .sectionItems(id)
      .then((items) => {
        setSiblings(items); // already in section order from the backend
        const found = items.find((it) => String(it.id) === itemId);
        if (found) setItem(found);
        else setError("Could not load these lyrics.");
      })
      .catch(() => setError("Could not load these lyrics."));
  }, [id, itemId]);

  // Slideshow: left/right cycle through songs in this section (wraps around).
  useEffect(() => {
    if (siblings.length <= 1) return;
    const go = (dir: -1 | 1) => {
      const idx = siblings.findIndex((it) => String(it.id) === itemId);
      if (idx < 0) return;
      const next = (idx + dir + siblings.length) % siblings.length;
      navigate(`/s/${id}/lyrics/${siblings[next].id}`, { replace: true });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    };
    const onRemote = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === "left") go(-1);
      else if (action === "right") go(1);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pitv:remote", onRemote);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pitv:remote", onRemote);
    };
  }, [siblings, id, itemId, navigate]);

  const verses = String(item?.body ?? "")
    .split(/\n\s*\n/)
    .map((v) => v.trim())
    .filter(Boolean);

  useLayoutEffect(() => {
    const el = colsRef.current;
    if (!el || verses.length === 0) return;
    const refit = () => fitLyrics(el);
    refit();
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!item) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="lyrics">
      <div className="lyrics__cols" ref={colsRef}>
        {verses.map((verse, i) => (
          <div className="verse" key={i}>
            {verse}
          </div>
        ))}
      </div>
    </div>
  );
}
