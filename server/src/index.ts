import Fastify from "fastify";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
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

// Which table/columns back each preset section type.
const SECTION_TYPES: Record<string, { table: string; columns: string[]; orderBy: string }> = {
  articles: { table: "articles", columns: ["title", "body"], orderBy: "title" },
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
    if (!res.ok) return null;
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
    let videos = youtubeApiKey ? await playlistViaApi(list) : null;
    if (!videos) videos = await playlistViaRss(list);
    if (!videos) return reply.code(502).send({ error: "playlist fetch failed" });
    return { videos };
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
});

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
