// Local-dev DB initializer: applies db/schema.sql + db/seed.sql to a SQLite
// file so `npm run dev` has data to serve. (On the pi/VM, the Ansible
// `database` role does the equivalent with the sqlite3 CLI.)
import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../.."); // server/src -> server -> repo root
const dbPath = process.env.DB_PATH ?? resolve(__dirname, "../data/library.db");

mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.exec(readFileSync(resolve(repoRoot, "db/schema.sql"), "utf8"));
db.exec(readFileSync(resolve(repoRoot, "db/seed.sql"), "utf8"));
db.close();

console.log(`Initialized ${dbPath}`);
