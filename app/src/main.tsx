import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { init } from "@noriginmedia/norigin-spatial-navigation";
import { readDarkPref } from "./lib/useDarkMode";
import "./styles.css";

// Apply persisted dark mode before React paints, so there's no light flash.
if (readDarkPref()) document.body.classList.add("dark");

import { TvLayout } from "./components/TvLayout";
import { Home } from "./pages/Home";
import { Section } from "./pages/Section";
import { SectionItems } from "./pages/SectionItems";
import { ArticleReader } from "./pages/ArticleReader";
import { LyricsView } from "./pages/LyricsView";
import { PlaylistBrowse } from "./pages/PlaylistBrowse";
import { Player } from "./pages/Player";
import { BackgroundPicker } from "./pages/BackgroundPicker";
import { Remote } from "./pages/Remote";
import { Admin } from "./pages/Admin";

// Spatial (D-pad / arrow-key) navigation for TV-remote control.
init({ debug: false, visualDebug: false });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* TV (remote-driven): shared shell adds the SSE listener + QR badge */}
        <Route element={<TvLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/s/:id" element={<Section />} />
          <Route path="/s/:id/category/:category" element={<SectionItems />} />
          <Route path="/s/:id/article/:itemId" element={<ArticleReader />} />
          <Route path="/s/:id/lyrics/:itemId" element={<LyricsView />} />
          <Route path="/playlist/:listId" element={<PlaylistBrowse />} />
          <Route path="/play/:videoId" element={<Player />} />
          <Route path="/background-picker" element={<BackgroundPicker />} />
        </Route>
        {/* Phone (touch-driven) */}
        <Route path="/remote" element={<Remote />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
