import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type Article } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";

export function ArticleDetail() {
  useRemoteBack();
  const { id } = useParams();
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    api
      .article(id)
      .then(setArticle)
      .catch(() => setError("Could not load this article."));
  }, [id]);

  // No focusable elements here, so use the D-pad up/down to scroll the body.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        el.scrollBy({ top: 120, behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        el.scrollBy({ top: -120, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [article]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!article) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page page--reader">
      <article className="reader" ref={scrollRef}>
        <h1 className="reader__title">{article.title}</h1>
        <div className="reader__body">{article.body}</div>
      </article>
      <p className="reader__hint">Use ▲ ▼ to scroll · Back to return</p>
    </div>
  );
}
