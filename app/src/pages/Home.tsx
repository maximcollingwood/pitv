import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useConfig } from "../lib/useConfig";
import { useDarkMode } from "../lib/useDarkMode";
import { Grid } from "../components/Grid";
import { Tile } from "../components/Tile";

export function Home() {
  const navigate = useNavigate();
  const { config, error } = useConfig();
  const [dark, setDark] = useDarkMode();

  const hasHero = Boolean(config?.hero);
  // When a hero is configured, Home becomes a two-panel slide: hero first,
  // then navigation. Without a hero, jump straight to nav.
  const [view, setView] = useState<"hero" | "nav">("hero");

  // Sync view to whether a hero exists: when config arrives with a hero, land
  // on the hero panel; if there is no hero, just show nav.
  useEffect(() => {
    setView(hasHero ? "hero" : "nav");
  }, [hasHero]);

  // Focus management per view.
  useEffect(() => {
    if (!config) return;
    if (hasHero && view === "hero") {
      setFocus("hero-down");
    } else if (config.sections.length > 0) {
      setFocus("nav-0");
    }
  }, [config, view, hasHero]);

  // Lock document scroll while the two-panel home is mounted. Otherwise the
  // spatial-navigation library's scrollIntoView on the newly-focused nav tile
  // scrolls the body and stacks on top of our transform, overshooting the panel.
  useEffect(() => {
    if (!hasHero) return;
    document.documentElement.classList.add("home-stack-lock");
    document.body.classList.add("home-stack-lock");
    return () => {
      document.documentElement.classList.remove("home-stack-lock");
      document.body.classList.remove("home-stack-lock");
    };
  }, [hasHero]);

  // D-pad down (or OK on the arrow) reveals nav; Back returns to hero.
  useEffect(() => {
    if (!hasHero) return;
    const onKey = (e: KeyboardEvent) => {
      if (view === "hero" && e.key === "ArrowDown") {
        e.preventDefault();
        setView("nav");
      } else if (view === "nav" && (e.key === "Escape" || e.key === "Backspace")) {
        e.preventDefault();
        setView("hero");
      }
    };
    const onRemote = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (view === "hero" && action === "down") setView("nav");
      else if (view === "nav" && action === "back") setView("hero");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pitv:remote", onRemote);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pitv:remote", onRemote);
    };
  }, [hasHero, view]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!config) return <div className="page"><p className="muted">Loading…</p></div>;

  const navTiles = (
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
  );

  const darkToggle = (
    <Grid className="grid grid--footer">
      <Tile
        focusKey="dark-toggle"
        className="tile--toggle"
        onEnter={() => setDark(!dark)}
      >
        {dark ? "Switch to light mode" : "Switch to dark mode"}
      </Tile>
    </Grid>
  );

  // ── Hero present: two-panel slide ────────────────────────────────────────
  if (hasHero) {
    return (
      <div className="page page--home page--home-stack">
        <div className={`home-stack${view === "nav" ? " home-stack--nav" : ""}`}>
          <section className="home-panel home-panel--hero">
            <div className="hero-image">
              <img src={config.hero} alt="" />
              <div className="hero-image__fade" />
            </div>
            <div className="home-panel__content">
              <header className="hero">
                <h1 className="hero__title">{config.title}</h1>
                {config.subtitle && <p className="hero__subtitle">{config.subtitle}</p>}
              </header>
              <Grid className="grid grid--center">
                <Tile
                  focusKey="hero-down"
                  className="tile--down"
                  onEnter={() => setView("nav")}
                >
                  ↓
                </Tile>
              </Grid>
            </div>
          </section>

          <section className="home-panel home-panel--nav">
            <div className="home-panel__content home-panel__content--top">
              <header className="hero">
                <h1 className="hero__title">{config.title}</h1>
                {config.subtitle && <p className="hero__subtitle">{config.subtitle}</p>}
              </header>
              <div className="home-panel__fill">
                {config.sections.length === 0 ? (
                  <p className="muted">No sections configured yet.</p>
                ) : (
                  navTiles
                )}
              </div>
              {darkToggle}
            </div>
          </section>
        </div>
      </div>
    );
  }

  // ── No hero: classic single-screen layout ────────────────────────────────
  return (
    <div className="page page--home">
      <header className="hero">
        <h1 className="hero__title">{config.title}</h1>
        {config.subtitle && <p className="hero__subtitle">{config.subtitle}</p>}
      </header>

      {config.sections.length === 0 ? (
        <p className="muted">No sections configured yet. Add some from the editor.</p>
      ) : (
        navTiles
      )}

      {darkToggle}
    </div>
  );
}
