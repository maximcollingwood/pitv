import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { byteRange } from "./http-files.js";
import { channelUrl, normalizeYouTube } from "./youtube.js";
import { runProcess, type ProcessRunner } from "./process-runner.js";

/** What the TV's player opens for a YouTube video. */
export interface StreamInfo {
  id: string; title: string; duration: number | null; live: boolean;
  /** The picture, or picture and sound together when YouTube offers them in one stream. */
  video: string;
  /** The sound, when YouTube sends it separately (every format above 360p). */
  audio: string | null;
  /** Only for a stream the player opens directly at YouTube (live videos); relayed streams need none. */
  userAgent: string | null;
  headers: Record<string, string>;
  /**
   * A live stream is YouTube's master HLS playlist, with every quality; the player
   * picks the best one up to this many bits per second (the H.264 one chosen here).
   */
  hlsBitrate: number | null;
}
export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
export interface StreamOptions {
  ytdlpPath?: string; runner?: ProcessRunner; fetcher?: Fetcher; timeoutMs?: number;
  /** The relay's piece size, how long a piece may send nothing, and how long a new address may be refused; smaller in tests. */
  chunkBytes?: number; stallMs?: number; activationMs?: number;
  /** Called after each lookup, for example to fill in a video's missing title. */
  onResolved?: (url: string, title: string) => void;
  /** Where YouTube's refusals and dropped connections are reported. */
  warn?: (message: string) => void;
}
export class StreamError extends Error {
  /** code "offair": a channel's live address while it is not streaming. */
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
interface Track { url: string; size: number | null; type: string; relayed: boolean }
interface Resolved {
  id: string; title: string; duration: number | null; live: boolean;
  picture: Track; sound: Track | null; userAgent: string | null; headers: Record<string, string>; expiresAt: number; resolvedAt: number;
  hlsBitrate: number | null;
}
interface Piece { controller: AbortController; release: () => void; response: Response }
interface Format { url?: string; vcodec?: string; acodec?: string; ext?: string; protocol?: string; http_headers?: Record<string, string>; manifest_url?: string; tbr?: number }
interface Info extends Format { id?: string; title?: string; duration?: number; is_live?: boolean; requested_formats?: Format[] }

// H.264 up to 1080p at 30 frames per second with AAC sound: the Pi decodes it in
// software with room to spare. Then the same at any frame rate; then the same over
// HLS, which is how live streams come; then anything at 720p or below, so an
// unusual video still plays.
const FORMAT = [
  "bv*[vcodec^=avc1][height<=1080][fps<=30][protocol=https]+ba[ext=m4a][protocol=https]",
  "bv*[vcodec^=avc1][height<=1080][protocol=https]+ba[ext=m4a][protocol=https]",
  "bv*[vcodec^=avc1][height<=1080][fps<=30]+ba", "bv*[vcodec^=avc1][height<=1080]+ba",
  "b[vcodec^=avc1][height<=1080]",
  "bv*[height<=720]+ba", "b[height<=720]", "b",
].join("/");
// YouTube serves a request for 10 MB or less at full speed (about 45 Mbit/s here)
// but holds a longer or open-ended one to about 5 Mbit/s, so the relay asks for
// the stream in pieces, as yt-dlp does.
export const RELAY_CHUNK = 8 * 1024 * 1024;
// A looked-up stream is handed to the player while it has this long left; a
// relayed one is looked up again whenever YouTube refuses its address.
const REUSE_MARGIN_MS = 30 * 60 * 1000;
// Without an expiry in the address, assume less than YouTube's usual six hours.
const DEFAULT_LIFETIME_MS = 3 * 60 * 60 * 1000;
const STALL_MS = 20000;
// YouTube refuses a newly issued address for its first moments: about 2.5 seconds
// for some clients' addresses (web_embedded), usually less. Until it is this old,
// a refused address is asked again instead of being looked up anew.
const ACTIVATION_MS = 8000;
// A channel's live address names its current stream for this long.
const LIVE_ALIAS_MS = 60 * 1000;
const WARM_QUEUE_LIMIT = 20;
const CACHE_LIMIT = 200;
const ID = /^[A-Za-z0-9_-]{11}$/;
// Only these of yt-dlp's request headers matter to YouTube's servers, as in mpv's own YouTube support.
const FORWARDED_HEADERS = ["Cookie", "Referer", "X-Forwarded-For"];
const TYPES: Record<string, string> = { mp4: "video/mp4", m4a: "audio/mp4", webm: "video/webm", weba: "audio/webm" };

/** yt-dlp's last error line without its "ERROR: [youtube] id:" prefix. */
export function extractorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const line = [...lines].reverse().find(entry => entry.startsWith("ERROR:")) ?? lines.pop() ?? "";
  const message = line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([A-Za-z0-9_-]{11}:\s*)?/, "").trim();
  if (/confirm you.re not a bot|sign in to confirm/i.test(message)) return "YouTube asked this device to prove it is not a bot. Try again in a few minutes.";
  return message || "YouTube did not return this video.";
}
function totalSize(response: Response) {
  const total = Number(/\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1]);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

