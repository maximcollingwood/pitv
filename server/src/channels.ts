import { runProcess, type ProcessRunner } from "./process-runner.js";
import { extractorMessage } from "./streams.js";
import { channelUrl } from "./youtube.js";

export interface ChannelVideo { id: string; title: string; duration: number | null }
export interface ChannelPlaylist { id: string; title: string }
/** What the TV shows for a YouTube channel: its live streams, latest videos and playlists. */
export interface Channel {
  url: string; title: string;
  live: ChannelVideo[]; videos: ChannelVideo[]; playlists: ChannelPlaylist[];
  status: "loading" | "ready" | "error"; error: string | null; updatedAt: number;
}
export interface ChannelOptions {
  ytdlpPath?: string; runner?: ProcessRunner; timeoutMs?: number;
  /** How often the lists and whether the channel is live are read again; shorter in tests. */
  refreshMs?: number; liveMs?: number;
  /** Called when a channel's name is known, to fill in an item's missing title. */
  onTitle?: (url: string, title: string) => void;
}
interface Entry extends Channel { liveCheckedAt: number; refreshing: boolean }
interface Tab { channel?: string; uploader?: string; title?: string; entries?: { id?: string; title?: string; duration?: number; live_status?: string }[] }

// Each tab is one quick request to YouTube (about a second), without the video
// challenges a stream lookup needs, and only while someone looks at the channel.
const LIMITS = { videos: 30, streams: 10, playlists: 30 } as const;
const REFRESH_MS = 60 * 60 * 1000;
const LIVE_MS = 90 * 1000;
const CACHE_LIMIT = 50;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST = /^[A-Za-z0-9_-]{2,128}$/;

/**
 * A small directory of YouTube channels, read with yt-dlp's quick listing of a
 * channel's tabs. Answers at once with what it knows and reads the channel again
 * in the background when that is old: the lists every hour, whether it is live
 * every minute and a half.
 */
export class ChannelDirectory {
  private readonly ytdlp: string;
  private readonly runner: ProcessRunner;
  private readonly timeoutMs: number;
  private readonly refreshMs: number;
  private readonly liveMs: number;
  private readonly onTitle: (url: string, title: string) => void;
  private entries = new Map<string, Entry>();
  private controllers = new Set<AbortController>();
  private closed = false;
  constructor(options: ChannelOptions = {}) {
    this.ytdlp = options.ytdlpPath ?? process.env.YTDLP_PATH ?? "yt-dlp";
    this.runner = options.runner ?? runProcess;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.refreshMs = options.refreshMs ?? REFRESH_MS;
    this.liveMs = options.liveMs ?? LIVE_MS;
    this.onTitle = options.onTitle ?? (() => {});
  }
  /** The channel as last read; `refresh` reads it all again, as after an error. */
  get(channel: string, refresh = false): Channel {
    const entry = this.entry(channel);
    this.keepFresh(channel, entry, refresh);
    return this.view(entry);
  }
  /** Read the channel and wait for it; for tests and callers that need the answer. */
  async load(channel: string): Promise<Channel> {
    const entry = this.entry(channel);
    this.keepFresh(channel, entry, true);
    while (entry.refreshing) await new Promise(resolve => setTimeout(resolve, 10));
    return this.view(entry);
  }
  private entry(channel: string) {
    let entry = this.entries.get(channel);
    if (!entry) {
      entry = { url: channelUrl(channel), title: "", live: [], videos: [], playlists: [], status: "loading", error: null, updatedAt: 0, liveCheckedAt: 0, refreshing: false };
      this.entries.set(channel, entry);
      for (const key of this.entries.keys()) if (this.entries.size > CACHE_LIMIT && key !== channel) this.entries.delete(key);
    }
    return entry;
  }
  private keepFresh(channel: string, entry: Entry, refresh: boolean) {
    // Asked again after an error: show that it is trying.
    if (refresh && entry.status === "error") entry.status = "loading";
    const now = Date.now();
    if (refresh || now - entry.updatedAt > this.refreshMs) void this.refresh(channel, entry, true);
    else if (now - entry.liveCheckedAt > this.liveMs) void this.refresh(channel, entry, false);
  }
  private view(entry: Entry): Channel {
    return { url: entry.url, title: entry.title, live: entry.live, videos: entry.videos, playlists: entry.playlists,
      status: entry.status, error: entry.error, updatedAt: entry.updatedAt };
  }
  private async tab(channel: string, name: keyof typeof LIMITS): Promise<Tab | null> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const output = await this.runner(this.ytdlp, ["--ignore-config", "--no-warnings", "--socket-timeout", "15", "--flat-playlist", "--dump-single-json",
        "--playlist-end", String(LIMITS[name]), "--", `${channelUrl(channel)}/${name}`], { signal: controller.signal });
      return JSON.parse(output) as Tab;
    } catch (error) {
      const message = extractorMessage(error);
      // Not every channel has every tab; a missing one is simply empty.
      if (/does not have an? \w+ tab/i.test(message)) return null;
      throw new Error(controller.signal.aborted && !this.closed ? "YouTube took too long to answer. Try again." : message);
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }
  private async refresh(channel: string, entry: Entry, full: boolean) {
    if (entry.refreshing || this.closed) return;
    entry.refreshing = true;
    try {
      const names = full ? (["videos", "streams", "playlists"] as const) : (["streams"] as const);
      const results = await Promise.all(names.map(name => this.tab(channel, name).then(tab => ({ name, tab, error: null as string | null }),
        (error: Error) => ({ name, tab: null as Tab | null, error: error.message }))));
      const videos = (tab: Tab | null) => (tab?.entries ?? []).filter(item => item.id && VIDEO.test(item.id))
        .map(item => ({ id: item.id!, title: item.title ?? "", duration: Number(item.duration) > 0 ? Number(item.duration) : null }));
      for (const { name, tab, error } of results) {
        if (error) continue;
        if (name === "videos") entry.videos = videos(tab);
        if (name === "streams") { entry.live = videos({ entries: (tab?.entries ?? []).filter(item => item.live_status === "is_live") }); entry.liveCheckedAt = Date.now(); }
        if (name === "playlists") entry.playlists = (tab?.entries ?? []).filter(item => item.id && PLAYLIST.test(item.id)).map(item => ({ id: item.id!, title: item.title ?? "" }));
        const title = tab?.channel ?? tab?.uploader ?? tab?.title?.replace(/ - (Videos|Live|Playlists)$/, "");
        if (title && title !== entry.title) { entry.title = title; try { this.onTitle(entry.url, title); } catch { /* a title update must not fail browsing */ } }
      }
      if (!full) return;
      const failure = results.find(result => result.error);
      if (results.every(result => result.error)) { entry.status = "error"; entry.error = failure!.error; }
      else { entry.status = "ready"; entry.error = null; entry.updatedAt = Date.now(); }
    } finally { entry.refreshing = false; }
  }
  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
  }
}
