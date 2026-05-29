import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { Grid } from "../components/Grid";
import { Tile } from "../components/Tile";

interface NavItem {
  label: string;
  icon: string;
  to: string;
}

const ITEMS: NavItem[] = [
  { label: "Articles", icon: "✍", to: "/articles" },
  { label: "Kirtans", icon: "♪", to: "/kirtans" },
  { label: "Videos", icon: "►", to: "/videos" },
  { label: "Catalog", icon: "❦", to: "/catalog" },
];

export function Home() {
  const navigate = useNavigate();

  useEffect(() => {
    setFocus("nav-0");
  }, []);

  return (
    <div className="page page--home">
      <header className="hero">
        <h1 className="hero__title">Temple Library</h1>
        <p className="hero__subtitle">Select with your remote to begin</p>
      </header>

      <Grid className="grid grid--nav">
        {ITEMS.map((item, i) => (
          <Tile
            key={item.to}
            focusKey={`nav-${i}`}
            className="tile--nav"
            onEnter={() => navigate(item.to)}
          >
            <span className="tile__icon">{item.icon}</span>
            <span className="tile__label">{item.label}</span>
          </Tile>
        ))}
      </Grid>

      <Grid className="grid grid--footer">
        <Tile
          focusKey="manage"
          className="tile--manage"
          onEnter={() => navigate("/manage")}
        >
          Manage content
        </Tile>
      </Grid>
    </div>
  );
}
