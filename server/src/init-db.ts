import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { openDatabase, schemaDirectory } from "./database.js";
const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? resolve(here, "../data/library.db");
const db = openDatabase(dbPath, false);
if (process.argv.includes("--reset")) {
  // Explicit development-only escape hatch; never part of startup/deployment.
  db.exec(readFileSync(resolve(schemaDirectory(), "reset.sql"), "utf8"));
  db.exec("DROP TABLE IF EXISTS media_assets; DROP TABLE IF EXISTS media_playlists;");
}
db.close();
openDatabase(dbPath).close();
console.log(`Applied additive schema and starter content to ${dbPath}`);
