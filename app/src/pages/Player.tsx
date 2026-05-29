import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type MediaItem, type MediaType } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";
import { youtubeEmbedUrl } from "../lib/youtube";

export function Player() {
  useRemoteBack();
  const { type, id } = useParams();
  const [item, setItem] = useState<MediaItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!type || !id) return;
    api
      .media(type as MediaType)
      .then((all) => {
        const found = all.find((i) => String(i.id) === id);
        if (found) setItem(found);
        else setError("Not found.");
      })
      .catch(() => setError("Could not load."));
  }, [type, id]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!item) return <div className="page"><p className="muted">Loading…</p></div>;

  const src = youtubeEmbedUrl(item.youtube_url);

  return (
    <div className="player">
      {src ? (
        <iframe
          className="player__frame"
          src={src}
          title={item.title}
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
        />
      ) : (
        <p className="error">This item has no valid video link.</p>
      )}
    </div>
  );
}
