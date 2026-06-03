// Routes that should be visually exclusive — hide the global TV chrome
// (background-audio bar + scan-to-control QR badge) and dim the page chrome.
export const isImmersiveRoute = (pathname: string): boolean =>
  pathname.startsWith("/play") || /\/lyrics\//.test(pathname);
