import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { api, type ArticleSummary } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";
import { Grid } from "../components/Grid";
import { Tile } from "../components/Tile";

export function Articles() {
  useRemoteBack();
  const navigate = useNavigate();
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .articles()
      .then(setArticles)
      .catch(() => setError("Could not load articles."));
  }, []);

  useEffect(() => {
    if (articles.length > 0) setFocus(`article-${articles[0].id}`);
  }, [articles]);

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Articles</h1>
      </header>

      {error && <p className="error">{error}</p>}
      {!error && articles.length === 0 && <p className="muted">No articles yet.</p>}

      <Grid className="grid grid--list">
        {articles.map((a) => (
          <Tile
            key={a.id}
            focusKey={`article-${a.id}`}
            className="tile--list"
            onEnter={() => navigate(`/articles/${a.id}`)}
          >
            <span className="tile__title">{a.title}</span>
          </Tile>
        ))}
      </Grid>
    </div>
  );
}
