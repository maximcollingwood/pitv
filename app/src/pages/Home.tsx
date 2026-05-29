import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useConfig } from "../lib/useConfig";
import { Grid } from "../components/Grid";
import { Tile } from "../components/Tile";

export function Home() {
  const navigate = useNavigate();
  const { config, error } = useConfig();

  useEffect(() => {
    if (config && config.sections.length > 0) setFocus("nav-0");
  }, [config]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!config) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page page--home">
      <header className="hero">
        <h1 className="hero__title">{config.title}</h1>
        {config.subtitle && <p className="hero__subtitle">{config.subtitle}</p>}
      </header>

      {config.sections.length === 0 ? (
        <p className="muted">No sections configured yet. Add some from the editor.</p>
      ) : (
        <Grid className="grid grid--nav">
          {config.sections.map((section, i) => (
            <Tile
              key={section.id}
              focusKey={`nav-${i}`}
              className="tile--nav"
              onEnter={() => navigate(`/s/${section.id}`)}
            >
              <span className="tile__label">{section.name}</span>
            </Tile>
          ))}
        </Grid>
      )}
    </div>
  );
}
