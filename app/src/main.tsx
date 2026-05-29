import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { init } from "@noriginmedia/norigin-spatial-navigation";
import "./styles.css";

import { TvLayout } from "./components/TvLayout";
import { Home } from "./pages/Home";
import { Articles } from "./pages/Articles";
import { ArticleDetail } from "./pages/ArticleDetail";
import { Catalog } from "./pages/Catalog";
import { Kirtans } from "./pages/Kirtans";
import { Videos } from "./pages/Videos";
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
          <Route path="/articles" element={<Articles />} />
          <Route path="/articles/:id" element={<ArticleDetail />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/kirtans" element={<Kirtans />} />
          <Route path="/videos" element={<Videos />} />
        </Route>
        {/* Phone (touch-driven) */}
        <Route path="/remote" element={<Remote />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
