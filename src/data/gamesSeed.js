/**
 * Seed data for the `games` Firestore collection.
 *
 * Shape matches the agreed document schema exactly:
 *   {
 *     title, subject, grade, type, difficulty, description, timer,
 *     points, active, cbc_topic, questions[]
 *   }
 *
 * Import these into Firestore using the admin button at /admin/games-seed
 * (wired to `upsertGame` in gamesService.js).
 *
 * Document IDs use the convention `<subject>_<slug>_g<grade>` so they are
 * stable across environments and easy to reason about in URLs / logs.
 */

/* ────────────────────────────────────────────────────────────────────
 *  GRADE 4 — MATHEMATICS — Speed Tables Challenge
 *  This is the "first complete working module" we are testing end-to-end.
 * ──────────────────────────────────────────────────────────────────── */
const SPEED_TABLES_G4 = {
  id: 'math_speed_tables_g4',
  title: 'Speed Tables Challenge',
  subject: 'mathematics',
  grade: 4,
  type: 'timed_quiz',
  difficulty: 'easy',
  description: 'Answer multiplication questions before time runs out.',
  timer: 60,
  points: 10,
  active: true,
  cbc_topic: 'Multiplication',
  questions: [
    { question: '6 × 7 = ?',  options: ['42', '36', '48', '56'], answer: '42' },
    { question: '8 × 5 = ?',  options: ['30', '35', '40', '45'], answer: '40' },
    { question: '9 × 6 = ?',  options: ['52', '54', '56', '63'], answer: '54' },
    { question: '7 × 7 = ?',  options: ['42', '47', '49', '56'], answer: '49' },
    { question: '4 × 9 = ?',  options: ['32', '36', '40', '45'], answer: '36' },
    { question: '5 × 8 = ?',  options: ['35', '40', '45', '48'], answer: '40' },
    { question: '3 × 12 = ?', options: ['24', '30', '33', '36'], answer: '36' },
    { question: '6 × 8 = ?',  options: ['42', '46', '48', '54'], answer: '48' },
    { question: '7 × 9 = ?',  options: ['56', '63', '72', '81'], answer: '63' },
    { question: '2 × 11 = ?', options: ['20', '21', '22', '24'], answer: '22' },
    { question: '8 × 8 = ?',  options: ['56', '60', '64', '72'], answer: '64' },
    { question: '9 × 9 = ?',  options: ['72', '81', '90', '99'], answer: '81' },
    { question: '4 × 6 = ?',  options: ['20', '22', '24', '28'], answer: '24' },
    { question: '5 × 5 = ?',  options: ['20', '25', '30', '35'], answer: '25' },
    { question: '7 × 8 = ?',  options: ['54', '56', '58', '64'], answer: '56' },
    { question: '6 × 9 = ?',  options: ['48', '54', '56', '63'], answer: '54' },
    { question: '3 × 7 = ?',  options: ['18', '21', '24', '27'], answer: '21' },
    { question: '11 × 4 = ?', options: ['40', '42', '44', '48'], answer: '44' },
    { question: '12 × 5 = ?', options: ['55', '60', '65', '70'], answer: '60' },
    { question: '8 × 9 = ?',  options: ['64', '72', '81', '89'], answer: '72' },
  ],
}

/* ────────────────────────────────────────────────────────────────────
 *  GRADE 4 — MATHEMATICS — Fraction Match
 * ──────────────────────────────────────────────────────────────────── */
const FRACTION_MATCH_G4 = {
  id: 'math_fraction_match_g4',
  title: 'Fraction Match',
  subject: 'mathematics',
  grade: 4,
  type: 'timed_quiz',
  difficulty: 'easy',
  description: 'Pick the equivalent fraction before the timer beats you.',
  timer: 90,
  points: 10,
  active: true,
  cbc_topic: 'Fractions',
  questions: [
    { question: 'Which is equal to 1/2?',     options: ['2/3', '3/6', '4/10', '5/9'],   answer: '3/6' },
    { question: 'Simplify 4/8.',              options: ['1/2', '1/3', '2/3', '3/4'],    answer: '1/2' },
    { question: '2/3 of 12 is…',              options: ['4', '6', '8', '10'],           answer: '8' },
    { question: 'Which is largest?',          options: ['1/2', '1/3', '1/4', '1/5'],    answer: '1/2' },
    { question: 'Simplify 6/9.',              options: ['2/3', '3/4', '4/5', '5/6'],    answer: '2/3' },
    { question: '1/4 + 1/4 = ?',              options: ['1/8', '2/4', '2/8', '1/2'],    answer: '2/4' },
    { question: '3/5 of 20 is…',              options: ['8', '10', '12', '15'],         answer: '12' },
    { question: 'Simplify 10/15.',            options: ['1/2', '2/3', '3/4', '4/5'],    answer: '2/3' },
    { question: 'Which is smallest?',         options: ['3/4', '3/5', '3/6', '3/7'],    answer: '3/7' },
    { question: '1 − 1/3 = ?',                options: ['1/3', '2/3', '3/3', '4/3'],    answer: '2/3' },
    { question: '3/4 + 1/4 = ?',              options: ['2/4', '3/4', '1', '4/4'],      answer: '1' },
    { question: 'Simplify 8/12.',             options: ['1/2', '2/3', '3/4', '4/5'],    answer: '2/3' },
  ],
}

/* ────────────────────────────────────────────────────────────────────
 *  GRADE 4 — ENGLISH — Spell It Right
 * ──────────────────────────────────────────────────────────────────── */
