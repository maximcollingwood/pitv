import { useEffect, useState } from "react";

// Per-device dark-mode preference, stored in localStorage on the TV's Chromium
// profile (which lives under /home/kiosk/, so it survives reboots).
const KEY = "pitv_dark";

export function readDarkPref(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useDarkMode(): [boolean, (next: boolean) => void] {
  const [dark, setDark] = useState<boolean>(readDarkPref);

  // Keep the body class in sync with state, but DO NOT write localStorage here
  // — the previous version wrote on every Home mount, which raced with user
  // toggles and could overwrite a fresh "1" with a stale "0".
  useEffect(() => {
    document.body.classList.toggle("dark", dark);
  }, [dark]);

  // Persist only on the user-initiated change.
  function setDarkAndPersist(next: boolean) {
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* ignore storage errors */
    }
    setDark(next);
  }

  return [dark, setDarkAndPersist];
}
