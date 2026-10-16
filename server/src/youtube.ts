/**
 * A YouTube link in canonical form. `channel` is the channel's path on YouTube
 * ("@handle", "channel/UC…", "c/name" or "user/name"); `live` marks a channel's
 * live address, which plays whatever the channel is streaming at the time.
 */
export interface YouTubeSource { url: string; videoId?: string; playlistId?: string; channel?: string; live?: boolean }
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST = /^[A-Za-z0-9_-]{2,128}$/;
// Handles allow letters of any script, digits, underscores, hyphens and dots.
const HANDLE = /^@[\p{L}\p{N}._-]{3,100}$/u;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const LEGACY_NAME = /^[\p{L}\p{N}._-]{1,100}$/u;
export const CHANNEL_REF = /^(@[\p{L}\p{N}._-]{3,100}|channel\/UC[A-Za-z0-9_-]{22}|(c|user)\/[\p{L}\p{N}._-]{1,100})$/u;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
export function channelUrl(channel: string, live = false) { return `https://www.youtube.com/${channel}${live ? "/live" : ""}`; }
function channelPath(segments: string[]): { channel: string; tab?: string } | null {
  let name: string;
  try { name = decodeURIComponent(segments[0] ?? ""); } catch { return null; }
  if (HANDLE.test(name)) return { channel: name, tab: segments[1] };
  const value = (() => { try { return decodeURIComponent(segments[1] ?? ""); } catch { return ""; } })();
  if (name === "channel" && CHANNEL_ID.test(value)) return { channel: `channel/${value}`, tab: segments[2] };
  if ((name === "c" || name === "user") && LEGACY_NAME.test(value)) return { channel: `${name}/${value}`, tab: segments[2] };
  return null;
}
export function normalizeYouTube(input: unknown, explicitPlaylist = false): YouTubeSource {
  if (typeof input !== "string" || input.length > 2048) throw new Error("A YouTube video, playlist or channel URL is required");
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
  // A channel, on any of its tabs; its live tab tunes in to its live stream.
  const channel = !url.hostname.endsWith("youtu.be") ? channelPath(segments) : null;
  if (channel) {
    const live = channel.tab === "live";
    return { url: channelUrl(channel.channel, live), channel: channel.channel, ...(live ? { live } : {}) };
  }
  throw new Error("The URL must identify a YouTube video, playlist or channel");
}
export function normalizePlaylistId(input: string) {
  if (!PLAYLIST.test(input)) throw new Error("Invalid YouTube playlist ID");
  return input;
}
/** What a library link opens on the TV. */
export function linkKind(url: string, explicitPlaylist = false): "video" | "playlist" | "channel" | "live" {
  try {
    const source = normalizeYouTube(url, explicitPlaylist);
    return source.playlistId ? "playlist" : source.live ? "live" : source.channel ? "channel" : "video";
  } catch { return "video"; }
}
