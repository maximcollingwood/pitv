import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Remote } from "./pages/Remote";
import "./tokens.css";
import "./styles.css";

const Admin = lazy(() => import("./pages/Admin").then((module) => ({ default: module.Admin })));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<main className="shell"><p role="status">Opening library…</p></main>}>
        <Routes>
          <Route path="/" element={<Navigate to="/remote" replace />} />
          <Route path="/remote" element={<Remote />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/remote" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>,
);
