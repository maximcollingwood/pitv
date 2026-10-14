import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function schemaDirectory() { return process.env.DB_SCHEMA_DIR ?? resolve(repoRoot, "db"); }
export function openDatabase(path: string, seed = true) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  // WAL commits without fsync; only checkpoints sync. Queries run on the event loop,
  // and an fsync can stall for seconds while media downloads flush to the SD card.
  // A power cut can lose the last commits but never corrupts the database.
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.transaction(() => {
    db.exec(readFileSync(resolve(schemaDirectory(), "schema.sql"), "utf8"));
    // Early installations predate manual ordering. CREATE TABLE IF NOT EXISTS
    // cannot add columns to those tables, so migrate in place before seeding.
    for (const table of ["sections", "articles", "faqs", "background_tracks"]) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some(column => column.name === "position")) db.exec(`ALTER TABLE ${table} ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
    }
    for (const table of ["media_assets", "media_playlists"]) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some(column => column.name === "priority")) db.exec(`ALTER TABLE ${table} ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`);
    }
    if (seed) db.exec(readFileSync(resolve(schemaDirectory(), "seed.sql"), "utf8"));
  })();
  return db;
}
