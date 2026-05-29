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

// ── Login ───────────────────────────────────────────────────────────────────
app.post<{ Body: { pin?: string } }>("/api/admin/login", async (req, reply) => {
  const pin = String(req.body?.pin ?? "");
  if (pin !== adminPin) {
    await new Promise((r) => setTimeout(r, 400)); // throttle brute force
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

  admin.get("/api/admin/articles", async () =>
    db.prepare("SELECT * FROM articles ORDER BY title").all(),
  );

  admin.post<{ Body: { title?: string; body?: string } }>(
    "/api/admin/articles",
    async (req, reply) => {
      const title = req.body?.title?.trim();
      if (!title) return reply.code(400).send({ error: "title required" });
      const info = db
        .prepare("INSERT INTO articles (title, body) VALUES (?, ?)")
        .run(title, req.body?.body ?? "");
      return reply
        .code(201)
        .send(db.prepare("SELECT * FROM articles WHERE id = ?").get(info.lastInsertRowid));
    },
  );

  admin.put<{ Params: { id: string }; Body: { title?: string; body?: string } }>(
    "/api/admin/articles/:id",
    async (req, reply) => {
      const existing = db.prepare("SELECT id FROM articles WHERE id = ?").get(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not found" });
      db.prepare(
        `UPDATE articles
            SET title = COALESCE(?, title),
                body = COALESCE(?, body),
                updated_at = datetime('now')
          WHERE id = ?`,
      ).run(req.body?.title ?? null, req.body?.body ?? null, req.params.id);
      return db.prepare("SELECT * FROM articles WHERE id = ?").get(req.params.id);
    },
  );

  admin.delete<{ Params: { id: string } }>(
    "/api/admin/articles/:id",
    async (req, reply) => {
      db.prepare("DELETE FROM articles WHERE id = ?").run(req.params.id);
      return reply.code(204).send();
    },
  );
});

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
