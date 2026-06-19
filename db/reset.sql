-- Wipe all app tables. Run once when the schema version changes (the database
-- role / init-db gate this on PRAGMA user_version). Covers old + new names.
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS sections;
DROP TABLE IF EXISTS articles;
DROP TABLE IF EXISTS media_items;
DROP TABLE IF EXISTS kirtans;
DROP TABLE IF EXISTS videos;
DROP TABLE IF EXISTS books;
DROP TABLE IF EXISTS faqs;
