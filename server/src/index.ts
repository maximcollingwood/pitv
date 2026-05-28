import Fastify from "fastify";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// DB_PATH is set in production (systemd) and in the VM; defaults to the local
// dev database created by `npm run init-db`.
const dbPath = process.env.DB_PATH ?? resolve(__dirname, "../data/library.db");
const port = Number(process.env.PORT ?? 3000);

interface Book {
  id: number;
  title: string;
  author: string;
  year: number | null;
  category: string | null;
  description: string | null;
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const app = Fastify({ logger: true });

app.get("/api/health", async () => ({ status: "ok" }));

app.get("/api/books", async () => {
  return db.prepare("SELECT * FROM books ORDER BY title").all() as Book[];
});

app.get<{ Params: { id: string } }>("/api/books/:id", async (req, reply) => {
  const book = db.prepare("SELECT * FROM books WHERE id = ?").get(req.params.id);
  if (!book) return reply.code(404).send({ error: "not found" });
  return book;
});

app
  .listen({ port, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
