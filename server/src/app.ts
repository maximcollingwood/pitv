import Fastify from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, resolve } from "node:path";
import { openDatabase } from "./database.js";
import { MediaManager, type MediaOptions } from "./media.js";
import { linkKind, normalizeYouTube } from "./youtube.js";
import { ChannelDirectory, type ChannelOptions } from "./channels.js";
import { EventStream } from "./events.js";
import { sendFile } from "./http-files.js";
import { StreamError, StreamResolver, type StreamOptions } from "./streams.js";
import { SYSTEM_ACTIONS, SystemControl, type SystemAction, type SystemOptions } from "./system.js";
import { TvControl, TvError, type TvOptions, type TvVolume } from "./tv.js";

export interface AppOptions {
  dbPath?: string; uploadsDir?: string; adminPin?: string; seed?: boolean;
  logger?: boolean; startWorker?: boolean; media?: Partial<MediaOptions>; streams?: StreamOptions; channels?: ChannelOptions; system?: Partial<SystemOptions>; tv?: Partial<TvOptions>;
}
const SECTION_TYPES: Record<string, { table: string; columns: string[]; orderBy: string }> = {
  articles: { table: "articles", columns: ["title", "body", "position"], orderBy: "position, title" },
  lyrics: { table: "articles", columns: ["title", "body", "position"], orderBy: "position, title" },
  media: { table: "media_items", columns: ["category", "title", "youtube_url", "is_playlist"], orderBy: "category, title" },
  catalog: { table: "books", columns: ["title", "author", "year", "category", "description"], orderBy: "title" },
  faq: { table: "faqs", columns: ["question", "book_title", "quote", "location", "cover_url", "position"], orderBy: "position, question" },
};
interface Section { id: number; type: string; name: string; position: number }
interface BgState { trackId: number | null; playing: boolean }

