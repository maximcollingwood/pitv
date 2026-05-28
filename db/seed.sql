-- Placeholder catalog data.
-- Idempotent: explicit ids + INSERT OR IGNORE so re-seeding is a no-op.
INSERT OR IGNORE INTO books (id, title, author, year, category, description) VALUES
  (1, 'The Bhagavad Gita',            'Vyasa',                -200, 'Scripture',   'A 700-verse dialogue on duty, devotion, and the nature of the self.'),
  (2, 'Meditations',                  'Marcus Aurelius',       180, 'Philosophy',  'Private notes of a Roman emperor on Stoic self-discipline.'),
  (3, 'The Dhammapada',               'Attributed to Buddha',  -100, 'Scripture',  'A collection of verses on the Buddhist path and the disciplined mind.'),
  (4, 'Tao Te Ching',                 'Laozi',                -400, 'Philosophy',  'Foundational text of Taoism on living in harmony with the Tao.'),
  (5, 'The Imitation of Christ',      'Thomas a Kempis',      1418, 'Devotional',  'A medieval manual of spiritual devotion and inner life.'),
  (6, 'The Prophet',                  'Kahlil Gibran',        1923, 'Poetry',      'Twenty-six prose poetry essays on love, work, and the human condition.');
