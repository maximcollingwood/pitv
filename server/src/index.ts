import Fastify from "fastify";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import os from "node:os";
import type { ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DB_PATH ?? resolve(__dirname, "../data/library.db");
const port = Number(process.env.PORT ?? 3000);
const adminPin = process.env.ADMIN_PIN ?? "0000";
const youtubeApiKey = process.env.YOUTUBE_API_KEY ?? "";

const db = new Database(dbPath, { fileMustExist: true });
db.pragma("journal_mode = WAL");

const app = Fastify({ logger: true });

app.log.info(
  { youtubeApiKeyConfigured: youtubeApiKey.length > 0 },
  "[startup] YOUTUBE_API_KEY configured?",
);

// Which table/columns back each preset section type.
const SECTION_TYPES: Record<string, { table: string; columns: string[]; orderBy: string }> = {
  articles: { table: "articles", columns: ["title", "body", "position"], orderBy: "position, title" },
  // Lyrics share the article shape (title + body of blank-line-separated verses);
  // only the TV display differs, so they reuse the articles table.
  lyrics: { table: "articles", columns: ["title", "body", "position"], orderBy: "position, title" },
  media: {
    table: "media_items",
    columns: ["category", "title", "youtube_url", "is_playlist"],
    orderBy: "category, title",
  },
  catalog: {
    table: "books",
    columns: ["title", "author", "year", "category", "description"],
    orderBy: "title",
  },
};

interface Section {
  id: number;
  type: string;
  name: string;
  position: number;
}

const getSection = (id: string | number) =>
  db.prepare("SELECT * FROM sections WHERE id = ?").get(id) as Section | undefined;

const getSettings = (): Record<string, string> => {
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

// ── Auth: a shared PIN exchanges for an in-memory bearer token ──────────────
const tokens = new Map<string, number>();
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function issueToken(): string {
  const token = randomUUID();
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function tokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const expiry = tokens.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    tokens.delete(token);
    return false;
  }
  return true;
}

// ── Public endpoints (the TV) ───────────────────────────────────────────────
app.get("/api/health", async () => ({ status: "ok" }));

app.get("/api/info", async () => ({
  hostname: os.hostname(),
  remoteUrl: `http://${os.hostname()}.local/remote`,
  adminUrl: `http://${os.hostname()}.local/admin`,
}));

app.get("/api/config", async () => {
  const settings = getSettings();
  const sections = db
    .prepare("SELECT id, type, name, position FROM sections ORDER BY position, id")
    .all();
  return {
    title: settings.title ?? "",
    subtitle: settings.subtitle ?? "",
    sections,
  };
});

// ── Background audio (one global track, looped) ─────────────────────────────
interface BgState {
  trackId: number | null;
  playing: boolean;
}

const settingsUpsert = db.prepare(
  "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
);
function readBg(key: string): string | undefined {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined)?.value;
}

const bgState: BgState = {
  trackId: ((): number | null => {
    const v = readBg("bg_track_id");
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  })(),
  playing: readBg("bg_playing") === "1",
};

function persistBg() {
  settingsUpsert.run("bg_track_id", bgState.trackId == null ? "" : String(bgState.trackId));
  settingsUpsert.run("bg_playing", bgState.playing ? "1" : "0");
}

function listBgTracks() {
  return db
    .prepare("SELECT id, title, youtube_url, position FROM background_tracks ORDER BY position, id")
    .all();
}

function bgPayload(): string {
  return `data: ${JSON.stringify({ tracks: listBgTracks(), state: bgState })}\n\n`;
}

const bgClients = new Set<ServerResponse>();
function broadcastBg() {
  const payload = bgPayload();
  for (const r of bgClients) r.write(payload);
}

app.get("/api/background/tracks", async () =>
  db
    .prepare("SELECT id, title, youtube_url, position FROM background_tracks ORDER BY position, id")
    .all(),
);

app.get("/api/background/state", async () => bgState);

app.post<{ Body: { trackId?: number | null; playing?: boolean } }>(
  "/api/background/state",
  async (req) => {
    const body = req.body ?? {};
    if (body.trackId !== undefined) {
      bgState.trackId = body.trackId === null ? null : Number(body.trackId);
    }
    if (body.playing !== undefined) bgState.playing = Boolean(body.playing);
    persistBg();
    broadcastBg();
    return bgState;
  },
);

