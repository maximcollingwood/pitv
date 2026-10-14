-- Additive, idempotent schema. Existing content is never reset on deployment.

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
  position   INTEGER NOT NULL DEFAULT 0,
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

-- A book-catalog variant presented as FAQs: each row is a question whose
-- answer is a quote attributed to a book, with the page (or other location)
-- and a cover image. The TV renders this as a split layout — questions on
-- the left, the selected answer sliding in on the right.
CREATE TABLE IF NOT EXISTS faqs (
  id          INTEGER PRIMARY KEY,
  section_id  INTEGER NOT NULL,
  question    TEXT NOT NULL,
  book_title  TEXT NOT NULL DEFAULT '',
  quote       TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  cover_url   TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0
);

-- Background audio (looping YouTube track). One global selection; state lives
-- in `settings` (bg_track_id, bg_playing) so it persists across reboots.
CREATE TABLE IF NOT EXISTS background_tracks (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  youtube_url TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0
);

-- Durable media work queue. Files are only public when status is ready.
CREATE TABLE IF NOT EXISTS media_assets (
  key TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('audio','video')),
  status TEXT NOT NULL DEFAULT 'queued',
  title TEXT NOT NULL DEFAULT '',
  filename TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS media_assets_pending ON media_assets(status, next_attempt, created_at);
CREATE TABLE IF NOT EXISTS media_playlists (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  title TEXT NOT NULL DEFAULT '',
  videos TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
