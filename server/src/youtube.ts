export interface YouTubeSource { url: string; videoId?: string; playlistId?: string }
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST = /^[A-Za-z0-9_-]{2,128}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
export function normalizeYouTube(input: unknown, explicitPlaylist = false): YouTubeSource {
  if (typeof input !== "string" || input.length > 2048) throw new Error("A YouTube video or playlist URL is required");
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("A complete YouTube URL is required"); }
  if (!HOSTS.has(url.hostname.toLowerCase()) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) throw new Error("Only YouTube URLs are supported");
  const segments = url.pathname.split("/").filter(Boolean);
  const candidate = url.hostname.endsWith("youtu.be") ? segments[0] :
    ["shorts", "embed", "live"].includes(segments[0]) ? segments[1] :
    url.pathname === "/watch" ? url.searchParams.get("v") : null;
  const list = url.searchParams.get("list");
  if (candidate && !VIDEO.test(candidate)) throw new Error("Invalid YouTube video ID");
  if (list && !PLAYLIST.test(list)) throw new Error("Invalid YouTube playlist ID");
  // A copied watch/share link often contains a list context. It still identifies
  // one video unless the administrator explicitly selected a playlist.
  if (list && (explicitPlaylist || url.pathname === "/playlist" || !candidate)) return { url: `https://www.youtube.com/playlist?list=${list}`, playlistId: list };
  if (candidate) return { url: `https://www.youtube.com/watch?v=${candidate}`, videoId: candidate };
  throw new Error("The URL must identify a YouTube video or playlist");
}
export function normalizePlaylistId(input: string) {
  if (!PLAYLIST.test(input)) throw new Error("Invalid YouTube playlist ID");
  return input;
}