app.get("/api/background/events", (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(bgPayload()); // initial snapshot (tracks + state)
  bgClients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.raw.on("close", () => {
    clearInterval(ping);
    bgClients.delete(res);
  });
});

app.get<{ Params: { id: string } }>("/api/sections/:id/items", async (req, reply) => {
  const section = getSection(req.params.id);
  const cfg = section && SECTION_TYPES[section.type];
  if (!section || !cfg) return reply.code(404).send({ error: "not found" });
  return db
    .prepare(`SELECT * FROM ${cfg.table} WHERE section_id = ? ORDER BY ${cfg.orderBy}`)
    .all(section.id);
});

// ── Playlist contents (Data API w/ key, else keyless RSS fallback) ──────────
interface PlaylistVideo {
  id: string;
  title: string;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

async function playlistViaRss(list: string): Promise<PlaylistVideo[] | null> {
  const res = await fetch(
    `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(list)}`,
  );
  if (!res.ok) return null;
  const xml = await res.text();
  return xml
    .split("<entry>")
    .slice(1)
    .map((entry) => ({
      id: /<yt:videoId>(.*?)<\/yt:videoId>/.exec(entry)?.[1] ?? "",
      title: decodeXml(/<title>(.*?)<\/title>/.exec(entry)?.[1] ?? ""),
    }))
    .filter((v) => v.id);
}

async function playlistViaApi(list: string): Promise<PlaylistVideo[] | null> {
  const videos: PlaylistVideo[] = [];
  let pageToken = "";
  for (let page = 0; page < 40; page++) {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("playlistId", list);
    url.searchParams.set("key", youtubeApiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url);
    if (!res.ok) {
      // Make failures visible (quota, bad key, API disabled, etc.) instead of
      // silently falling back to the 15-video RSS feed.
      const body = await res.text().catch(() => "");
      app.log.error(
        { status: res.status, body: body.slice(0, 300) },
        "[playlist] YouTube Data API request failed",
      );
      return null;
    }
    const data = (await res.json()) as {
      items?: { snippet?: { title?: string; resourceId?: { videoId?: string } } }[];
      nextPageToken?: string;
    };
    for (const it of data.items ?? []) {
      const id = it.snippet?.resourceId?.videoId;
      const title = it.snippet?.title ?? "";
      if (!id || title === "Private video" || title === "Deleted video") continue;
      videos.push({ id, title });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return videos;
}

app.get<{ Querystring: { list?: string } }>("/api/playlist", async (req, reply) => {
  const list = req.query.list;
  if (!list) return reply.code(400).send({ error: "list required" });
  try {
    let videos: PlaylistVideo[] | null = null;
    let source: "api" | "rss" = "rss";
    if (youtubeApiKey) {
      videos = await playlistViaApi(list);
      if (videos) source = "api";
    } else {
      app.log.warn(
        "[playlist] no YOUTUBE_API_KEY set; falling back to RSS (15 most recent)",
      );
    }
    if (!videos) videos = await playlistViaRss(list);
    if (!videos) return reply.code(502).send({ error: "playlist fetch failed" });
    return { videos, source };
  } catch {
    return reply.code(502).send({ error: "playlist fetch failed" });
  }
});

// ── Remote control relay (open): phones POST presses, the TV listens via SSE ──
const remoteClients = new Set<ServerResponse>();
const REMOTE_ACTIONS = new Set(["up", "down", "left", "right", "select", "back"]);

app.get("/api/remote/events", (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  remoteClients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.raw.on("close", () => {
    clearInterval(ping);
    remoteClients.delete(res);
  });
});

// ── System volume (open, no auth — same trust level as the remote control) ──
function callVolume(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "sudo",
      ["-n", "/usr/local/bin/kiosk-volume", ...args],
      { timeout: 3000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.toString().trim() || err.message));
        else resolve(stdout.toString().trim());
      },
    );
  });
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

app.get("/api/system/volume", async (_req, reply) => {
  try {
    const out = await callVolume(["get"]);
    const level = Number(out);
    if (!Number.isFinite(level)) throw new Error(`unparseable: ${out}`);
    return { level: clamp01(level) };
  } catch (e) {
    return reply.code(500).send({ error: String(e) });
  }
});

