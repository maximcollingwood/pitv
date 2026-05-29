-- Default configuration for a fresh install. All of this is editable from the
-- phone CMS; it just gives a sensible starting point. Idempotent.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('title', 'Temple Library'),
  ('subtitle', 'Select with your remote to begin');

INSERT OR IGNORE INTO sections (id, type, name, position) VALUES
  (1, 'articles', 'Articles', 0),
  (2, 'media',    'Kirtans',  1),
  (3, 'media',    'Videos',   2),
  (4, 'catalog',  'Catalog',  3);

INSERT OR IGNORE INTO articles (id, section_id, title, body) VALUES
  (1, 1, 'How to Control Lust',
   'Lust is not conquered by suppression but by redirection. When the mind is given something higher to rest upon, the lower pull loses its grip.

Begin with small, consistent practice: rise at the same hour, sit quietly, and turn the attention inward before the day pulls it outward.'),
  (2, 1, 'On Patience',
   'Patience is not passive waiting. It is the active, steady trust that effort sincerely offered will bear fruit in its own season.

The farmer does not pull the seedling to make it grow. He waters, weeds, and waits.');

INSERT OR IGNORE INTO media_items (id, section_id, category, title, youtube_url, is_playlist) VALUES
  (1, 2, 'Morning', 'Mangala Charana',          'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 0),
  (2, 2, 'Evening', 'Hare Krishna Kirtan',       'https://www.youtube.com/watch?v=jNQXAC9IVRw', 0),
  (3, 3, 'Lectures',  'Introduction to the Gita', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 0),
  (4, 3, 'Festivals', 'Janmashtami Celebration',  'https://www.youtube.com/watch?v=jNQXAC9IVRw', 0);

INSERT OR IGNORE INTO books (id, section_id, title, author, year, category, description) VALUES
  (1, 4, 'The Bhagavad Gita', 'Vyasa',           -200, 'Scripture',  'A 700-verse dialogue on duty, devotion, and the nature of the self.'),
  (2, 4, 'Meditations',       'Marcus Aurelius',  180, 'Philosophy', 'Private notes of a Roman emperor on Stoic self-discipline.'),
  (3, 4, 'The Dhammapada',    'Buddha',          -100, 'Scripture',  'Verses on the Buddhist path and the disciplined mind.');
