-- Canonical schema for the library catalog.
-- Idempotent: safe to re-apply on every deploy (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS books (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL,
  year        INTEGER,
  category    TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS articles (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
