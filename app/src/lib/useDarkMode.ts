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

  useEffect(() => {
    document.body.classList.toggle("dark", dark);
    try {
      localStorage.setItem(KEY, dark ? "1" : "0");
    } catch {
      /* ignore storage errors */
    }
  }, [dark]);

  return [dark, setDark];
}
