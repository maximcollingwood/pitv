-- Default configuration for a fresh install. Settings + empty sections only —
-- no placeholder content. All of this is editable from the phone CMS.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('title', 'Temple Library'),
  ('subtitle', 'Select with your remote to begin');

INSERT OR IGNORE INTO sections (id, type, name, position) VALUES
  (1, 'articles', 'Articles', 0),
  (2, 'media',    'Kirtans',  1),
  (3, 'media',    'Videos',   2),
  (4, 'catalog',  'Catalog',  3),
  (5, 'lyrics',   'Songs',    4);
