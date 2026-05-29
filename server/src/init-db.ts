// Local-dev DB initializer: applies reset + schema + seed to a SQLite file so
// `npm run dev` has data to serve. The local DB is disposable, so we reset every
// time to stay in sync with the schema. (On the pi/VM, the Ansible `database`
// role does the equivalent, gating the reset on PRAGMA user_version.)
import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../.."); // server/src -> server -> repo root
const dbPath = process.env.DB_PATH ?? resolve(__dirname, "../data/library.db");

mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
for (const file of ["db/reset.sql", "db/schema.sql", "db/seed.sql"]) {
  db.exec(readFileSync(resolve(repoRoot, file), "utf8"));
}
db.close();

console.log(`Initialized ${dbPath}`);