const SPELL_IT_RIGHT_G4 = {
  id: 'english_spell_it_right_g4',
  title: 'Spell It Right',
  subject: 'english',
  grade: 4,
  type: 'timed_quiz',
  difficulty: 'easy',
  description: 'Pick the correct spelling of the underlined word.',
  timer: 90,
  points: 10,
  active: true,
  cbc_topic: 'Spelling',
  questions: [
    { question: 'Choose the correct spelling:',   options: ['recieve', 'receive', 'receeve', 'receve'],   answer: 'receive' },
    { question: 'Choose the correct spelling:',   options: ['becuase', 'because', 'becouse', 'becaus'],    answer: 'because' },
    { question: 'Choose the correct spelling:',   options: ['which', 'wich', 'whch', 'witch'],             answer: 'which' },
    { question: 'Choose the correct spelling:',   options: ['frend', 'freind', 'friend', 'freand'],        answer: 'friend' },
    { question: 'Choose the correct spelling:',   options: ['beautifull', 'beutiful', 'beautiful', 'beautifl'], answer: 'beautiful' },
    { question: 'Choose the correct spelling:',   options: ['happened', 'happend', 'hapenned', 'hapened'], answer: 'happened' },
    { question: 'Choose the correct spelling:',   options: ['seperate', 'separate', 'seprate', 'separete'], answer: 'separate' },
    { question: 'Choose the correct spelling:',   options: ['tomorrow', 'tommorow', 'tommorrow', 'tomorow'], answer: 'tomorrow' },
    { question: 'Choose the correct spelling:',   options: ['begining', 'beggining', 'beginning', 'begginning'], answer: 'beginning' },
    { question: 'Choose the correct spelling:',   options: ['definately', 'definitely', 'definitley', 'definitly'], answer: 'definitely' },
  ],
}

/* ────────────────────────────────────────────────────────────────────
 *  GRADE 5 — SCIENCE — Human Body Explorer
 * ──────────────────────────────────────────────────────────────────── */
const HUMAN_BODY_G5 = {
  id: 'science_human_body_g5',
  title: 'Human Body Explorer',
  subject: 'science',
  grade: 5,
  type: 'timed_quiz',
  difficulty: 'easy',
  description: 'Learn about organs, senses and body systems.',
  timer: 90,
  points: 10,
  active: true,
  cbc_topic: 'The Human Body',
  questions: [
    { question: 'Which organ pumps blood around the body?',  options: ['Lungs', 'Heart', 'Liver', 'Stomach'],  answer: 'Heart' },
    { question: 'We breathe in oxygen through the…',         options: ['Stomach', 'Skin', 'Lungs', 'Kidneys'], answer: 'Lungs' },
    { question: 'The sense organ for smelling is the…',      options: ['Ear', 'Eye', 'Tongue', 'Nose'],        answer: 'Nose' },
    { question: 'Which part supports the body?',             options: ['Muscles', 'Skeleton', 'Blood', 'Skin'], answer: 'Skeleton' },
    { question: 'Food is broken down in the…',               options: ['Heart', 'Digestive system', 'Lungs', 'Brain'], answer: 'Digestive system' },
    { question: 'How many senses does a human have?',        options: ['3', '4', '5', '6'],                    answer: '5' },
    { question: 'Which organ controls thinking?',            options: ['Heart', 'Kidney', 'Brain', 'Liver'],   answer: 'Brain' },
    { question: 'A balanced diet gives our body…',           options: ['Sugar', 'Nutrients', 'Water only', 'Salt'], answer: 'Nutrients' },
    { question: 'Blood is carried around the body by…',      options: ['Nerves', 'Bones', 'Veins and arteries', 'Muscles'], answer: 'Veins and arteries' },
    { question: 'The skin helps us sense…',                  options: ['Sound', 'Touch', 'Smell', 'Taste'],    answer: 'Touch' },
  ],
}

/* ────────────────────────────────────────────────────────────────────
 *  GRADE 6 — MATHEMATICS — Math Memory (memory_match type placeholder)
 *  Left in the seed so teachers can see the shape for non-quiz games.
 * ──────────────────────────────────────────────────────────────────── */
const MATH_MEMORY_G6 = {
  id: 'math_memory_g6',
  title: 'Math Memory',
  subject: 'mathematics',
  grade: 6,
  type: 'memory_match',
  difficulty: 'medium',
  description: 'Match each multiplication to its answer.',
  timer: 120,
  points: 10,
  active: true,
  cbc_topic: 'Multiplication',
  questions: [
    { question: '7 × 6', options: [], answer: '42' },
    { question: '7 × 8', options: [], answer: '56' },
    { question: '8 × 4', options: [], answer: '32' },
    { question: '8 × 9', options: [], answer: '72' },
    { question: '7 × 7', options: [], answer: '49' },
    { question: '8 × 8', options: [], answer: '64' },
  ],
}

/* ────────────────────────────────────────────────────────────────────
 *  Manifest
 * ──────────────────────────────────────────────────────────────────── */
export const GAMES_SEED = [
  SPEED_TABLES_G4,
  FRACTION_MATCH_G4,
  SPELL_IT_RIGHT_G4,
  HUMAN_BODY_G5,
  MATH_MEMORY_G6,
]

/**
 * A "fallback" games list for the UI when Firestore is empty / unreachable.
 * Lets the site render meaningful content before the admin seeds the DB.
 * The ids match the seed so deep-links keep working after seeding.
 */
export function getFallbackGames(filter = {}) {
  let games = GAMES_SEED.slice()
  if (filter.grade != null) games = games.filter((g) => g.grade === Number(filter.grade))
  if (filter.subject) games = games.filter((g) => g.subject === filter.subject)
  return games
}

export function getFallbackGame(id) {
  return GAMES_SEED.find((g) => g.id === id) || null
}