/** Construct without listening so temporary databases and fake extractors can exercise the real API. */
export function createApp(options: AppOptions = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath = options.dbPath ?? process.env.DB_PATH ?? resolve(here, "../data/library.db");
  const db = openDatabase(dbPath, options.seed ?? true);
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 12 * 1024 * 1024 });
  const adminPin = options.adminPin ?? process.env.ADMIN_PIN ?? "0000";
  const uploadsDir = options.uploadsDir ?? process.env.UPLOADS_DIR ?? resolve(dirname(dbPath), "uploads");
  mkdirSync(uploadsDir, { recursive: true });
  const deviceEvents = new EventStream(), remoteEvents = new EventStream(), backgroundEvents = new EventStream();
  const invalidate = () => deviceEvents.publish({ type: "library" });
  const system = new SystemControl({
    requestPath: process.env.SYSTEM_REQUEST_PATH ?? resolve(dirname(dbPath), "system/request"),
    updateLogPath: process.env.UPDATE_LOG_PATH ?? "/var/log/pitv-update.log",
    versionPath: process.env.VERSION_PATH ?? resolve(here, "../version.json"),
    dataDir: dirname(dbPath),
    rangePath: process.env.HDMI_RANGE_PATH ?? "/etc/kiosk/hdmi-range",
    ...options.system,
  });
  const tv = new TvControl({ file: process.env.TV_PAIRING_PATH ?? resolve(dirname(dbPath), "tv.json"), ...options.tv });
  const media = new MediaManager(db, {
    cacheDir: process.env.MEDIA_CACHE_DIR ?? resolve(dirname(dbPath), "media"), ...options.media,
    onEvent: event => { deviceEvents.publish(event); options.media?.onEvent?.(event); },
  });
  // Background work: downloading background music and looking videos up ahead of play.
  const backgroundWork = options.startWorker !== false && process.env.MEDIA_WORKER_DISABLED !== "1";
  // Videos play straight from YouTube. A lookup also fills in a title the
  // administrator left empty.
  const fillTitle = (url: string, title: string) =>
    db.prepare("UPDATE media_items SET title=? WHERE is_playlist=0 AND youtube_url=? AND (title='' OR title=youtube_url)").run(title, url).changes > 0;
  const streams = new StreamResolver({
    warn: message => app.log.warn(message),
    ...options.streams,
    onResolved: (url, title) => {
      if (fillTitle(url, title)) invalidate();
      options.streams?.onResolved?.(url, title);
    },
  });
  // A channel's name fills in an unnamed channel item, and "· Live" one for its live stream.
  const channels = new ChannelDirectory({
    ...options.channels,
    onTitle: (url, title) => {
      const statement = db.prepare("UPDATE media_items SET title=? WHERE youtube_url=? AND (title='' OR title=youtube_url)");
      if (statement.run(title, url).changes + statement.run(`${title} · Live`, `${url}/live`).changes) invalidate();
      options.channels?.onTitle?.(url, title);
    },
  });
  const loopback = (ip: string) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
  const getSection = (id: string | number) => db.prepare("SELECT * FROM sections WHERE id=?").get(id) as Section | undefined;
  const getSettings = (): Record<string, string> => Object.fromEntries((db.prepare("SELECT key,value FROM settings").all() as { key: string; value: string }[]).map(r => [r.key, r.value]));
  const settingsUpsert = db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const settings = getSettings();
  const bgState: BgState = {
    trackId: settings.bg_track_id && Number.isSafeInteger(Number(settings.bg_track_id)) ? Number(settings.bg_track_id) : null,
    playing: settings.bg_playing === "1",
  };
  const listBgTracks = () => db.prepare("SELECT id,title,youtube_url,position FROM background_tracks ORDER BY position,id").all();
  const background = () => ({ tracks: listBgTracks(), state: bgState });
  function persistBg() {
    settingsUpsert.run("bg_track_id", bgState.trackId == null ? "" : String(bgState.trackId));
    settingsUpsert.run("bg_playing", bgState.playing ? "1" : "0");
  }
  function broadcastBg() { backgroundEvents.publish(background()); deviceEvents.publish({ type: "background", ...background() }); }
  const info = () => ({ hostname: os.hostname(), remoteUrl: `http://${os.hostname()}.local/remote`, adminUrl: `http://${os.hostname()}.local/admin` });
  const config = () => {
    const settings = getSettings();
    // Guest Wi-Fi the screen shows so visitors can reach the remote. It is on the
    // screen for anyone to read, so it is not treated as a secret here either.
    const wifi = settings.wifi_ssid ? { ssid: settings.wifi_ssid, password: settings.wifi_password ?? "" } : null;
    return { title: settings.title ?? "PiTV", subtitle: settings.subtitle ?? "", dark: settings.dark_mode !== "0", hero: settings.hero_image ?? "", wifi,
      sections: db.prepare("SELECT id,type,name,position FROM sections ORDER BY position,id").all() as Section[] };
  };
  const sectionItems = (section: Section) => {
    const cfg = SECTION_TYPES[section.type];
    const rows = cfg ? db.prepare(`SELECT * FROM ${cfg.table} WHERE section_id=? ORDER BY ${cfg.orderBy}`).all(section.id) as Record<string, unknown>[] : [];
    // What each video link opens on the TV: a video, a playlist, a channel or a channel's live stream.
    return section.type === "media" ? rows.map(row => ({ ...row, kind: linkKind(String(row.youtube_url ?? ""), row.is_playlist === 1) })) : rows;
  };
  let volume = Number(settings.volume ?? "0.05");
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) volume = 0.05;
  // tv: the TV's power as the screen follows it over HDMI-CEC; null without CEC.
  let deviceStatus = { page: "home", title: "", playing: false, position: 0, duration: 0, error: "", tv: null as "on" | "standby" | null, updatedAt: 0 };
  const status = () => ({ ...deviceStatus, connected: deviceStatus.updatedAt > 0 && Date.now() - deviceStatus.updatedAt < 15000 });
  // The TV's own volume (a paired Vizio SmartCast TV), followed so the phones and
  // the screen show changes made with the TV's remote too.
  let tvState = { available: false, level: 0, muted: false };
  function publishTv(next: typeof tvState) {
    if (next.available === tvState.available && next.level === tvState.level && next.muted === tvState.muted) return;
    tvState = next; deviceEvents.publish({ type: "tvVolume", ...tvState });
  }
  async function readTv() {
    try { publishTv({ available: true, ...await tv.volume() }); }
    catch { publishTv({ ...tvState, available: false }); }
    return tvState;
  }
  async function changeTv(change: () => Promise<TvVolume>) {
    try { publishTv({ available: true, ...await change() }); return { paired: true, ...tvState }; }
    catch (error) {
      if (!(error instanceof TvError) || error.status !== 400) publishTv({ ...tvState, available: false });
      throw error;
    }
  }
  const tvStatus = () => ({ ...tv.status(), available: tvState.available });
  const tvFailure = (error: unknown) => error instanceof TvError ? { status: error.status, error: error.message } : { status: 504, error: "The TV is not answering on the network." };
  // Asked every 5 seconds while the TV is on (the screen follows its power over
  // CEC), every 30 seconds while that is unknown, never while it is in standby.
  // A TV that dropped off the Wi-Fi takes seconds to fail, so checks never overlap.
  let tvTicks = 0, tvChecking = false;
  const tvPoll = setInterval(() => {
    const power = status().connected ? status().tv : null;
    if (!tv.paired || power === "standby") { publishTv({ ...tvState, available: false }); return; }
    if (tvChecking || (power !== "on" && ++tvTicks % 6 !== 0)) return;
    tvChecking = true;
    void readTv().finally(() => { tvChecking = false; });
  }, 5000);
  tvPoll.unref();
  const tokens = new Map<string, number>();
  function issueToken() {
    for (const [token, expiry] of tokens) if (expiry <= Date.now()) tokens.delete(token);
    const token = randomUUID(); tokens.set(token, Date.now() + 8 * 60 * 60 * 1000); return token;
  }
  function tokenValid(token: string | undefined) { return !!token && (tokens.get(token) ?? 0) > Date.now(); }
  function normalizeSource(body: Record<string, unknown>, single = false) {
    const source = normalizeYouTube(body.youtube_url, !single && (body.is_playlist === 1 || body.is_playlist === true));
    if (single && (source.playlistId || source.channel)) throw new Error("Background audio requires a YouTube video URL.");
    body.youtube_url = source.url;
    if (!single) body.is_playlist = source.playlistId ? 1 : 0;
    if (body.title === undefined || body.title === null) body.title = "";
    return source;
  }
  function queueSaved(url: string, kind: "audio" | "video") {
    try {
      // A video streams when played; looking it up now fills in a missing title
      // and makes it start at once.
      const source = normalizeYouTube(url);
      // A channel is read when someone opens it; reading it now also names it.
      if (kind === "video" && source.channel) { if (backgroundWork) channels.get(source.channel); }
      else if (kind === "video" && !source.playlistId) {
        const title = streams.knownTitle(url);
        if (title) fillTitle(url, title); else if (backgroundWork) streams.warm(url);
      } else media.queueSource(url, kind);
    } catch (error) { app.log.warn({ error: String(error) }, "Media import deferred until queue space is available"); }
  }

  app.get("/api/health", async () => ({ status: "ok", player: "native" }));
  app.get("/api/info", async () => info());
  app.get("/api/config", async () => config());
  app.get("/api/library", async () => {
    const current = config();
    return { config: current, items: Object.fromEntries(current.sections.map(section => [String(section.id), sectionItems(section)])), background: background(), info: info(), volume, tv: tvState };
  });
  app.get<{ Params: { id: string } }>("/api/sections/:id/items", async (req, reply) => {
    const section = getSection(req.params.id);
    return section && SECTION_TYPES[section.type] ? sectionItems(section) : reply.code(404).send({ error: "not found" });
  });
  app.post<{ Body: { dark?: boolean } }>("/api/dark-mode", async (req, reply) => {
    if (typeof req.body?.dark !== "boolean") return reply.code(400).send({ error: "dark must be a boolean" });
    settingsUpsert.run("dark_mode", req.body.dark ? "1" : "0"); invalidate(); return { dark: req.body.dark };
  });
  app.get("/api/background/tracks", async () => listBgTracks());
  app.get("/api/background/state", async () => bgState);
  app.post<{ Body: { trackId?: number | null; playing?: boolean } }>("/api/background/state", async (req, reply) => {
    const body = req.body ?? {};
    if (body.trackId !== undefined && body.trackId !== null && (!Number.isSafeInteger(body.trackId) || !db.prepare("SELECT id FROM background_tracks WHERE id=?").get(body.trackId))) return reply.code(400).send({ error: "Unknown background track" });
    if (body.playing !== undefined && typeof body.playing !== "boolean") return reply.code(400).send({ error: "playing must be a boolean" });
    if (body.trackId !== undefined) bgState.trackId = body.trackId;
    if (body.playing !== undefined) bgState.playing = body.playing;
    if (bgState.trackId === null) bgState.playing = false;
    persistBg(); broadcastBg(); return bgState;
  });
  app.get("/api/background/events", (req, reply) => backgroundEvents.connect(req, reply, background()));
  app.get("/api/device/events", (req, reply) => deviceEvents.connect(req, reply, { type: "library" }));
  app.get("/api/remote/events", (req, reply) => remoteEvents.connect(req, reply));
  app.get("/api/device/status", async () => status());
  app.post<{ Body: Record<string, unknown> }>("/api/device/status", async (req, reply) => {
    if (!loopback(req.ip)) return reply.code(403).send({ error: "Only the local player can publish status" });
    const body = req.body ?? {};
    const seconds = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
    const previous = status();
    deviceStatus = { page: String(body.page ?? "home").slice(0, 100), title: String(body.title ?? "").slice(0, 500), playing: body.playing === true,
      position: seconds(body.position), duration: seconds(body.duration), error: String(body.error ?? "").slice(0, 1000),
      tv: body.tv === "on" || body.tv === "standby" ? body.tv : null, updatedAt: Date.now() };
    // Phones follow what the screen shows (the remote's hints change in the player).
    // Position alone changes every heartbeat, so it does not trigger an event.
    const current = status();
    if (!previous.connected || (["page", "title", "playing", "error", "tv"] as const).some(key => previous[key] !== current[key])) deviceEvents.publish({ type: "status", ...current });
    return current;
  });
  app.post<{ Body: { action?: string } }>("/api/remote/press", async (req, reply) => {
    const action = req.body?.action;
    if (!action || !["up", "down", "left", "right", "select", "back", "home", "power"].includes(action)) return reply.code(400).send({ error: "bad action" });
    remoteEvents.publish({ action }); deviceEvents.publish({ type: "remote", action }); return { ok: true, clients: remoteEvents.size + deviceEvents.size };
  });
  app.get("/api/tv", async () => tv.paired ? { paired: true, ...await readTv() } : { paired: false, ...tvState });
  app.post<{ Body: { level?: unknown; step?: unknown; muted?: unknown } }>("/api/tv/volume", async (req, reply) => {
    const { level, step, muted } = req.body ?? {};
    try {
      if (typeof level === "number" && Number.isFinite(level) && level >= 0 && level <= 100) return await changeTv(() => tv.setVolume(level));
      if (typeof step === "number" && Number.isInteger(step) && step !== 0 && Math.abs(step) <= 10) return await changeTv(() => tv.step(step));
      if (typeof muted === "boolean") return await changeTv(() => tv.setMuted(muted));
      return reply.code(400).send({ error: "Send a level from 0 to 100, a step of up to 10, or muted." });
    } catch (error) { const failure = tvFailure(error); return reply.code(failure.status).send({ error: failure.error }); }
  });
  app.get("/api/system/volume", async () => ({ level: volume }));
  app.post<{ Body: { level?: number } }>("/api/system/volume", async (req, reply) => {
    const level = req.body?.level;
    if (typeof level !== "number" || !Number.isFinite(level) || level < 0 || level > 1) return reply.code(400).send({ error: "level must be a number between 0 and 1" });
    volume = Math.round(level * 100) / 100; settingsUpsert.run("volume", String(volume));
    deviceEvents.publish({ type: "volume", level: volume }); return { level: volume };
  });
  app.get<{ Querystring: { list?: string; retry?: string } }>("/api/playlist", async (req, reply) => {
    try { return media.playlist(req.query.list ?? "", req.query.retry === "1"); }
    catch (error) { return reply.code(400).send({ error: String((error as Error).message) }); }
  });
  app.post<{ Body: { url?: string; kind?: "audio" | "video"; retry?: boolean } }>("/api/media/prepare", async (req, reply) => {
    try { return media.prepare(req.body?.url, req.body?.kind ?? "audio", req.body?.retry === true); }
    catch (error) { return reply.code(400).send({ error: String((error as Error).message) }); }
  });
  // The TV's player: a video's streams, and the relay it reads them through. Only
  // the local player uses these (nginx refuses them from the network too).
  app.get<{ Querystring: { url?: string; fresh?: string } }>("/api/stream", async (req, reply) => {
    if (!loopback(req.ip)) return reply.code(403).send({ error: "Only the local player can open streams" });
    try { return await streams.resolve(req.query.url, req.query.fresh === "1"); }
    catch (error) { return reply.code(error instanceof StreamError ? error.status : 502).send({ error: (error as Error).message, code: error instanceof StreamError ? error.code : undefined }); }
  });
  // A channel's live streams, latest videos and playlists; answers at once with what
  // is known (status "loading" the first time) and reads the channel again when old.
  app.get<{ Querystring: { url?: string; refresh?: string } }>("/api/channel", async (req, reply) => {
    let source;
    try { source = normalizeYouTube(req.query.url); } catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
    if (!source.channel) return reply.code(400).send({ error: "The URL must identify a YouTube channel" });
    return channels.get(source.channel, req.query.refresh === "1");
  });
  app.post<{ Body: { url?: string } }>("/api/stream/warm", async (req, reply) => {
    if (!loopback(req.ip)) return reply.code(403).send({ error: "Only the local player can open streams" });
    streams.warm(req.body?.url);
    return reply.code(202).send({ ok: true });
  });
  app.route<{ Params: { id: string; track: string } }>({ method: ["GET", "HEAD"], url: "/api/stream/:id/:track", handler: async (req, reply) => {
    if (!loopback(req.ip)) return reply.code(403).send({ error: "Only the local player can open streams" });
    // The player closes the connection to seek; stop fetching for it then.
    const controller = new AbortController();
    reply.raw.once("close", () => controller.abort());
    try {
      const relayed = await streams.relay(req.params.id, req.params.track, req.headers.range, req.method === "HEAD", controller.signal);
      reply.code(relayed.status).headers(relayed.headers);
      return relayed.body ? reply.send(relayed.body) : reply.send();
    } catch (error) {
      if (controller.signal.aborted) return reply.code(499).send();
      return reply.code(error instanceof StreamError ? error.status : 502).send({ error: (error as Error).message });
    }
  } });
  app.get<{ Params: { key: string } }>("/api/media/:key", async (req, reply) => media.get(req.params.key) ?? reply.code(404).send({ error: "Media asset not found" }));
  app.route<{ Params: { key: string } }>({ method: ["GET", "HEAD"], url: "/api/media/:key/file", handler: async (req, reply) => {
    const file = media.file(req.params.key);
    if (!file) return reply.code(404).send({ error: "Media is not ready" });
    return sendFile(req, reply, file.path, file.size, media.lease(req.params.key));
  } });
  app.route<{ Params: { name: string } }>({ method: ["GET", "HEAD"], url: "/uploads/:name", handler: async (req, reply) => {
    const name = req.params.name;
    if (!name || basename(name) !== name || !/^[a-zA-Z0-9-]+\.(png|jpg|jpeg|webp|gif)$/.test(name)) return reply.code(404).send();
    const path = resolve(uploadsDir, name);
    if (!existsSync(path) || !statSync(path).isFile()) return reply.code(404).send();
    return sendFile(req, reply, path, statSync(path).size);
  } });
  app.post<{ Body: { pin?: string } }>("/api/admin/login", async (req, reply) => {
    const pin = Buffer.from(String(req.body?.pin ?? "")), expected = Buffer.from(adminPin);
    if (pin.length !== expected.length || !timingSafeEqual(pin, expected)) { await new Promise(r => setTimeout(r, 400)); return reply.code(401).send({ error: "invalid pin" }); }
    return { token: issueToken() };
  });