/**
 * Plays YouTube videos straight from YouTube instead of from a downloaded copy.
 * yt-dlp looks up a video's stream addresses (cached until they near expiry,
 * shared between concurrent requests, and warmed one at a time while someone
 * browses), and the TV's player reads them through this relay on the loopback
 * interface. The relay fetches in pieces YouTube serves at full speed and looks
 * an expired address up again mid-stream, so the player sees one ordinary,
 * seekable file that never expires.
 */
export class StreamResolver {
  private readonly ytdlp: string;
  private readonly runner: ProcessRunner;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly chunk: number;
  private readonly stallMs: number;
  private readonly activationMs: number;
  private readonly onResolved: (url: string, title: string) => void;
  private readonly warn: (message: string) => void;
  private cache = new Map<string, Resolved>();
  private inflight = new Map<string, Promise<Resolved>>();
  private liveAliases = new Map<string, { id: string; at: number }>();
  private warmQueue: string[] = [];
  private warming = false;
  private closed = false;
  private controllers = new Set<AbortController>();
  constructor(options: StreamOptions = {}) {
    this.ytdlp = options.ytdlpPath ?? process.env.YTDLP_PATH ?? "yt-dlp";
    this.runner = options.runner ?? runProcess;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 45000;
    this.chunk = options.chunkBytes ?? RELAY_CHUNK;
    this.stallMs = options.stallMs ?? STALL_MS;
    this.activationMs = options.activationMs ?? ACTIVATION_MS;
    this.onResolved = options.onResolved ?? (() => {});
    this.warn = options.warn ?? (() => {});
  }
  private videoId(url: unknown) {
    let source;
    try { source = normalizeYouTube(url); } catch (error) { throw new StreamError(400, (error as Error).message); }
    if (!source.videoId || source.playlistId) throw new StreamError(400, source.channel ? "Open the channel to choose one of its videos" : "Choose a video within the playlist to play it");
    return source.videoId;
  }
  private usable(entry: Resolved | undefined, margin: number): entry is Resolved {
    return !!entry && entry.expiresAt - Date.now() > margin;
  }
  /**
   * What the player opens for a YouTube video, or for a channel's live address
   * (whatever it is streaming now). `fresh` looks it up again, after playback failed.
   */
  async resolve(url: unknown, fresh = false): Promise<StreamInfo> {
    let source;
    try { source = normalizeYouTube(url); } catch (error) { throw new StreamError(400, (error as Error).message); }
    const entry = source.live && source.channel ? await this.lookupLive(source.channel, fresh) : await this.lookup(this.videoId(url), fresh ? Infinity : REUSE_MARGIN_MS);
    const id = entry.id;
    const relay = (track: Track | null, name: string) => !track ? null : track.relayed ? `/api/stream/${id}/${name}` : track.url;
    const direct = !entry.picture.relayed || (entry.sound && !entry.sound.relayed);
    return { id, title: entry.title, duration: entry.duration, live: entry.live, video: relay(entry.picture, "video")!, audio: relay(entry.sound, "audio"),
      userAgent: direct ? entry.userAgent : null, headers: direct ? entry.headers : {}, hlsBitrate: entry.hlsBitrate };
  }
  private lookupLive(channel: string, fresh: boolean): Promise<Resolved> {
    const alias = this.liveAliases.get(channel);
    const cached = alias && this.cache.get(alias.id);
    if (!fresh && alias && Date.now() - alias.at < LIVE_ALIAS_MS && this.usable(cached, 60000)) return Promise.resolve(cached);
    if (this.closed) return Promise.reject(new StreamError(503, "The library service is shutting down."));
    const key = `live:${channel}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const promise = this.extract(channelUrl(channel, true), null).then(entry => {
      if (!entry.live) throw new StreamError(404, "Nothing is streaming on this channel at the moment.", "offair");
      this.liveAliases.set(channel, { id: entry.id, at: Date.now() });
      return entry;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
  /** A video's title from an earlier lookup, without asking YouTube. */
  knownTitle(url: unknown) {
    try { return this.cache.get(this.videoId(url))?.title || null; } catch { return null; }
  }
  /** Look the video (or what a channel streams live) up in the background so it starts at once when chosen. Never throws. */
  warm(url: unknown) {
    let id: string;
    try {
      const source = normalizeYouTube(url);
      if (source.live && source.channel) { void this.lookupLive(source.channel, false).catch(() => { /* the player says it is off air */ }); return; }
      id = this.videoId(url);
    } catch { return; }
    if (this.usable(this.cache.get(id), REUSE_MARGIN_MS) || this.inflight.has(id) || this.warmQueue.includes(id)) return;
    // The latest request is the likeliest to be played next.
    this.warmQueue.unshift(id);
    this.warmQueue.length = Math.min(this.warmQueue.length, WARM_QUEUE_LIMIT);
    void this.drainWarmQueue();
  }
  private async drainWarmQueue() {
    if (this.warming) return;
    this.warming = true;
    try {
      while (!this.closed && this.warmQueue.length) {
        await this.lookup(this.warmQueue.shift()!, REUSE_MARGIN_MS).catch(() => { /* the player looks it up again and shows the error */ });
      }
    } finally { this.warming = false; }
  }
  private lookup(id: string, margin: number): Promise<Resolved> {
    const cached = this.cache.get(id);
    if (this.usable(cached, margin)) return Promise.resolve(cached);
    if (this.closed) return Promise.reject(new StreamError(503, "The library service is shutting down."));
    const running = this.inflight.get(id);
    if (running) return running;
    const promise = this.extract(`https://www.youtube.com/watch?v=${id}`, id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, promise);
    return promise;
  }
  /** Look a video up at `url`; `known` is its ID, or null for a channel's live address. */
  private async extract(url: string, known: string | null): Promise<Resolved> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let output: string;
    try {
      output = await this.runner(this.ytdlp, ["--ignore-config", "--no-warnings", "--no-playlist", "--socket-timeout", "15",
        "--js-runtimes", `node:${process.execPath}`, "--format", FORMAT, "--dump-single-json", "--", url], { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted && !this.closed) throw new StreamError(502, "YouTube took too long to answer. Try again.");
      const message = extractorMessage(error);
      if (known === null && /not currently live|is not live/i.test(message)) throw new StreamError(404, "Nothing is streaming on this channel at the moment.", "offair");
      if (/live event will begin|premieres? in|scheduled/i.test(message)) throw new StreamError(404, message, "offair");
      throw new StreamError(502, message);
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
    let info: Info;
    try { info = JSON.parse(output) as Info; } catch { throw new StreamError(502, "YouTube returned an unreadable answer."); }
    const id = known ?? (info.id && ID.test(info.id) ? info.id : null);
    if (!id) throw new StreamError(502, "YouTube returned an unreadable answer.");
    const formats = info.requested_formats ?? [];
    const picture = formats.find(format => format.vcodec && format.vcodec !== "none") ?? (formats.length ? undefined : info);
    const sound = formats.find(format => format.acodec && format.acodec !== "none" && (!format.vcodec || format.vcodec === "none"));
    const track = (format: Format | undefined): Track | null => {
      if (!format?.url || !/^https:\/\//.test(format.url)) return null;
      const size = Number(new URL(format.url).searchParams.get("clen"));
      return { url: format.url, size: Number.isSafeInteger(size) && size > 0 ? size : null,
        type: TYPES[format.ext ?? ""] ?? "application/octet-stream", relayed: format.protocol === "https" };
    };
    let pictureTrack = track(picture), soundTrack = sound ? track(sound) : null, hlsBitrate: number | null = null;
    if (!pictureTrack || (sound && !soundTrack)) throw new StreamError(502, "YouTube offered no stream this player can use.");
    // A live stream plays from YouTube's master playlist, which carries picture and
    // sound together; the player reads its separate HLS parts out of step.
    if (info.is_live === true && picture?.manifest_url && /^https:\/\//.test(picture.manifest_url)) {
      pictureTrack = { url: picture.manifest_url, size: null, type: "application/vnd.apple.mpegurl", relayed: false };
      soundTrack = null;
      hlsBitrate = Number(picture.tbr) > 0 ? Math.ceil(Number(picture.tbr) * 1000) + 1000 : null;
    }
    const requestHeaders = picture?.http_headers ?? info.http_headers ?? {};
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_HEADERS) if (requestHeaders[name]) headers[name] = requestHeaders[name];
    const expire = Number(new URL(pictureTrack.url).searchParams.get("expire"));
    const entry: Resolved = {
      id, title: info.title ?? "", duration: Number(info.duration) > 0 ? Number(info.duration) : null, live: info.is_live === true,
      picture: pictureTrack, sound: soundTrack, userAgent: requestHeaders["User-Agent"] ?? null, headers,
      expiresAt: Number.isFinite(expire) && expire > 0 ? expire * 1000 : Date.now() + DEFAULT_LIFETIME_MS, resolvedAt: Date.now(), hlsBitrate,
    };
    this.cache.delete(id);
    this.cache.set(id, entry);
    for (const [key, cached] of this.cache) if (this.cache.size > CACHE_LIMIT || cached.expiresAt <= Date.now()) this.cache.delete(key);
    // A live stream's title changes with each broadcast; a channel's tile keeps its own.
    try { if (entry.title && known) this.onResolved(url, entry.title); } catch { /* a title update must not fail playback */ }
    return entry;
  }
  /**
   * One piece of a relayed track. A new address YouTube refuses is asked again
   * until it is a few seconds old; an older one (expired) is looked up again, once.
   */
  private async fetchRange(id: string, name: "video" | "audio", from: number, to: number, signal: AbortSignal) {
    let fresh = false, lookedUpAgain = false;
    for (;;) {
      const entry = await this.lookup(id, fresh ? Infinity : 60000);
      fresh = false;
      const track = name === "audio" ? entry.sound : entry.picture;
      if (!track?.relayed) throw new StreamError(404, "This video has no such stream.");
      const response = await this.fetcher(track.url, { headers: { Range: `bytes=${from}-${to}`, ...(entry.userAgent ? { "User-Agent": entry.userAgent } : {}), ...entry.headers }, signal });
      if (response.status === 206) return { response, track };
      await response.body?.cancel().catch(() => {});
      const refused = [401, 403, 404, 410].includes(response.status);
      if (refused && Date.now() - entry.resolvedAt < this.activationMs) { await delay(500, undefined, { signal }); continue; }
      this.warn(`YouTube answered HTTP ${response.status} for the ${name} of ${id} at byte ${from}${lookedUpAgain ? " after a fresh lookup" : ""}`);
      if (refused && !lookedUpAgain) { lookedUpAgain = fresh = true; continue; }
      throw new StreamError(502, `YouTube refused the stream (HTTP ${response.status}).`);
    }
  }
  /**
   * Relay a track to the player with HTTP range support. Resolves once the first
   * piece has arrived, so a failure before then is an HTTP error the player sees.
   */
  async relay(id: string, name: string, range: string | undefined, head: boolean, signal: AbortSignal) {
    if (!ID.test(id) || (name !== "video" && name !== "audio")) throw new StreamError(404, "Unknown stream.");
    const entry = await this.lookup(id, 60000);
    let track = name === "audio" ? entry.sound : entry.picture;
    if (!track?.relayed) throw new StreamError(404, "This video has no such stream.");
    // Each piece has its own cancellation, linked to the player's request.
    const piece = () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      return { controller, release: () => signal.removeEventListener("abort", abort) };
    };
    let first: Piece | null = null, size = track.size;
    const discard = async () => { if (!first) return; first.release(); await first.response.body?.cancel().catch(() => {}); first = null; };
    const fetchFirst = async (from: number, to: number) => {
      const handle = piece();
      try { const fetched = await this.fetchRange(id, name, from, to, handle.controller.signal); track = fetched.track; return { ...handle, response: fetched.response }; }
      catch (error) { handle.release(); throw error; }
    };
    if (size === null) {
      first = await fetchFirst(0, this.chunk - 1);
      size = totalSize(first.response);
      if (size === null) { await discard(); throw new StreamError(502, "YouTube did not say how long the stream is."); }
    }
    const wanted = byteRange(range, size);
    const headers: Record<string, string> = { "Content-Type": track.type, "Accept-Ranges": "bytes" };
    if (!wanted) { await discard(); return { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } }; }
    if (wanted.partial) headers["Content-Range"] = `bytes ${wanted.start}-${wanted.end}/${size}`;
    headers["Content-Length"] = String(wanted.end - wanted.start + 1);
    if (head) { await discard(); return { status: wanted.partial ? 206 : 200, headers }; }
    if (wanted.start !== 0) await discard();
    first ??= await fetchFirst(wanted.start, Math.min(wanted.end, wanted.start + this.chunk - 1));
    return { status: wanted.partial ? 206 : 200, headers, body: Readable.from(this.pieces(id, name, wanted.start, wanted.end, first, piece, signal), { objectMode: false }) };
  }
  private async *pieces(id: string, name: "video" | "audio", start: number, end: number, first: Piece, piece: () => Omit<Piece, "response">, signal: AbortSignal) {
    let offset = start, failures = 0;
    let current: Omit<Piece, "response"> & { response?: Response } = first;
    while (offset <= end && !signal.aborted) {
      // A piece that sends nothing for a while is dropped and asked for again.
      // Waiting for the player (its cache is full, or it is paused) does not count.
      let stall: NodeJS.Timeout | undefined;
      const watch = () => { clearTimeout(stall); stall = setTimeout(() => current.controller.abort(), this.stallMs); };
      try {
        watch();
        const response = current.response ?? (await this.fetchRange(id, name, offset, Math.min(end, offset + this.chunk - 1), current.controller.signal)).response;
        if (!response.body) throw new Error("YouTube sent no data.");
        for await (const data of response.body as unknown as AsyncIterable<Uint8Array>) {
          clearTimeout(stall);
          const bytes = data.byteLength > end - offset + 1 ? data.subarray(0, end - offset + 1) : data;
          offset += bytes.byteLength; failures = 0;
          yield bytes;
          if (offset > end || signal.aborted) break;
          watch();
        }
      } catch (error) {
        // The player went away (it seeks by reconnecting): end quietly.
        if (signal.aborted || this.closed) return;
        this.warn(`The ${name} of ${id} stopped at byte ${offset}: ${(error as Error).message}`);
        if (++failures > 3) throw error;
        await delay(1000 * failures);
      } finally {
        clearTimeout(stall);
        current.release();
        current.controller.abort();
      }
      current = piece();
    }
    current.release();
  }
  close() {
    this.closed = true;
    this.warmQueue = [];
    for (const controller of this.controllers) controller.abort();
  }
}
