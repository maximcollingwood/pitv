import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type Item } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";

export function ArticleReader() {
  useRemoteBack();
  const { id = "", itemId = "" } = useParams();
  const [article, setArticle] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .sectionItems(id)
      .then((items) => {
        const found = items.find((it) => String(it.id) === itemId);
        if (found) setArticle(found);
        else setError("Could not load this article.");
      })
      .catch(() => setError("Could not load this article."));
  }, [id, itemId]);

  // Up/down scroll the body, from keyboard and the phone remote.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scroll = (dir: "up" | "down") =>
      el.scrollBy({ top: dir === "down" ? 120 : -120, behavior: "smooth" });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); scroll("down"); }
      else if (e.key === "ArrowUp") { e.preventDefault(); scroll("up"); }
    };
    const onRemote = (e: Event) => {
      const dir = (e as CustomEvent<string>).detail;
      if (dir === "down") scroll("down");
      else if (dir === "up") scroll("up");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pitv:remote", onRemote);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pitv:remote", onRemote);
    };
  }, [article]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!article) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page page--reader">
      <article className="reader" ref={scrollRef}>
        <h1 className="reader__title">{String(article.title)}</h1>
        <div className="reader__body">{String(article.body ?? "")}</div>
      </article>
      <p className="reader__hint">Scroll up or down · Back to return</p>
    </div>
  );
}