app.register(async (admin) => {
  admin.addHook("preHandler", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!tokenValid(token)) return reply.code(401).send({ error: "unauthorized" });
  });
  admin.addHook("onResponse", async (req, reply) => {
    if (["POST", "PUT", "DELETE"].includes(req.method) && reply.statusCode < 400 && !req.url.startsWith("/api/admin/system")) invalidate();
  });

  // System page: status, updates and restarts.
  admin.get("/api/admin/system", async () => {
    const [update, device] = await Promise.all([system.updateState(), system.device()]);
    return { screen: status(), version: system.version(), update, device, colourRange: system.colourRange(), tv: tvStatus() };
  });
  // Pairing with the TV: without a PIN the TV is found and shows one; with it, pairing completes.
  admin.post<{ Body: { pin?: unknown } }>("/api/admin/system/tv/pair", async (req, reply) => {
    try {
      if (typeof req.body?.pin !== "string") { await tv.startPairing(); return tvStatus(); }
      await tv.finishPairing(req.body.pin.trim());
      await readTv();
      return tvStatus();
    } catch (error) { const failure = tvFailure(error); return reply.code(failure.status).send({ error: failure.error }); }
  });
  admin.delete("/api/admin/system/tv", async () => { tv.forget(); publishTv({ ...tvState, available: false }); return tvStatus(); });
  // A test card on the TV for judging its colours; any remote button closes it.
  admin.post<{ Body: { show?: unknown } }>("/api/admin/system/colour-check", async (req, reply) => {
    if (!status().connected) return reply.code(409).send({ error: "The screen is not connected." });
    deviceEvents.publish({ type: "colourCheck", show: req.body?.show !== false });
    return { ok: true };
  });
  // Separate because it waits on the network (git ls-remote).
  admin.get<{ Querystring: { force?: string } }>("/api/admin/system/latest", async (req) => ({ latest: await system.latest(req.query.force === "1") }));
  admin.get("/api/admin/system/update-log", async () => ({ lines: system.updateLog() }));
  admin.post<{ Params: { action: string } }>("/api/admin/system/:action", async (req, reply) => {
    const action = req.params.action as SystemAction;
    if (!SYSTEM_ACTIONS.includes(action)) return reply.code(404).send({ error: "Unknown system action" });
    if (action === "update") {
      if (!system.version().selfUpdate) return reply.code(409).send({ error: "This machine does not update itself. In the development VM, run vagrant provision." });
      if ((await system.updateState())?.running) return reply.code(409).send({ error: "An update is already running." });
    }
    if (action.startsWith("range-") && system.colourRange() === null) return reply.code(409).send({ error: "This machine does not manage the screen's colour range." });
    if (!system.request(action)) return reply.code(503).send({ error: "System controls are not set up on this machine." });
    app.log.info({ action }, "System action requested from the admin page");
    return reply.code(202).send({ ok: true });
  });
  admin.get("/api/admin/media", async () => media.list());
  admin.post<{ Params: { key: string } }>("/api/admin/media/:key/retry", async (req, reply) => {
    if (!media.get(req.params.key)) return reply.code(404).send({ error: "Media asset not found" });
    try { return media.retry(req.params.key); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });

  // Settings (title, subtitle, ...).
  admin.get("/api/admin/settings", async () => getSettings());
  admin.put<{ Body: Record<string, string> }>("/api/admin/settings", async (req, reply) => {
    const body = req.body ?? {};
    const nextVolume = body.volume === undefined ? volume : Number(body.volume);
    const nextTrack = body.bg_track_id === undefined ? bgState.trackId : body.bg_track_id === "" ? null : Number(body.bg_track_id);
    if (!Number.isFinite(nextVolume) || nextVolume < 0 || nextVolume > 1) return reply.code(400).send({ error: "volume must be between 0 and 1" });
    if (nextTrack !== null && (!Number.isSafeInteger(nextTrack) || !db.prepare("SELECT id FROM background_tracks WHERE id=?").get(nextTrack))) return reply.code(400).send({ error: "Unknown background track" });
    if (body.bg_playing !== undefined && !["0", "1"].includes(body.bg_playing)) return reply.code(400).send({ error: "bg_playing must be 0 or 1" });
    if (body.wifi_ssid !== undefined) body.wifi_ssid = String(body.wifi_ssid).trim();
    if (body.wifi_ssid && Buffer.byteLength(body.wifi_ssid) > 32) return reply.code(400).send({ error: "A Wi-Fi network name is at most 32 characters." });
    if (body.wifi_password && (body.wifi_password.length < 8 || body.wifi_password.length > 63)) return reply.code(400).send({ error: "A Wi-Fi password is 8 to 63 characters. Leave it empty for an open network." });
    const stmt = db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    db.transaction(() => { for (const [k, v] of Object.entries(body)) stmt.run(k, String(v)); })();
    if (body.volume !== undefined) { volume = nextVolume; deviceEvents.publish({ type: "volume", level: volume }); }
    if (body.bg_track_id !== undefined || body.bg_playing !== undefined) {
      bgState.trackId = nextTrack;
      if (body.bg_playing !== undefined) bgState.playing = body.bg_playing === "1";
      if (nextTrack === null) bgState.playing = false;
      persistBg(); broadcastBg();
    }
    return getSettings();
  });

  // Best-effort delete of a file previously written into uploadsDir via the
  // upload endpoints. Confined to that directory by path-resolving the URL's
  // basename so a stored value like "../../etc/passwd" can't escape.
  function unlinkUpload(url: unknown) {
    if (typeof url !== "string" || !url.startsWith("/uploads/")) return;
    const name = url.slice("/uploads/".length);
    if (!name || name.includes("/") || name.includes("\\")) return;
    try { unlinkSync(resolve(uploadsDir, name)); } catch { /* ignore */ }
  }

  // Hero image (full-width banner on the home screen). Stored as a file on
  // disk, served by nginx from /uploads/. The base64 round-trip keeps the
  // endpoint plain JSON (no @fastify/multipart dep).
  function clearHeroFiles() {
    try {
      for (const f of readdirSync(uploadsDir)) {
        if (f.startsWith("hero-")) {
          try { unlinkSync(resolve(uploadsDir, f)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  admin.post<{ Body: { data?: string; mime?: string } }>(
    "/api/admin/hero",
    async (req, reply) => {
      const data = req.body?.data;
      if (!data) return reply.code(400).send({ error: "data required" });
      const mime = (req.body?.mime ?? "").toLowerCase();
      const ext =
        mime.includes("png")  ? "png"  :
        mime.includes("webp") ? "webp" :
        mime.includes("gif")  ? "gif"  :
                                "jpg";
      const b64 = data.includes(",") ? data.split(",", 2)[1] : data;
      let buf: Buffer;
      try {
        buf = Buffer.from(b64, "base64");
      } catch {
        return reply.code(400).send({ error: "invalid base64" });
      }
      clearHeroFiles();
      const filename = `hero-${Date.now()}.${ext}`;
      writeFileSync(resolve(uploadsDir, filename), buf);
      const url = `/uploads/${filename}`;
      settingsUpsert.run("hero_image", url);
      return { url };
    },
  );

  admin.delete("/api/admin/hero", async () => {
    clearHeroFiles();
    settingsUpsert.run("hero_image", "");
    return { ok: true };
  });

  // Generic per-item image upload. The hero endpoint above is hero-specific
  // (one global slot, prior files cleared). This one is for item-owned images
  // — the caller stores the returned URL on a row, and the row's delete path
  // is responsible for unlinking the file again (see unlinkUpload below).
  const UPLOAD_TAG_RE = /^[a-z0-9-]+$/;
  admin.post<{ Params: { tag: string }; Body: { data?: string; mime?: string } }>(
    "/api/admin/uploads/:tag",
    async (req, reply) => {
      const tag = req.params.tag;
      if (!UPLOAD_TAG_RE.test(tag)) return reply.code(400).send({ error: "bad tag" });
      const data = req.body?.data;
      if (!data) return reply.code(400).send({ error: "data required" });
      const mime = (req.body?.mime ?? "").toLowerCase();
      const ext =
        mime.includes("png")  ? "png"  :
        mime.includes("webp") ? "webp" :
        mime.includes("gif")  ? "gif"  :
                                "jpg";
      const b64 = data.includes(",") ? data.split(",", 2)[1] : data;
      let buf: Buffer;
      try {
        buf = Buffer.from(b64, "base64");
      } catch {
        return reply.code(400).send({ error: "invalid base64" });
      }
      const filename = `${tag}-${Date.now()}.${ext}`;
      writeFileSync(resolve(uploadsDir, filename), buf);
      return { url: `/uploads/${filename}` };
    },
  );

  // Sections.
  admin.get("/api/admin/sections", async () =>
    db.prepare("SELECT * FROM sections ORDER BY position, id").all(),
  );
  admin.post<{ Body: { type?: string; name?: string } }>(
    "/api/admin/sections",
    async (req, reply) => {
      const { type, name } = req.body ?? {};
      if (!type || !SECTION_TYPES[type]) return reply.code(400).send({ error: "bad type" });
      if (!name?.trim()) return reply.code(400).send({ error: "name required" });
      const pos = (
        db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sections").get() as {
          p: number;
        }
      ).p;
      const info = db
        .prepare("INSERT INTO sections (type, name, position) VALUES (?, ?, ?)")
        .run(type, name.trim(), pos);
      return reply.code(201).send(getSection(info.lastInsertRowid as number));
    },
  );
  admin.put<{ Params: { id: string }; Body: { name?: string; position?: number } }>(
    "/api/admin/sections/:id",
    async (req, reply) => {
      if (!getSection(req.params.id)) return reply.code(404).send({ error: "not found" });
      const { name, position } = req.body ?? {};
      db.prepare(
        "UPDATE sections SET name = COALESCE(?, name), position = COALESCE(?, position) WHERE id = ?",
      ).run(name ?? null, position ?? null, req.params.id);
      return getSection(req.params.id);
    },
  );
  admin.delete<{ Params: { id: string } }>("/api/admin/sections/:id", async (req, reply) => {
    const section = getSection(req.params.id);
    if (section) {
      const cfg = SECTION_TYPES[section.type];
      if (cfg) {
        // Reap any uploaded files owned by this section's rows before deleting
        // them. Only the faq type has per-row uploads today; if more types
        // grow them, extend this lookup table.
        if (section.type === "faq") {
          const rows = db
            .prepare("SELECT cover_url FROM faqs WHERE section_id = ?")
            .all(section.id) as { cover_url: string }[];
          for (const r of rows) unlinkUpload(r.cover_url);
        }
        db.prepare(`DELETE FROM ${cfg.table} WHERE section_id = ?`).run(section.id);
      }
      db.prepare("DELETE FROM sections WHERE id = ?").run(section.id);
      if (section.type === "media") media.pruneOrphans();
    }
    return reply.code(204).send();
  });

  // Section content (the table is chosen by the section's type).
  const itemContext = (id: string) => {
    const section = getSection(id);
    const cfg = section && SECTION_TYPES[section.type];
    return section && cfg ? { section, cfg } : null;
  };

  admin.get<{ Params: { id: string } }>(
    "/api/admin/sections/:id/items",
    async (req, reply) => {
      const ctx = itemContext(req.params.id);
      if (!ctx) return reply.code(404).send({ error: "not found" });
      return db
        .prepare(
          `SELECT * FROM ${ctx.cfg.table} WHERE section_id = ? ORDER BY ${ctx.cfg.orderBy}`,
        )
        .all(ctx.section.id);
    },
  );
  admin.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/admin/sections/:id/items",
    async (req, reply) => {
      const ctx = itemContext(req.params.id);
      if (!ctx) return reply.code(404).send({ error: "not found" });
      const body = req.body ?? {};
      if (ctx.section.type === "media") {
        try { normalizeSource(body); } catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
      } else if (typeof body[ctx.section.type === "faq" ? "question" : "title"] !== "string" || !String(body[ctx.section.type === "faq" ? "question" : "title"]).trim()) {
        return reply.code(400).send({ error: ctx.section.type === "faq" ? "question required" : "title required" });
      }
      // Auto-assign next position for tables that order by it.
      if (ctx.cfg.columns.includes("position") && body.position === undefined) {
        const row = db
          .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${ctx.cfg.table} WHERE section_id = ?`)
          .get(ctx.section.id) as { p: number };
        body.position = row.p;
      }
      const cols = ctx.cfg.columns.filter((c) => body[c] !== undefined);
      const allCols = ["section_id", ...cols];
      const values = [ctx.section.id, ...cols.map((c) => body[c] as never)];
      const info = db
        .prepare(
          `INSERT INTO ${ctx.cfg.table} (${allCols.join(", ")}) VALUES (${allCols
            .map(() => "?")
            .join(", ")})`,
        )
        .run(...values);
      if (ctx.section.type === "media") queueSaved(String(body.youtube_url), "video");
      return reply
        .code(201)
        .send(db.prepare(`SELECT * FROM ${ctx.cfg.table} WHERE id = ?`).get(info.lastInsertRowid));
    },
  );
  admin.put<{ Params: { id: string; itemId: string }; Body: Record<string, unknown> }>(
    "/api/admin/sections/:id/items/:itemId",
    async (req, reply) => {
      const ctx = itemContext(req.params.id);
      if (!ctx) return reply.code(404).send({ error: "not found" });
      const existing = db.prepare(`SELECT * FROM ${ctx.cfg.table} WHERE id=? AND section_id=?`).get(req.params.itemId, ctx.section.id);
      if (!existing) return reply.code(404).send({ error: "not found" });
      const body = req.body ?? {};
      if (ctx.section.type === "media" && body.youtube_url !== undefined) {
        // Keep custom titles when only the link changes; an empty title requests metadata.
        const title = body.title;
        try { normalizeSource(body); } catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
        if (title === undefined) delete body.title;
      }
      const cols = ctx.cfg.columns.filter((c) => body[c] !== undefined);
      // Capture the previous cover so a replacement upload doesn't orphan it.
      let prevCover: string | undefined;
      if (ctx.section.type === "faq" && body.cover_url !== undefined) {
        const row = db
          .prepare("SELECT cover_url FROM faqs WHERE id = ? AND section_id = ?")
          .get(req.params.itemId, ctx.section.id) as { cover_url: string } | undefined;
        prevCover = row?.cover_url;
      }
      if (cols.length > 0) {
        const values = cols.map((c) => body[c] as never);
        db.prepare(
          `UPDATE ${ctx.cfg.table} SET ${cols
            .map((c) => `${c} = ?`)
            .join(", ")} WHERE id = ? AND section_id = ?`,
        ).run(...values, req.params.itemId, ctx.section.id);
      }
      if (prevCover && prevCover !== body.cover_url) unlinkUpload(prevCover);
      if (ctx.section.type === "media" && body.youtube_url !== undefined) { queueSaved(String(body.youtube_url), "video"); media.pruneOrphans(); }
      return db.prepare(`SELECT * FROM ${ctx.cfg.table} WHERE id = ? AND section_id=?`).get(req.params.itemId, ctx.section.id);
    },
  );
  admin.delete<{ Params: { id: string; itemId: string } }>(
    "/api/admin/sections/:id/items/:itemId",
    async (req, reply) => {
      const ctx = itemContext(req.params.id);
      if (!ctx) return reply.code(404).send({ error: "not found" });
      if (ctx.section.type === "faq") {
        const row = db
          .prepare("SELECT cover_url FROM faqs WHERE id = ? AND section_id = ?")
          .get(req.params.itemId, ctx.section.id) as { cover_url: string } | undefined;
        if (row) unlinkUpload(row.cover_url);
      }
      db.prepare(`DELETE FROM ${ctx.cfg.table} WHERE id = ? AND section_id = ?`).run(
        req.params.itemId,
        ctx.section.id,
      );
      if (ctx.section.type === "media") media.pruneOrphans();
      return reply.code(204).send();
    },
  );

  // ── Background audio tracks (global feature, not a section) ──────────────
  admin.get("/api/admin/background/tracks", async () =>
    db.prepare("SELECT * FROM background_tracks ORDER BY position, id").all(),
  );

  admin.post<{ Body: { title?: string; youtube_url?: string; position?: number } }>(
    "/api/admin/background/tracks",
    async (req, reply) => {
      const body = req.body ?? {};
      try { normalizeSource(body, true); } catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
      const title = body.title?.trim() ?? "";
      const url = body.youtube_url!;
      const pos =
        req.body?.position ??
        (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM background_tracks").get() as {
          p: number;
        }).p;
      const info = db
        .prepare(
          "INSERT INTO background_tracks (title, youtube_url, position) VALUES (?, ?, ?)",
        )
        .run(title, url, pos);
      queueSaved(url, "audio");
      const created = db
        .prepare("SELECT * FROM background_tracks WHERE id = ?")
        .get(info.lastInsertRowid);
      broadcastBg();
      return reply.code(201).send(created);
    },
  );

  admin.put<{
    Params: { id: string };
    Body: { title?: string; youtube_url?: string; position?: number };
  }>("/api/admin/background/tracks/:id", async (req, reply) => {
    const existing = db
      .prepare("SELECT id FROM background_tracks WHERE id = ?")
      .get(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not found" });
    const body = req.body ?? {};
    if (body.youtube_url !== undefined) {
      const title = body.title;
      try { normalizeSource(body, true); } catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
      if (title === undefined) delete body.title;
    }
    const { title, youtube_url, position } = body;
    db.prepare(
      `UPDATE background_tracks
          SET title       = COALESCE(?, title),
              youtube_url = COALESCE(?, youtube_url),
              position    = COALESCE(?, position)
        WHERE id = ?`,
    ).run(title ?? null, youtube_url ?? null, position ?? null, req.params.id);
    if (youtube_url) { queueSaved(youtube_url, "audio"); media.pruneOrphans(); }
    const updated = db.prepare("SELECT * FROM background_tracks WHERE id = ?").get(req.params.id);
    broadcastBg();
    return updated;
  });

  admin.delete<{ Params: { id: string } }>(
    "/api/admin/background/tracks/:id",
    async (req, reply) => {
      db.prepare("DELETE FROM background_tracks WHERE id = ?").run(req.params.id);
      media.pruneOrphans();
      // If the deleted track was selected, clear selection.
      if (bgState.trackId != null && String(bgState.trackId) === req.params.id) {
        bgState.trackId = null;
        bgState.playing = false;
        persistBg();
      }
      // Always broadcast — the tracks list changed, both surfaces need to refresh.
      broadcastBg();
      return reply.code(204).send();
    },
  );
});


  app.addHook("onReady", async () => {
    media.queueExisting();
    if (backgroundWork) {
      media.start();
      for (const { youtube_url } of db.prepare("SELECT youtube_url FROM media_items WHERE is_playlist=0 AND (title='' OR title=youtube_url)").all() as { youtube_url: string }[]) queueSaved(youtube_url, "video");
    }
  });
  app.addHook("preClose", async () => { deviceEvents.close(); remoteEvents.close(); backgroundEvents.close(); });
  app.addHook("onClose", async () => { clearInterval(tvPoll); streams.close(); channels.close(); await media.close(); db.close(); });
  return { app, db, media, streams, channels };
}
