import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { init } from "@noriginmedia/norigin-spatial-navigation";
import "./styles.css";

import { Home } from "./pages/Home";
import { Articles } from "./pages/Articles";
import { ArticleDetail } from "./pages/ArticleDetail";
import { Catalog } from "./pages/Catalog";
import { Kirtans } from "./pages/Kirtans";
import { Videos } from "./pages/Videos";
import { Manage } from "./pages/Manage";
import { Admin } from "./pages/Admin";

// Spatial (D-pad / arrow-key) navigation for TV-remote control.
init({ debug: false, visualDebug: false });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* TV (remote-driven) */}
        <Route path="/" element={<Home />} />
        <Route path="/articles" element={<Articles />} />
        <Route path="/articles/:id" element={<ArticleDetail />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/kirtans" element={<Kirtans />} />
        <Route path="/videos" element={<Videos />} />
        <Route path="/manage" element={<Manage />} />
        {/* Phone (touch-driven) content editor */}
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
