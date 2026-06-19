-- One-shot starter content. The playbook applies seed.sql on every deploy,
-- so anything below MUST be guarded so it can only ever run once on a given
-- device. The guard pattern: gate every insert on the absence of a marker
-- row in `settings`, then set that marker at the end. After the user edits
-- or deletes any of the seeded rows they stay edited/deleted — the seed
-- block won't fire again.
--
-- To force a re-seed on a single device:
--   sqlite3 /var/lib/pitv/library.db "DELETE FROM settings WHERE key='faq_seeded';"
-- ────────────────────────────────────────────────────────────────────────────

-- Stash the new FAQ section's id so the item inserts below can reference it.
-- TEMP tables are scoped to the sqlite3 connection that runs this script.
CREATE TEMP TABLE IF NOT EXISTS _seed_faq_section (id INTEGER);

INSERT INTO sections (type, name, position)
SELECT 'faq',
       'Frequently Asked',
       COALESCE((SELECT MAX(position) + 1 FROM sections), 0)
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'faq_seeded');

INSERT INTO _seed_faq_section (id)
SELECT last_insert_rowid()
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'faq_seeded')
  AND last_insert_rowid() > 0;

INSERT INTO faqs (section_id, question, book_title, quote, location, position)
SELECT (SELECT id FROM _seed_faq_section), q, bt, qt, loc, p FROM (
  SELECT
    'Why would God appear in this world?' AS q,
    'Bhagavad-gita As It Is' AS bt,
    'Whenever and wherever there is a decline in religious practice, O descendant of Bharata, and a predominant rise of irreligion—at that time I descend Myself. To deliver the pious and to annihilate the miscreants, as well as to reestablish the principles of religion, I Myself appear, millennium after millennium.' AS qt,
    'Chapter 4, Verses 7–8' AS loc,
    0 AS p
  UNION ALL SELECT
    'Am I just my body?',
    'Bhagavad-gita As It Is',
    'As the embodied soul continuously passes, in this body, from boyhood to youth to old age, the soul similarly passes into another body at death. A sober person is not bewildered by such a change.',
    'Chapter 2, Verse 13',
    1
  UNION ALL SELECT
    'What happens to me when I die?',
    'Bhagavad-gita As It Is',
    'For the soul there is neither birth nor death at any time. He has not come into being, does not come into being, and will not come into being. He is unborn, eternal, ever-existing and primeval. He is not slain when the body is slain.',
    'Chapter 2, Verse 20',
    2
  UNION ALL SELECT
    'Is there a simple path to peace of mind?',
    'Bhagavad-gita As It Is',
    'Abandon all varieties of religion and just surrender unto Me. I shall deliver you from all sinful reactions. Do not fear.',
    'Chapter 18, Verse 66',
    3
  UNION ALL SELECT
    'What is the most fulfilling thing a person can do?',
    'Srimad-Bhagavatam',
    'The supreme occupation [dharma] for all humanity is that by which men can attain to loving devotional service unto the transcendent Lord. Such devotional service must be unmotivated and uninterrupted to completely satisfy the self.',
    'Canto 1, Chapter 2, Verse 6',
    4
  UNION ALL SELECT
    'Where did everything come from?',
    'Srimad-Bhagavatam',
    'I meditate upon Lord Sri Krsna because He is the Absolute Truth and the primeval cause of all causes of the creation, sustenance and destruction of the manifested universes.',
    'Canto 1, Chapter 1, Verse 1',
    5
  UNION ALL SELECT
    'Is there a spiritual practice that fits modern life?',
    'Sri Caitanya-caritamrta',
    'For spiritual progress in this Age of Kali, there is no alternative, there is no alternative, there is no alternative to the holy name, the holy name, the holy name of the Lord.',
    'Adi-lila, Chapter 17, Verse 21',
    6
  UNION ALL SELECT
    'What is the highest form of love?',
    'Sri Caitanya-caritamrta',
    'Resplendent with the radiance of molten gold, He has appeared in the Age of Kali by His causeless mercy to bestow what no incarnation has ever offered before: the most sublime and radiant mellow of devotional service, the mellow of conjugal love.',
    'Adi-lila, Chapter 1, Verse 4',
    7
  UNION ALL SELECT
    'What habits hold us back spiritually?',
    'The Nectar of Instruction',
    'One''s devotional service is spoiled when he becomes too entangled in the following six activities: (1) eating more than necessary or collecting more funds than required; (2) overendeavoring for mundane things that are very difficult to obtain; (3) talking unnecessarily about mundane subject matters; (4) practicing the scriptural rules and regulations only for the sake of following them and not for the sake of spiritual advancement, or rejecting the rules and regulations of the scriptures and working independently or whimsically; (5) associating with worldly-minded persons who are not interested in Krsna consciousness; and (6) being greedy for mundane achievements.',
    'Verse 2',
    8
  UNION ALL SELECT
    'What qualities help us grow spiritually?',
    'The Nectar of Instruction',
    'There are six principles favorable to the execution of pure devotional service: (1) being enthusiastic, (2) endeavoring with confidence, (3) being patient, (4) acting according to regulative principles, (5) abandoning the association of nondevotees, and (6) following in the footsteps of the previous acaryas. These six principles undoubtedly assure the complete success of pure devotional service.',
    'Verse 3',
    9
  UNION ALL SELECT
    'Who is Krishna?',
    'Krsna, the Supreme Personality of Godhead',
    'Krsna means the all-attractive Supreme Personality of Godhead. No one can be all-attractive without possessing all opulences in full. Krsna is the only person who possesses in full all six opulences — wealth, strength, fame, beauty, knowledge and renunciation — and He is therefore the Supreme Personality of Godhead.',
    'Introduction',
    10
  UNION ALL SELECT
    'Will God protect those who trust in Him?',
    'Krsna, the Supreme Personality of Godhead',
    'By holding up Govardhana Hill on the little finger of His left hand for seven days, Krsna established that worship offered directly to Him in loving devotion is more potent than the worship of any demigod. The Lord always protects His devotees in every circumstance.',
    'Chapter: The Lifting of Govardhana Hill',
    11
  UNION ALL SELECT
    'What does it mean to truly love God?',
    'The Nectar of Devotion',
    'When first-class devotional service develops, one must be devoid of all material desires, knowledge obtained by monistic philosophy, and fruitive action. The devotee must constantly serve Krsna favorably, as Krsna desires.',
    'Chapter 1',
    12
  UNION ALL SELECT
    'What are some simple ways to connect with God?',
    'The Nectar of Devotion',
    'The nine processes of devotional service are: hearing about the Lord, chanting His glories, remembering Him, serving His lotus feet, offering worship, offering prayers, becoming His servant, becoming His friend, and surrendering everything unto Him.',
    'Chapter 6',
    13
  UNION ALL SELECT
    'Do we really own anything in this world?',
    'Sri Isopanisad',
    'Everything animate or inanimate that is within the universe is controlled and owned by the Lord. One should therefore accept only those things necessary for himself, which are set aside as his quota, and one should not accept other things, knowing well to whom they belong.',
    'Mantra 1',
    14
  UNION ALL SELECT
    'Can the source of everything ever be diminished?',
    'Sri Isopanisad',
    'The Personality of Godhead is perfect and complete, and because He is completely perfect, all emanations from Him, such as this phenomenal world, are perfectly equipped as complete wholes. Whatever is produced of the complete whole is also complete in itself. Because He is the complete whole, even though so many complete units emanate from Him, He remains the complete balance.',
    'Invocation',
    15
  UNION ALL SELECT
    'What am I, deep down?',
    'The Science of Self-Realization',
    'I am not this body. The body is a temporary vehicle of the eternal soul. The first lesson of spiritual life is to understand that I am spirit soul, part and parcel of the Supreme Spirit, and not this lump of matter.',
    'Chapter: What Is the Difficulty?',
    16
  UNION ALL SELECT
    'What is the point of being human?',
    'The Science of Self-Realization',
    'The human form of life is meant for inquiring about the Absolute Truth and for reviving our lost relationship with the Supreme Personality of Godhead. If we miss this opportunity, we have lost a great chance.',
    'Chapter: The Path of Perfection',
    17
  UNION ALL SELECT
    'Does what we think about most shape our future?',
    'Beyond Birth and Death',
    'Whatever state of being one remembers when he quits his body, that state he will attain without fail. One who at the time of death remembers Krsna and quits the body thinking of Him reaches the spiritual sky — of this there is no doubt.',
    'Chapter 1 (citing Bhagavad-gita 8.5–6)',
    18
  UNION ALL SELECT
    'Is there more to yoga than exercise?',
    'The Perfection of Yoga',
    'Of all yogis, the one with great faith who always abides in Me, thinks of Me within himself, and renders transcendental loving service to Me is the most intimately united with Me in yoga and is the highest of all. That is My opinion.',
    'Chapter on Krsna Consciousness (citing Bhagavad-gita 6.47)',
    19
)
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'faq_seeded')
  AND EXISTS (SELECT 1 FROM _seed_faq_section);

-- Final step: plant the marker so the whole block above becomes a no-op on
-- every subsequent deploy. Place this LAST so a partial seed (e.g. sqlite3
-- aborts mid-script) doesn't lock out a retry.
INSERT INTO settings (key, value)
SELECT 'faq_seeded', '1'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'faq_seeded');
