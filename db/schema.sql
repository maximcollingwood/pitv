-- Per-installation configurable model. Idempotent (IF NOT EXISTS); a one-time
-- reset (reset.sql) runs when the schema version is bumped.

-- Global key/value config (title, subtitle, ...).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- The sections this installation shows, each an instance of a preset type.
CREATE TABLE IF NOT EXISTS sections (
  id       INTEGER PRIMARY KEY,
  type     TEXT NOT NULL,            -- 'articles' | 'media' | 'catalog'
  name     TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

-- Content, each row owned by a section.
CREATE TABLE IF NOT EXISTS articles (
  id         INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_items (
  id          INTEGER PRIMARY KEY,
  section_id  INTEGER NOT NULL,
  category    TEXT NOT NULL DEFAULT 'General',
  title       TEXT NOT NULL,
  youtube_url TEXT NOT NULL DEFAULT '',
  is_playlist INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS books (
  id          INTEGER PRIMARY KEY,
  section_id  INTEGER NOT NULL,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  year        INTEGER,
  category    TEXT,
  description TEXT
);
