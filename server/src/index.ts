import Fastify, { type FastifyInstance } from "fastify";
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

// ── Auth: a shared PIN exchanges for an in-memory bearer token ──────────────
const tokens = new Map<string, number>(); // token -> expiry (ms epoch)
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

app.get("/api/books", async () =>
  db.prepare("SELECT * FROM books ORDER BY title").all(),
);

app.get("/api/articles", async () =>
  db.prepare("SELECT id, title, updated_at FROM articles ORDER BY title").all(),
);

app.get<{ Params: { id: string } }>("/api/articles/:id", async (req, reply) => {
  const article = db
    .prepare("SELECT * FROM articles WHERE id = ?")
    .get(req.params.id);
  if (!article) return reply.code(404).send({ error: "not found" });
  return article;
});

app.get("/api/kirtans", async () =>
  db.prepare("SELECT * FROM kirtans ORDER BY category, title").all(),
);

app.get("/api/videos", async () =>
  db.prepare("SELECT * FROM videos ORDER BY category, title").all(),
);

// Individual videos in a YouTube playlist.
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

// Keyless fallback via the RSS feed — returns only the most recent ~15 videos.
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

// Full playlist via the YouTube Data API, paginated. Requires YOUTUBE_API_KEY.
// Returns null on any API error so the caller can fall back to RSS.
async function playlistViaApi(list: string): Promise<PlaylistVideo[] | null> {
  const videos: PlaylistVideo[] = [];
  let pageToken = "";
  for (let page = 0; page < 40; page++) {
    // safety cap: 40 × 50 = 2000
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
    // Prefer the full Data API; fall back to RSS if no key is set or it errors.
    let videos = youtubeApiKey ? await playlistViaApi(list) : null;
    if (!videos) videos = await playlistViaRss(list);
    if (!videos) return reply.code(502).send({ error: "playlist fetch failed" });
    return { videos };
  } catch {
    return reply.code(502).send({ error: "playlist fetch failed" });
  }
});

// ── Login ───────────────────────────────────────────────────────────────────
app.post<{ Body: { pin?: string } }>("/api/admin/login", async (req, reply) => {
  const pin = String(req.body?.pin ?? "");
  if (pin !== adminPin) {
    await new Promise((r) => setTimeout(r, 400)); // throttle brute force
    return reply.code(401).send({ error: "invalid pin" });
  }
  return { token: issueToken() };
});

// ── Generic CRUD for a table. `table`/`columns` come from our own config
//    (never user input), values are always bound, so dynamic SQL is safe. ──────
interface CrudConfig {
  path: string;
  table: string;
  columns: string[];
  orderBy?: string;
}

function registerCrud(scope: FastifyInstance, cfg: CrudConfig) {
  const { path, table, columns, orderBy = "id" } = cfg;
  const pickCols = (body: Record<string, unknown>) =>
    columns.filter((c) => body[c] !== undefined);

  scope.get(path, async () =>
    db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all(),
  );

  scope.post<{ Body: Record<string, unknown> }>(path, async (req, reply) => {
    const body = req.body ?? {};
    const cols = pickCols(body);
    if (cols.length === 0) return reply.code(400).send({ error: "no fields" });
    const values = cols.map((c) => body[c] as never);
    const info = db
      .prepare(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      )
      .run(...values);
    return reply
      .code(201)
      .send(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid));
  });

  scope.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    `${path}/:id`,
    async (req, reply) => {
      const existing = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not found" });
      const body = req.body ?? {};
      const cols = pickCols(body);
      if (cols.length > 0) {
        const values = cols.map((c) => body[c] as never);
        db.prepare(
          `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
        ).run(...values, req.params.id);
      }
      return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    },
  );

  scope.delete<{ Params: { id: string } }>(`${path}/:id`, async (req, reply) => {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    return reply.code(204).send();
  });
}

// ── Admin endpoints (the phone CMS), token-gated ────────────────────────────
app.register(async (admin) => {
  admin.addHook("preHandler", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!tokenValid(token)) return reply.code(401).send({ error: "unauthorized" });
  });

  registerCrud(admin, {
    path: "/api/admin/articles",
    table: "articles",
    columns: ["title", "body"],
    orderBy: "title",
  });
  registerCrud(admin, {
    path: "/api/admin/kirtans",
    table: "kirtans",
    columns: ["category", "title", "youtube_url"],
    orderBy: "category, title",
  });
  registerCrud(admin, {
    path: "/api/admin/videos",
    table: "videos",
    columns: ["category", "title", "youtube_url", "is_playlist"],
    orderBy: "category, title",
  });
  registerCrud(admin, {
    path: "/api/admin/books",
    table: "books",
    columns: ["title", "author", "year", "category", "description"],
    orderBy: "title",
  });
});

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
