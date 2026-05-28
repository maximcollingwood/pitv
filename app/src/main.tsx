import React from "react";
import ReactDOM from "react-dom/client";
import { init } from "@noriginmedia/norigin-spatial-navigation";
import App from "./App";
import "./styles.css";

// Enable spatial (D-pad / arrow-key) navigation for TV-remote control.
init({
  debug: false,
  visualDebug: false,
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
