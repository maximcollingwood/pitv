import type Database from "better-sqlite3";
import { mkdirSync, readdirSync, statSync, statfsSync, readFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { normalizeYouTube, normalizePlaylistId } from "./youtube.js";
import { runProcess, type ProcessRunner } from "./process-runner.js";

export type MediaKind = "audio" | "video";
export interface Asset {
  key: string; sourceUrl: string; kind: MediaKind; status: string; title: string;
  playbackUrl: string | null; progress: number; error: string | null;
}
interface AssetRow {
  key: string; source_url: string; kind: MediaKind; status: string; title: string;
  filename: string | null; bytes: number; progress: number; error: string | null;
  attempts: number; next_attempt: number; created_at: number; accessed_at: number; priority: number;
}
interface PlaylistRow { id: string; status: string; title: string; videos: string; error: string | null; attempts: number; created_at: number; updated_at: number; priority: number }
export interface MediaOptions {
  cacheDir: string; cacheLimitBytes?: number; maxAssetBytes?: number; queueLimit?: number;
  timeoutMs?: number; maxAttempts?: number; retryBaseMs?: number; playlistPrefetch?: number;
  minFreeBytes?: number;
  ytdlpPath?: string; ffmpegPath?: string; ffprobePath?: string; runner?: ProcessRunner;
  onEvent?: (event: unknown) => void;
}
// Library reconciliation also runs when a full queue drains; this interval only
// catches stale playlists (refreshed after six hours) on an otherwise idle device.
const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
export class MediaManager {
  readonly cacheDir: string;
  readonly cacheLimitBytes: number;
  readonly maxAssetBytes: number;
  private readonly queueLimit: number;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly prefetch: number;
  private readonly minFreeBytes: number;
  private readonly runner: ProcessRunner;
  private readonly ytdlp: string;
  private readonly ffmpeg?: string;
  private readonly ffprobe: string;
  private readonly onEvent: (event: unknown) => void;
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private controller?: AbortController;
  private stopped = false;
  private lastRefill = 0;
  private refillNeeded = false;
  private leases = new Map<string, number>();
  constructor(private readonly db: Database.Database, options: MediaOptions) {
    this.cacheDir = resolve(options.cacheDir);
    this.cacheLimitBytes = options.cacheLimitBytes ?? envNumber("MEDIA_CACHE_LIMIT_MB", 4096) * 1024 * 1024;
    this.maxAssetBytes = Math.min(options.maxAssetBytes ?? envNumber("MEDIA_MAX_ASSET_MB", 512) * 1024 * 1024, this.cacheLimitBytes);
    this.queueLimit = options.queueLimit ?? envNumber("MEDIA_QUEUE_LIMIT", 200);
    this.timeoutMs = options.timeoutMs ?? envNumber("MEDIA_JOB_TIMEOUT_MS", 1800000);
    this.maxAttempts = options.maxAttempts ?? envNumber("MEDIA_MAX_ATTEMPTS", 3);
    this.retryBaseMs = options.retryBaseMs ?? 15000;
    this.prefetch = options.playlistPrefetch ?? envNumber("MEDIA_PLAYLIST_PREFETCH", 10);
    this.minFreeBytes = options.minFreeBytes ?? envNumber("MEDIA_MIN_FREE_MB", 256) * 1024 * 1024;
    this.runner = options.runner ?? runProcess;
    this.ytdlp = options.ytdlpPath ?? process.env.YTDLP_PATH ?? "yt-dlp";
    this.ffmpeg = options.ffmpegPath ?? process.env.FFMPEG_PATH;
    this.ffprobe = options.ffprobePath ?? process.env.FFPROBE_PATH ?? "ffprobe";
    this.onEvent = options.onEvent ?? (() => {});
    mkdirSync(join(this.cacheDir, ".work"), { recursive: true });
    // Partials never enter the ready directory. Recovery only touches owned paths.
    for (const name of readdirSync(join(this.cacheDir, ".work"))) {
      if (/^(audio|video)-[A-Za-z0-9_-]{11}$/.test(name)) this.removeWorkDirectory(join(this.cacheDir, ".work", name));
    }
    this.db.prepare("UPDATE media_assets SET status='queued',progress=0,next_attempt=0 WHERE status='downloading'").run();
    this.db.prepare("UPDATE media_playlists SET status='queued',next_attempt=0 WHERE status='downloading'").run();
    for (const row of this.rows()) {
      if (row.status === "ready" && (!row.filename || !existsSync(join(this.cacheDir, row.filename))))
        this.db.prepare("UPDATE media_assets SET status='error',filename=NULL,bytes=0,error='Cached file is missing. Select Retry to prepare it again.' WHERE key=?").run(row.key);
    }
    // Reap completed files whose process died before committing its ready record.
    const owned = new Set(this.rows().map(r => r.filename));
    for (const name of readdirSync(this.cacheDir)) {
      if (/^(audio|video)-[A-Za-z0-9_-]{11}\.(mp4|m4a|webm|mkv|opus|mp3)$/.test(name) && !owned.has(name)) rmSync(join(this.cacheDir, name), { force: true });
    }
  }
  private rows() { return this.db.prepare("SELECT * FROM media_assets ORDER BY created_at,key").all() as AssetRow[]; }
  private removeWorkDirectory(path: string) {
    const ownedRoot = resolve(this.cacheDir, ".work") + sep;
    const target = resolve(path);
    if (!target.startsWith(ownedRoot) || !/^(audio|video)-[A-Za-z0-9_-]{11}$/.test(basename(target))) throw new Error("Invalid media work directory");
    rmSync(target, { recursive: true, force: true });
  }
  private row(key: string) { return this.db.prepare("SELECT * FROM media_assets WHERE key=?").get(key) as AssetRow | undefined; }
  private toAsset(row: AssetRow): Asset {
    return { key: row.key, sourceUrl: row.source_url, kind: row.kind, status: row.status, title: row.title,
      playbackUrl: row.status === "ready" ? `/api/media/${row.key}/file` : null, progress: row.progress, error: row.error };
  }
  get(key: string) { const row = this.row(key); return row && this.toAsset(row); }
  list() {
    const playlists = (this.db.prepare("SELECT * FROM media_playlists ORDER BY created_at,id").all() as PlaylistRow[]).map(row => ({
      id: row.id, title: row.title, sourceUrl: `https://www.youtube.com/playlist?list=${row.id}`,
      status: row.status, error: row.error, videoCount: (JSON.parse(row.videos) as unknown[]).length,
    }));
    return { assets: this.rows().map(row => this.toAsset(row)), playlists, cacheBytes: this.cacheBytes(), cacheLimitBytes: this.cacheLimitBytes };
  }
  private cacheBytes() { return (this.db.prepare("SELECT COALESCE(SUM(bytes),0) AS n FROM media_assets WHERE status='ready'").get() as { n: number }).n; }
  private pendingCount() { return (this.db.prepare("SELECT (SELECT COUNT(*) FROM media_assets WHERE status IN ('queued','downloading')) + (SELECT COUNT(*) FROM media_playlists WHERE status IN ('queued','downloading')) AS n").get() as { n: number }).n; }
  private checkQueue() {
    if (this.pendingCount() < this.queueLimit) return;
    // Library items skipped now are queued by the next reconciliation once a job frees space.
    this.refillNeeded = true;
    throw new Error("Media preparation queue is full. Try again after current imports finish.");
  }
  private emit(key: string) { this.onEvent({ type: "media", asset: this.get(key) }); }
  prepare(url: unknown, kind: MediaKind, retry = false, accessed = true) {
    if (!["audio", "video"].includes(kind)) throw new Error("kind must be audio or video");
    const source = normalizeYouTube(url);
    if (!source.videoId || source.playlistId) throw new Error("Choose a video within the playlist to prepare playback");
    const key = `${kind}-${source.videoId}`;
    const existing = this.row(key);
    if (existing) {
      if (existing.status === "error" && retry) return this.retry(key);
      if (existing.status === "ready" && existing.title) {
        const table = kind === "audio" ? "background_tracks" : "media_items";
        this.db.prepare(`UPDATE ${table} SET title=? WHERE youtube_url=? AND (title='' OR title=youtube_url)`).run(existing.title, source.url);
      }
      if (accessed) this.db.prepare("UPDATE media_assets SET accessed_at=?,priority=1 WHERE key=?").run(Date.now(), key);
      return this.toAsset(existing);
    }
    this.checkQueue();
    const now = Date.now();
    this.db.prepare("INSERT INTO media_assets(key,source_url,kind,created_at,updated_at,accessed_at,priority) VALUES(?,?,?,?,?,?,?)").run(key, source.url, kind, now, now, now, accessed ? 1 : 0);
    this.emit(key);
    return this.get(key)!;
  }
  retry(key: string) {
    const row = this.row(key);
    if (!row) throw new Error("Media asset not found");
    if (row.status !== "error") return this.toAsset(row);
    this.checkQueue();
    this.db.prepare("UPDATE media_assets SET status='queued',attempts=0,next_attempt=0,error=NULL,progress=0,priority=1,updated_at=? WHERE key=?").run(Date.now(), key);
    this.emit(key);
    return this.get(key)!;
  }
  playlist(id: string, retry = false, accessed = true) {
    normalizePlaylistId(id);
    let row = this.db.prepare("SELECT * FROM media_playlists WHERE id=?").get(id) as PlaylistRow | undefined;
    const cached = !!row;
    if (!row) {
      this.checkQueue();
      this.db.prepare("INSERT INTO media_playlists(id,created_at,updated_at,priority) VALUES(?,?,?,?)").run(id, Date.now(), Date.now(), accessed ? 1 : 0);
    } else if ((retry && ["error", "ready"].includes(row.status)) || (row.status === "ready" && Date.now() - row.updated_at > 6 * 60 * 60 * 1000)) {
      this.checkQueue();
      this.db.prepare("UPDATE media_playlists SET status='queued',attempts=0,next_attempt=0,error=NULL,priority=? WHERE id=?").run(accessed ? 1 : 0, id);
    }
    if (accessed) this.db.prepare("UPDATE media_playlists SET priority=1 WHERE id=?").run(id);
    row = this.db.prepare("SELECT * FROM media_playlists WHERE id=?").get(id) as PlaylistRow;
    if (row.title) this.db.prepare("UPDATE media_items SET title=? WHERE is_playlist=1 AND (title='' OR title=youtube_url) AND youtube_url=?").run(row.title, `https://www.youtube.com/playlist?list=${id}`);
    return { videos: JSON.parse(row.videos) as { id: string; title: string }[], source: cached ? "cache" : "extractor", status: row.status, error: row.error };
  }
  queueSource(url: string, kind: MediaKind) {
    const source = normalizeYouTube(url);
    if (source.playlistId) return this.playlist(source.playlistId, false, false);
    return this.prepare(source.url, kind, false, false);
  }
  private librarySources() {
    return this.db.prepare("SELECT id,youtube_url,is_playlist,'video' AS kind FROM media_items UNION ALL SELECT id,youtube_url,0 AS is_playlist,'audio' AS kind FROM background_tracks").all() as { id: number; youtube_url: string; is_playlist: number; kind: MediaKind }[];
  }
  /**
   * Reconcile the library with the queue: canonicalize legacy links, queue anything
   * not yet prepared and refresh stale playlists. Rows are only rewritten when their
   * link changes, so an unchanged library costs no writes.
   */
  queueExisting() {
    this.lastRefill = Date.now();
    this.refillNeeded = false;
    for (const row of this.librarySources()) {
      if (!row.youtube_url) continue;
      try {
        const source = normalizeYouTube(row.youtube_url, row.is_playlist === 1);
        if (row.kind === "audio" && source.playlistId) continue;
        const playlist = source.playlistId ? 1 : 0;
        if (row.kind === "video" && (source.url !== row.youtube_url || playlist !== row.is_playlist)) this.db.prepare("UPDATE media_items SET youtube_url=?,is_playlist=? WHERE id=?").run(source.url, playlist, row.id);
        else if (row.kind === "audio" && source.url !== row.youtube_url) this.db.prepare("UPDATE background_tracks SET youtube_url=? WHERE id=?").run(source.url, row.id);
        this.queueSource(source.url, row.kind);
      } catch { /* Bad URLs remain editable; a full queue sets refillNeeded. */ }
    }
  }
  /**
   * Cancel queued and failed jobs that no media item, background track or library
   * playlist references any more. Called when the library drops or replaces a link.
   * Ready files stay as cache (evicted by age) and an in-flight download finishes.
   */
  pruneOrphans() {
    const keys = new Set<string>(), playlists = new Set<string>();
    for (const row of this.librarySources()) {
      try {
        const source = normalizeYouTube(row.youtube_url, row.is_playlist === 1);
        if (source.playlistId) playlists.add(source.playlistId);
        else keys.add(`${row.kind}-${source.videoId}`);
      } catch { /* an invalid link references nothing */ }
    }
    for (const row of this.db.prepare("SELECT id,videos FROM media_playlists").all() as { id: string; videos: string }[]) {
      if (playlists.has(row.id)) for (const video of JSON.parse(row.videos) as { id: string }[]) keys.add(`video-${video.id}`);
    }
    const assets = this.db.prepare("SELECT key FROM media_assets WHERE status IN ('queued','error')").all() as { key: string }[];
    const lists = this.db.prepare("SELECT id FROM media_playlists WHERE status IN ('queued','error')").all() as { id: string }[];
    const dropAsset = this.db.prepare("DELETE FROM media_assets WHERE key=? AND status IN ('queued','error')");
    const dropPlaylist = this.db.prepare("DELETE FROM media_playlists WHERE id=? AND status IN ('queued','error')");
    return this.db.transaction(() => {
      let removed = 0;
      for (const { key } of assets) if (!keys.has(key)) removed += dropAsset.run(key).changes;
      for (const { id } of lists) if (!playlists.has(id)) removed += dropPlaylist.run(id).changes;
      return removed;
    })();
  }
  start() {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => { void this.tick().catch(error => this.onEvent({ type: "worker-error", error: String(error) })); }, 1000);
    this.timer.unref();
    void this.tick().catch(error => this.onEvent({ type: "worker-error", error: String(error) }));
  }
  async close() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.active;
  }
  // Exposed for deterministic tests; one tick processes at most one durable job.
  async tick(): Promise<void> {
    if (this.stopped || this.active) return;
    this.active = this.work();
    try { await this.active; } finally { this.active = undefined; }
  }
  private async work() {
    if ((this.refillNeeded && this.pendingCount() < this.queueLimit) || Date.now() - this.lastRefill > RECONCILE_INTERVAL_MS) this.queueExisting();
    const playlist = this.db.prepare("SELECT * FROM media_playlists WHERE status='queued' AND next_attempt<=? ORDER BY priority DESC,created_at LIMIT 1").get(Date.now()) as PlaylistRow | undefined;
    const asset = this.db.prepare("SELECT * FROM media_assets WHERE status='queued' AND next_attempt<=? ORDER BY priority DESC,created_at,key LIMIT 1").get(Date.now()) as AssetRow | undefined;
    if (!playlist && !asset) return;
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller?.abort(), this.timeoutMs);
    try {
      // Explicit playback/discovery requests move ahead of passive prefetch work.
      // The current import is allowed to finish; age breaks ties within a priority.
      if (playlist && (!asset || playlist.priority > asset.priority || (playlist.priority === asset.priority && playlist.created_at < asset.created_at))) await this.discover(playlist, this.controller.signal);
      else await this.download(asset!, this.controller.signal);
    } finally { clearTimeout(timeout); this.controller = undefined; }
  }
  private baseArgs() {
    const args = ["--ignore-config", "--no-warnings", "--socket-timeout", "20", "--retries", "2", "--fragment-retries", "2", "--js-runtimes", `node:${process.execPath}`];
    // yt-dlp treats --ffmpeg-location as a filesystem path, not a PATH command.
    // Omit it by default so the system ffmpeg/ffprobe are discovered normally.
    if (this.ffmpeg) args.push("--ffmpeg-location", this.ffmpeg);
    return args;
  }
  private fail(table: "media_assets" | "media_playlists", id: string, attempts: number, error: unknown) {
    const retry = !this.stopped && attempts < this.maxAttempts;
    const message = error instanceof Error ? error.message : String(error);
    this.db.prepare(`UPDATE ${table} SET status=?,error=?,next_attempt=?,updated_at=? WHERE ${table === "media_assets" ? "key" : "id"}=?`)
      .run(this.stopped || retry ? "queued" : "error", this.stopped ? null : message.slice(-1000), Date.now() + this.retryBaseMs * 2 ** Math.max(0, attempts - 1), Date.now(), id);
  }
  private async discover(row: PlaylistRow, signal: AbortSignal) {
    this.db.prepare("UPDATE media_playlists SET status='downloading',attempts=attempts+1,updated_at=? WHERE id=?").run(Date.now(), row.id);
    try {
      const output = await this.runner(this.ytdlp, [...this.baseArgs(), "--flat-playlist", "--dump-single-json", "--playlist-end", "500", "--", `https://www.youtube.com/playlist?list=${row.id}`], { signal });
      if (signal.aborted) throw new Error("Playlist preparation cancelled or timed out");
      const data = JSON.parse(output) as { title?: string; entries?: { id?: string; title?: string }[] };
      const videos = (data.entries ?? []).filter(e => e.id && /^[A-Za-z0-9_-]{11}$/.test(e.id)).slice(0, 500).map(e => ({ id: e.id!, title: e.title ?? "" }));
      this.db.prepare("UPDATE media_playlists SET status='ready',title=?,videos=?,error=NULL,updated_at=? WHERE id=?").run(data.title ?? "", JSON.stringify(videos), Date.now(), row.id);
      this.db.prepare("UPDATE media_items SET title=? WHERE is_playlist=1 AND (title='' OR title=youtube_url) AND youtube_url=?").run(data.title ?? "", `https://www.youtube.com/playlist?list=${row.id}`);
      for (const video of videos.slice(0, this.prefetch)) {
        try { this.prepare(`https://www.youtube.com/watch?v=${video.id}`, "video", false, false); } catch { break; }
      }
      this.onEvent({ type: "library" });
    } catch (error) { this.fail("media_playlists", row.id, row.attempts + 1, error); this.onEvent({ type: "library" }); }
  }
  private makeRoom(required: number) {
    for (const row of this.db.prepare("SELECT * FROM media_assets WHERE status='ready' ORDER BY accessed_at").all() as AssetRow[]) {
      if (this.cacheBytes() + required <= this.cacheLimitBytes) break;
      // A player may reopen the same file for seeking, so preserve recent playback.
      if (this.leases.has(row.key) || row.accessed_at > Date.now() - 30 * 60 * 1000) continue;
      if (row.filename) rmSync(join(this.cacheDir, row.filename), { force: true });
      this.db.prepare("UPDATE media_assets SET status='error',filename=NULL,bytes=0,progress=0,error='Removed from the local cache to free space. Select Retry to download again.' WHERE key=?").run(row.key);
      this.emit(row.key);
    }
    if (this.cacheBytes() + required > this.cacheLimitBytes) throw new Error("The media cache is full with recently used content. Try again later or increase MEDIA_CACHE_LIMIT_MB.");
  }
  private directoryBytes(directory: string): number {
    return readdirSync(directory, { withFileTypes: true }).reduce((sum, item) => sum + (item.isDirectory() ? this.directoryBytes(join(directory, item.name)) : statSync(join(directory, item.name)).size), 0);
  }
  private async download(row: AssetRow, signal: AbortSignal) {
    const directory = join(this.cacheDir, ".work", row.key);
    this.db.prepare("UPDATE media_assets SET status='downloading',attempts=attempts+1,error=NULL,progress=0,updated_at=? WHERE key=?").run(Date.now(), row.key);
    this.emit(row.key);
    let monitor: NodeJS.Timeout | undefined;
    let exceeded = false;
    try {
      // Download and transcode intermediates can occupy up to 3x the final asset limit.
      this.makeRoom(Math.min(this.maxAssetBytes * 3, this.cacheLimitBytes));
      const space = statfsSync(this.cacheDir);
      if (space.bavail * space.bsize < this.minFreeBytes + this.maxAssetBytes * 3) throw new Error("Insufficient free disk space for media preparation. Free space or lower MEDIA_MAX_ASSET_MB.");
      mkdirSync(directory, { recursive: true });
      monitor = setInterval(() => {
        try {
          const space = statfsSync(this.cacheDir);
          if (this.directoryBytes(directory) + this.cacheBytes() > this.cacheLimitBytes || space.bavail * space.bsize < this.minFreeBytes) { exceeded = true; this.controller?.abort(); }
        } catch { /* worker may have just moved the file */ }
      }, 1000);
      const args = [...this.baseArgs(), "--no-playlist", "--max-filesize", String(this.maxAssetBytes), "--write-info-json", "--newline", "--progress", "--progress-template", "download:PITV_PROGRESS:%(progress._percent_str)s", "--output", join(directory, "payload.%(ext)s")];
      if (row.kind === "audio") args.push("--format", "bestaudio[ext=m4a]/bestaudio/best", "--extract-audio", "--audio-format", "m4a");
      else args.push("--format", "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[vcodec^=avc1][ext=mp4][height<=1080]", "--merge-output-format", "mp4");
      args.push("--", row.source_url);
      let lastProgress = 0;
      await this.runner(this.ytdlp, args, { signal, onLine: line => {
        const match = /PITV_PROGRESS:\s*([\d.]+)%/.exec(line);
        if (!match || Date.now() - lastProgress < 1000) return;
        lastProgress = Date.now();
        this.db.prepare("UPDATE media_assets SET progress=? WHERE key=?").run(Math.min(99, Number(match[1])), row.key); this.emit(row.key);
      } });
      if (exceeded) throw new Error("Media exceeds the configured disk cache limit");
      if (signal.aborted) throw new Error("Media preparation cancelled or timed out");
      const filename = readdirSync(directory).find(name => /^payload\.(mp4|m4a|webm|mkv|opus|mp3)$/.test(name));
      if (!filename) throw new Error("No completed media file was produced; it may exceed the size limit or be unavailable");
      const size = statSync(join(directory, filename)).size;
      if (size <= 0 || size > this.maxAssetBytes) throw new Error("Media file is empty or exceeds the configured asset size limit");
      const probe = JSON.parse(await this.runner(this.ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", join(directory, filename)], { signal })) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
      if (!(Number(probe.format?.duration) > 0) || !probe.streams?.some(stream => stream.codec_type === (row.kind === "video" ? "video" : "audio"))) throw new Error("The completed file failed playback validation");
      const metadataFile = join(directory, "payload.info.json");
      const metadata = existsSync(metadataFile) ? JSON.parse(readFileSync(metadataFile, "utf8")) as { title?: string } : {};
      const finalName = `${row.key}.${filename.split(".").pop()}`;
      renameSync(join(directory, filename), join(this.cacheDir, finalName));
      this.db.prepare("UPDATE media_assets SET status='ready',title=?,filename=?,bytes=?,progress=100,error=NULL,updated_at=? WHERE key=?").run(metadata.title ?? "", finalName, size, Date.now(), row.key);
      const table = row.kind === "audio" ? "background_tracks" : "media_items";
      this.db.prepare(`UPDATE ${table} SET title=? WHERE youtube_url=? AND (title='' OR title=youtube_url)`).run(metadata.title ?? "", row.source_url);
      this.onEvent({ type: "library" });
    } catch (error) { this.fail("media_assets", row.key, row.attempts + 1, exceeded ? new Error("Media preparation exceeded the disk/cache limit. Free disk space or increase the configured cache.") : error); }
    finally { if (monitor) clearInterval(monitor); this.removeWorkDirectory(directory); this.emit(row.key); }
  }
  file(key: string) {
    const row = this.row(key);
    if (!row || row.status !== "ready" || !row.filename || basename(row.filename) !== row.filename) return undefined;
    const path = join(this.cacheDir, row.filename);
    if (!existsSync(path)) return undefined;
    this.db.prepare("UPDATE media_assets SET accessed_at=? WHERE key=?").run(Date.now(), key);
    return { path, size: statSync(path).size };
  }
  lease(key: string) {
    this.leases.set(key, (this.leases.get(key) ?? 0) + 1);
    return () => { const n = (this.leases.get(key) ?? 1) - 1; if (n) this.leases.set(key, n); else this.leases.delete(key); };
  }
}
