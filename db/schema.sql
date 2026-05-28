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