app.post<{ Body: { level?: number } }>("/api/system/volume", async (req, reply) => {
  const raw = Number(req.body?.level);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
    return reply.code(400).send({ error: "level must be a number between 0 and 1" });
  }
  // Round to 2 decimals so the wrapper's pattern accepts it (0, 1, 0.X, 0.XX).
  const level = Math.round(clamp01(raw) * 100) / 100;
  try {
    await callVolume([level.toString()]);
    return { level };
  } catch (e) {
    return reply.code(500).send({ error: String(e) });
  }
});

app.post<{ Body: { action?: string } }>("/api/remote/press", async (req, reply) => {
  const action = req.body?.action;
  if (!action || !REMOTE_ACTIONS.has(action)) {
    return reply.code(400).send({ error: "bad action" });
  }
  const payload = `data: ${JSON.stringify({ action })}\n\n`;
  for (const res of remoteClients) res.write(payload);
  return { ok: true, clients: remoteClients.size };
});

// ── Login ───────────────────────────────────────────────────────────────────
app.post<{ Body: { pin?: string } }>("/api/admin/login", async (req, reply) => {
  const pin = String(req.body?.pin ?? "");
  if (pin !== adminPin) {
    await new Promise((r) => setTimeout(r, 400));
    return reply.code(401).send({ error: "invalid pin" });
  }
  return { token: issueToken() };
});

// ── Admin endpoints (the phone CMS), token-gated ────────────────────────────
app.register(async (admin) => {
  admin.addHook("preHandler", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!tokenValid(token)) return reply.code(401).send({ error: "unauthorized" });
  });

  // Settings (title, subtitle, ...).
  admin.get("/api/admin/settings", async () => getSettings());
  admin.put<{ Body: Record<string, string> }>("/api/admin/settings", async (req) => {
    const stmt = db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    for (const [k, v] of Object.entries(req.body ?? {})) stmt.run(k, String(v));
    return getSettings();
  });

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
      if (cfg) db.prepare(`DELETE FROM ${cfg.table} WHERE section_id = ?`).run(section.id);
      db.prepare("DELETE FROM sections WHERE id = ?").run(section.id);
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
      const body = req.body ?? {};
      const cols = ctx.cfg.columns.filter((c) => body[c] !== undefined);
      if (cols.length > 0) {
        const values = cols.map((c) => body[c] as never);
        db.prepare(
          `UPDATE ${ctx.cfg.table} SET ${cols
            .map((c) => `${c} = ?`)
            .join(", ")} WHERE id = ? AND section_id = ?`,
        ).run(...values, req.params.itemId, ctx.section.id);
      }
      return db.prepare(`SELECT * FROM ${ctx.cfg.table} WHERE id = ?`).get(req.params.itemId);
    },
  );
  admin.delete<{ Params: { id: string; itemId: string } }>(
    "/api/admin/sections/:id/items/:itemId",
    async (req, reply) => {
      const ctx = itemContext(req.params.id);
      if (!ctx) return reply.code(404).send({ error: "not found" });
      db.prepare(`DELETE FROM ${ctx.cfg.table} WHERE id = ? AND section_id = ?`).run(
        req.params.itemId,
        ctx.section.id,
      );
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
      const title = req.body?.title?.trim();
      if (!title) return reply.code(400).send({ error: "title required" });
      const url = req.body?.youtube_url ?? "";
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
    const { title, youtube_url, position } = req.body ?? {};
    db.prepare(
      `UPDATE background_tracks
          SET title       = COALESCE(?, title),
              youtube_url = COALESCE(?, youtube_url),
              position    = COALESCE(?, position)
        WHERE id = ?`,
    ).run(title ?? null, youtube_url ?? null, position ?? null, req.params.id);
    const updated = db.prepare("SELECT * FROM background_tracks WHERE id = ?").get(req.params.id);
    broadcastBg();
    return updated;
  });

  admin.delete<{ Params: { id: string } }>(
    "/api/admin/background/tracks/:id",
    async (req, reply) => {
      db.prepare("DELETE FROM background_tracks WHERE id = ?").run(req.params.id);
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

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
