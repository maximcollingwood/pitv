import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { api, type Item } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";
import { parseYouTube } from "../lib/youtube";
import { Grid } from "../components/Grid";
import { Tile } from "../components/Tile";

// Media items within one category of a media section.
export function SectionItems() {
  useRemoteBack();
  const navigate = useNavigate();
  const { id = "", category = "" } = useParams();
  const cat = decodeURIComponent(category);
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    api
      .sectionItems(id)
      .then((all) => setItems(all.filter((it) => String(it.category) === cat)))
      .catch(() => setItems([]));
  }, [id, cat]);

  useEffect(() => {
    if (items.length > 0) setFocus(`item-${items[0].id}`);
  }, [items]);

  function open(it: Item) {
    const parsed = parseYouTube(String(it.youtube_url ?? ""));
    const title = String(it.title);
    if (parsed.kind === "playlist") navigate(`/playlist/${parsed.id}`, { state: { title } });
    else if (parsed.kind === "video") navigate(`/play/${parsed.id}`, { state: { title } });
  }

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">{cat}</h1>
      </header>
      <Grid className="grid grid--list">
        {items.map((it) => (
          <Tile
            key={it.id}
            focusKey={`item-${it.id}`}
            className="tile--list"
            onEnter={() => open(it)}
          >
            <span className="tile__title">{String(it.title)}</span>
          </Tile>
        ))}
      </Grid>
    </div>
  );
}
