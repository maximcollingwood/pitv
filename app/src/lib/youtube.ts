export interface ParsedYouTube {
  kind: "video" | "playlist" | "unknown";
  id: string;
}

// Extract the video or playlist id from a watch / youtu.be / playlist URL.
export function parseYouTube(url: string): ParsedYouTube {
  try {
    const u = new URL(url);
    const list = u.searchParams.get("list");
    const v = u.searchParams.get("v");

    if (u.pathname === "/playlist" && list) return { kind: "playlist", id: list };
    if (v) return { kind: "video", id: v };
    if (u.hostname.includes("youtu.be")) return { kind: "video", id: u.pathname.slice(1) };
    if (u.pathname.startsWith("/embed/")) return { kind: "video", id: u.pathname.split("/")[2] };
    if (list) return { kind: "playlist", id: list };
  } catch {
    /* fall through */
  }
  return { kind: "unknown", id: "" };
}

// Load the YouTube IFrame Player API once; resolves when YT is ready.
let apiPromise: Promise<void> | null = null;
export function loadYouTubeApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const w = window as unknown as { YT?: { Player?: unknown }; onYouTubeIframeAPIReady?: () => void };
    if (w.YT && w.YT.Player) {
      resolve();
      return;
    }
    w.onYouTubeIframeAPIReady = () => resolve();
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}
