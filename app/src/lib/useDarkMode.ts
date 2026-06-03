import { useEffect, useState } from "react";
import { api } from "./api";

// Dark mode is stored canonically on the server (in the settings table), so it
// survives anything Chromium's localStorage might do. localStorage is kept as
// a fast first-paint cache only — main.tsx reads it before React renders so
// there's no light flash on a dark-mode reload.
const KEY = "pitv_dark";

export function readDarkPref(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function writeCache(dark: boolean): void {
  try {
    localStorage.setItem(KEY, dark ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function useDarkMode(): [boolean, (next: boolean) => void] {
  const [dark, setDark] = useState<boolean>(readDarkPref);

  // Keep the body class in sync with state — does NOT write storage.
  useEffect(() => {
    document.body.classList.toggle("dark", dark);
  }, [dark]);

  // On mount, pull the canonical value from the server and reconcile.
  useEffect(() => {
    api
      .config()
      .then((c) => {
        if (typeof c.dark === "boolean") {
          setDark(c.dark);
          writeCache(c.dark);
        }
      })
      .catch(() => {
        /* offline / no server — keep the cached value */
      });
  }, []);

  // User-initiated change: write the cache, update state, then persist server.
  function setDarkAndPersist(next: boolean) {
    writeCache(next);
    setDark(next);
    api.setDark(next).catch(() => {
      /* even if the server call fails, the local state + cache stick */
    });
  }

  return [dark, setDarkAndPersist];
}
