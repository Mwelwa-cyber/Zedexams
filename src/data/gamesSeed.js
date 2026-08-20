/**
 * Seed data for the `games` Firestore collection.
 *
 * Shape matches the agreed document schema exactly:
 *   {
 *     title, subject, grade, type, difficulty, description, timer,
 *     points, active, cbc_topic, questions[],
 *     isDemo?
 *   }
 *
 * Import these into Firestore from /admin/games-seed (wired to
 * `importSeedGame` in gamesService.js). This array is the SEED, not the
 * live catalogue: an admin deleting a game removes the Firestore record
 * only, so the entry below survives and can be imported again.
 *
 * Document IDs use the convention `<subject>_<slug>_g<grade>` so they are
 * stable across environments and easy to reason about in URLs / logs.
 */

import { FRACTION_QUESTIONS } from './fractionPack.js'


/* ═══════════════════════════════════════════════════════════════════
 *  GRADE 7 — Zambian upper primary, and the only grade open to learners.
 *  Primary school here runs to Grade 7; it is the grade that sits the
 *  national exam, not a grade beyond scope.
 * ═══════════════════════════════════════════════════════════════════ */

const INTEGERS_G7 = {
  id: 'math_integers_g7',
  title: 'Integer Battle',
  subject: 'mathematics',
  grade: 7,
  type: 'timed_quiz',
  difficulty: 'medium',
  description: 'Positives, negatives, and everything in between.',
  timer: 90,
  points: 12,
  // Was `active: false`, on the note "outside Zambian CBC primary scope
  // (G1-G6)". Zambian primary school runs to GRADE 7 — the grade that sits
  // the national exam, and the only grade this app is open to. The premise
  // was wrong, so a Grade 7 maths quiz sat dark for it.
  active: true,
  cbc_topic: 'Integers',
  questions: [
    { question: '(−5) + 3 = ?',      options: ['−8', '−2', '2', '8'],    answer: '−2' },
    { question: '(−4) × (−6) = ?',   options: ['−24', '−10', '10', '24'], answer: '24' },
    { question: '7 + (−9) = ?',      options: ['−16', '−2', '2', '16'],  answer: '−2' },
    { question: '(−12) ÷ 4 = ?',     options: ['−3', '3', '−4', '4'],    answer: '−3' },
    { question: 'Which is smallest?', options: ['−7', '−2', '0', '4'],    answer: '−7' },
    { question: '|−8| = ?',           options: ['−8', '0', '8', '16'],    answer: '8'  },
    { question: '(−3) × 5 = ?',       options: ['−15', '−8', '8', '15'],   answer: '−15' },
    { question: '6 − 10 = ?',         options: ['−4', '4', '−16', '16'],   answer: '−4' },
  ],
}

/* ────────────────────────────────────────────────────────────────────
 *  Manifest
 * ──────────────────────────────────────────────────────────────────── */
/**
 * The games a learner may play WITHOUT a subscription.
 *
 * `PlayGame` locks a game with `!isDemoGame(game) && !canAccessFullContent`,
 * and until 2026-08-20 every id in this set was a Grade 1-4 game — grades no
 * learner can reach, because the app is open to Grade 7 alone. So a Grade 7
 * learner with no subscription opened the hub and found TEN GAMES, ALL TEN
 * LOCKED: nothing in lint, the build or any test could see it, because every
 * one of them asks whether the lock works, and the lock worked.
 *
 * Four are free, one per subject, mixing a mechanic with a quiz so the free
 * learner meets both shapes. `test:learner-grade-games` fails if an open
 * grade ever has none.
 */
const DEFAULT_DEMO_GAME_IDS = new Set([
  'english_punctuation_g7',   // English  · mechanic
  'math_number_target_g7',    // Maths    · mechanic
  'science_body_systems_g7',  // Science  · quiz
  'social_know_zambia_g7',    // Social   · the map game
])

function applyGameAccessDefaults(game) {
  return {
    ...game,
    isDemo: typeof game?.isDemo === 'boolean'
      ? game.isDemo
      : DEFAULT_DEMO_GAME_IDS.has(game?.id),
  }
}

const PUNCTUATION_G7 = {
  id: 'english_punctuation_g7',
  title: 'Punctuation Pro',
  subject: 'english',
  grade: 7,
  type: 'punctuation',
  difficulty: 'medium',
  description: 'Commas, quotation marks and capitals — tap the correctly punctuated sentence.',
  timer: 60,
  points: 15,
  active: true,
  cbc_topic: 'Punctuation',
  questions: [
    { question: '', options: ['She has a beautiful voice.', 'She has a beautiful voice,', 'she has a beautiful voice.'], answer: 'She has a beautiful voice.' },
    { question: '', options: ['How many countries are there in Africa?', 'how many countries are there in Africa?', 'How many countries are there in Africa.'], answer: 'How many countries are there in Africa?' },
    { question: '', options: ['Plums, pears, apples and bananas are good sources of vitamin C.', 'Plums pears apples and bananas are good sources of vitamin C.', 'Plums, pears, apples and bananas are good sources of Vitamin C,'], answer: 'Plums, pears, apples and bananas are good sources of vitamin C.' },
    { question: '', options: ['“Are you a student here?” Tony asked.', '“Are you a student here? Tony asked.', 'Are you a student here, Tony asked?'], answer: '“Are you a student here?” Tony asked.' },
    { question: '', options: ['Where are you going, Mary?', 'Where are you going Mary.', 'where are you going, Mary?'], answer: 'Where are you going, Mary?' },
    { question: '', options: ['I bought sugar, salt and rice.', 'I bought sugar salt and rice.', 'I bought sugar, salt and rice'], answer: 'I bought sugar, salt and rice.' },
    { question: '', options: ['It is raining, so we stayed inside.', 'It is raining so we stayed inside', 'it is raining, so we stayed inside.'], answer: 'It is raining, so we stayed inside.' },
    { question: '', options: ['My uncle lives in Ndola, but he works in Kitwe.', 'My uncle lives in Ndola but he works in Kitwe', 'my uncle lives in Ndola, but he works in Kitwe.'], answer: 'My uncle lives in Ndola, but he works in Kitwe.' },
    { question: '', options: ['The teacher said, “Open your books.”', 'The teacher said “Open your books”', 'the teacher said, “open your books.”'], answer: 'The teacher said, “Open your books.”' },
    { question: '', options: ['What a wonderful surprise!', 'What a wonderful surprise.', 'what a wonderful surprise!'], answer: 'What a wonderful surprise!' },
  ],
}

const MEANING_MATCH_G7 = {
  id: 'english_meaning_match_g7',
  title: 'Meaning Match',
  subject: 'english',
  grade: 7,
  type: 'memory_match',
  difficulty: 'medium',
  description: 'Match each word to its meaning before the clock runs out.',
  timer: 60,
  points: 15,
  active: true,
  cbc_topic: 'Word meanings',
  questions: [
    { question: 'postponed',   options: [], answer: 'moved to a later time' },
    { question: 'intelligent', options: [], answer: 'clever and quick to understand' },
    { question: 'audience',    options: [], answer: 'people watching a show' },
    { question: 'campaign',    options: [], answer: 'activities to win support' },
    { question: 'suspended',   options: [], answer: 'stopped for a time' },
    { question: 'reluctant',   options: [], answer: 'unwilling to do something' },
    { question: 'abundant',    options: [], answer: 'more than enough' },
    { question: 'fragile',     options: [], answer: 'easily broken' },
    { question: 'persuade',    options: [], answer: 'talk someone into something' },
    { question: 'deteriorate', options: [], answer: 'become worse' },
  ],
}

/* ═══════════════════════════════════════════════════════════════════
 *  GRADE 7 — the only grade open to learners (LEARNER_GRADES), and
 *  until 2026-08 the thinnest grade in this file.
 *
 *  Two of the four catalogue mechanics had no Grade 7 pack at all, so
 *  `buildCatalogue` rendered "Number Path" and "Word Builder" as empty
 *  rows — a hub that names four games and offers two. The daily-challenge
 *  rotation reads the same grade-scoped pool, so it rotated between those
 *  same two packs every day, for every learner in the product.
 *
 *  `test:learner-grade-games` now fails when an open grade is missing a
 *  mechanic, because nothing else in the build notices: an empty row is a
 *  valid render, and a two-game rotation is a working rotation.
 * ═══════════════════════════════════════════════════════════════════ */

const NUMBER_TARGET_G7 = {
  id: 'math_number_target_g7',
  title: 'Number Path: Master',
  subject: 'mathematics',
  grade: 7,
  type: 'number_target',
  difficulty: 'hard',
  description: 'Combine number tiles with + and − to hit the target. Eight levels, and the numbers grow.',
  timer: 0,
  points: 15,
  active: true,
  cbc_topic: 'Operations on Whole Numbers',
  rounds: 8,
  questions: [],
}

const WORD_BUILDER_G7 = {
  id: 'english_word_builder_g7',
  // "Spelling", not "Word Builder": what this card opens is the spelling
  // LADDER — chapters, stages, a personal tricky-words node — and the round is
  // one stage of it. The `type` stays `word_builder` because that is what the
  // registry, the seed importer, the tombstones, the daily challenge and the
  // duel pool all key off; renaming it would fork the catalogue.
  title: 'Spelling',
  subject: 'english',
  grade: 7,
  type: 'word_builder',
  // The whole Grade 7 spelling bank, fetched on demand rather than carried
  // here: 879 words would otherwise sit in the bundle of every learner who
  // opens the games hub. The ten questions below stay as the fallback for a
  // pack that fails to load. See features/games/lib/spellingPack.js.
  wordPack: 'grade7-spelling',
  difficulty: 'hard',
  description: 'Hear the word, build it letter by letter, and climb the chapters — no timer, no lives.',
  timer: 0,
  points: 15,
  active: true,
  cbc_topic: 'Spelling',
  // `chunks` drives the "break it up" coach shown after a miss, and `trap` is
  // the index of the bit that catches people. Where to cut a word is a
  // TEACHING decision — a wrong break teaches a child the wrong word — so the
  // cuts are authored here and test:spelling-stages checks only the thing a
  // machine can check: that the chunks rebuild the word. A word with no chunks
  // gets no coach rather than a guessed split.
  // Words are capped at ten letters: the slot row wraps below that on a
  // 360px screen, which is legible, but a longer word wraps twice and the
  // clue scrolls off. Every word here is one a Grade 7 learner meets in
  // Science, Social Studies or Mathematics — spelling practice that is
  // also revision.
  questions: [
    { question: '🌍 The layer of gases that surrounds the Earth.',        options: [], answer: 'ATMOSPHERE',
      chunks: ['AT', 'MOS', 'PHERE'], strategy: 'syllables', trap: 2,
      why: '“PH” says F — like in “phone”.' },
    { question: '🗳️ A system where the people choose their leaders.',     options: [], answer: 'DEMOCRACY',
      chunks: ['DE', 'MOC', 'RA', 'CY'], strategy: 'syllables', trap: 3,
      why: 'It ends in CY, not SY.' },
    { question: '🌡️ The imaginary line around the middle of the Earth.',  options: [], answer: 'EQUATOR',
      chunks: ['EQU', 'A', 'TOR'], strategy: 'root+affix', trap: 0,
      why: 'Same start as “equal” — both mean the same on each side.' },
    { question: '⛏️ Copper and cobalt are both examples of these.',       options: [], answer: 'MINERALS',
      chunks: ['MINE', 'RAL', 'S'], strategy: 'root+affix', trap: 0,
      why: 'It starts with the word MINE, where they come from.' },
    { question: '🏭 Harmful waste in the air, water or soil.',            options: [], answer: 'POLLUTION',
      chunks: ['POLL', 'U', 'TION'], strategy: 'root+affix', trap: 2,
      why: 'TION says “shun” — like nation and station.' },
    { question: '🥗 Getting the right food for a healthy body.',          options: [], answer: 'NUTRITION',
      chunks: ['NUT', 'RI', 'TION'], strategy: 'family', trap: 2,
      why: 'The same TION family as pollution and station.' },
    { question: '☀️ The usual weather of a place over many years.',       options: [], answer: 'CLIMATE',
      chunks: ['CLI', 'MATE'], strategy: 'sound-out', trap: null,
      why: 'Nothing irregular — it ends in the word MATE.' },
    { question: '🌾 The season when crops are gathered in.',              options: [], answer: 'HARVEST',
      chunks: ['HAR', 'VEST'], strategy: 'sound-out', trap: null,
      why: 'Two clear parts, and VEST is a word you know.' },
    { question: '💵 The Kwacha is Zambia’s ___.',                     options: [], answer: 'CURRENCY',
      chunks: ['CUR', 'REN', 'CY'], strategy: 'syllables', trap: 0,
      why: 'Double R in the middle of the first part.' },
    { question: '🏞️ A smaller river that flows into a bigger one.',       options: [], answer: 'TRIBUTARY',
      chunks: ['TRIB', 'U', 'TAR', 'Y'], strategy: 'syllables', trap: 2,
      why: 'TAR, not TER — it pays a “tribute” to the big river.' },
  ],
}

const RATIO_PERCENT_G7 = {
  id: 'math_ratio_percent_g7',
  title: 'Ratio & Percentage',
  subject: 'mathematics',
  grade: 7,
  type: 'timed_quiz',
  difficulty: 'medium',
  description: 'Sharing, percentages and rates — the Grade 7 way.',
  timer: 90,
  points: 15,
  active: true,
  cbc_topic: 'Ratio and Proportion',
  questions: [
    { question: 'Simplify the ratio 12 : 18',                                          options: ['2 : 3', '3 : 2', '6 : 9', '4 : 5'],         answer: '2 : 3' },
    { question: 'Share K200 between Mutale and Bwalya in the ratio 3 : 2. Mutale gets…', options: ['K120', 'K80', 'K100', 'K150'],             answer: 'K120' },
    { question: 'What is 15% of 300?',                                                  options: ['45', '30', '50', '15'],                    answer: '45' },
    { question: 'Express 3/5 as a percentage.',                                         options: ['60%', '35%', '53%', '75%'],                answer: '60%' },
    { question: 'The ratio of boys to girls is 4 : 5. If there are 20 boys, how many girls?', options: ['25', '16', '20', '30'],              answer: '25' },
    { question: 'A shirt costs K80. The price rises by 25%. The new price is…',          options: ['K100', 'K85', 'K105', 'K120'],             answer: 'K100' },
    { question: 'A bus travels 240 km in 3 hours. Its average speed is…',                options: ['80 km/h', '60 km/h', '90 km/h', '120 km/h'], answer: '80 km/h' },
    { question: 'Which fraction is equal to 0.375?',                                     options: ['3/8', '3/5', '1/3', '5/8'],                answer: '3/8' },
    { question: 'What is the LCM of 8 and 12?',                                          options: ['24', '48', '12', '96'],                    answer: '24' },
    { question: 'What is the HCF of 18 and 24?',                                         options: ['6', '3', '12', '9'],                       answer: '6' },
  ],
}

const ENGLISH_GRAMMAR_G7 = {
  id: 'english_grammar_g7',
  title: 'Grammar & Meaning',
  subject: 'english',
  grade: 7,
  type: 'timed_quiz',
  difficulty: 'medium',
  description: 'Tenses, word classes and meanings — before the clock runs out.',
  timer: 90,
  points: 15,
  active: true,
  cbc_topic: 'Grammar',
  questions: [
    { question: 'What is the plural of “crisis”?',                                    options: ['crises', 'crisises', 'crisis', 'crisi'],                       answer: 'crises' },
    { question: 'If I ___ enough money, I would buy a bicycle.',                      options: ['had', 'have', 'has', 'having'],                                answer: 'had' },
    { question: 'Which word is the adverb? “She sang beautifully at the assembly.”',  options: ['beautifully', 'sang', 'assembly', 'she'],                      answer: 'beautifully' },
    { question: '“The letter was written by Chanda.” This sentence is in the…',       options: ['passive voice', 'active voice', 'future tense', 'imperative'],  answer: 'passive voice' },
    { question: 'What does “reluctant” mean?',                                        options: ['unwilling', 'excited', 'careless', 'honest'],                  answer: 'unwilling' },
    { question: 'Which word is spelled correctly?',                                   options: ['necessary', 'neccessary', 'necesary', 'necessery'],            answer: 'necessary' },
    { question: 'Choose a synonym for “enormous”.',                                   options: ['huge', 'tiny', 'narrow', 'brief'],                             answer: 'huge' },
    { question: 'The prefix “pre-” means…',                                           options: ['before', 'after', 'against', 'again'],                         answer: 'before' },
    { question: 'Which sentence is correct?',                                         options: ['Neither of the boys was late.', 'Neither of the boys were late.', 'Neither of the boys are late.', 'Neither of the boys is being late.'], answer: 'Neither of the boys was late.' },
    { question: 'What is the opposite of “scarce”?',                                  options: ['plentiful', 'rare', 'costly', 'hidden'],                       answer: 'plentiful' },
  ],
}

const SCIENCE_SYSTEMS_G7 = {
  id: 'science_body_systems_g7',
  title: 'Body Systems & Energy',
  subject: 'integrated science',
  grade: 7,
  type: 'timed_quiz',
  difficulty: 'medium',
  description: 'How the body works, and where energy comes from.',
  timer: 90,
  points: 15,
  active: true,
  cbc_topic: 'The Human Body',
  questions: [
    { question: 'Which organ pumps blood around the body?',                    options: ['The heart', 'The liver', 'The lungs', 'The kidney'],                        answer: 'The heart' },
    { question: 'Which gas do plants take in for photosynthesis?',             options: ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Hydrogen'],                         answer: 'Carbon dioxide' },
    { question: 'The main job of the kidneys is to…',                          options: ['remove waste from the blood', 'digest food', 'pump blood', 'store bile'],   answer: 'remove waste from the blood' },
    { question: 'Which blood cells fight infection?',                          options: ['White blood cells', 'Red blood cells', 'Platelets', 'Plasma'],              answer: 'White blood cells' },
    { question: 'HIV attacks which system of the body?',                       options: ['The immune system', 'The digestive system', 'The skeletal system', 'The nervous system'], answer: 'The immune system' },
    { question: 'Which of these is a renewable source of energy?',             options: ['Solar', 'Coal', 'Diesel', 'Petrol'],                                        answer: 'Solar' },
    { question: 'Pure water boils at sea level at…',                           options: ['100 °C', '90 °C', '50 °C', '212 °C'],                                       answer: '100 °C' },
    { question: 'Animals that eat only plants are called…',                    options: ['herbivores', 'carnivores', 'omnivores', 'predators'],                       answer: 'herbivores' },
    { question: 'Which mineral is needed for strong bones and teeth?',         options: ['Calcium', 'Iron', 'Iodine', 'Sodium'],                                      answer: 'Calcium' },
    { question: 'Which part of the plant takes in water from the soil?',       options: ['The roots', 'The leaf', 'The flower', 'The stem'],                          answer: 'The roots' },
  ],
}

const SOCIAL_CIVICS_G7 = {
  id: 'social_zambia_civics_g7',
  title: 'Zambia: Land & Government',
  subject: 'social studies',
  grade: 7,
  type: 'timed_quiz',
  difficulty: 'medium',
  description: 'Provinces, neighbours, independence and how the country is run.',
  timer: 90,
  points: 15,
  active: true,
  cbc_topic: 'Zambia',
  questions: [
    { question: 'Zambia became independent on…',                              options: ['24 October 1964', '24 October 1963', '1 January 1964', '18 October 1964'],  answer: '24 October 1964' },
    { question: 'How many provinces does Zambia have today?',                 options: ['10', '9', '8', '12'],                                                       answer: '10' },
    { question: 'The provincial capital of Muchinga is…',                     options: ['Chinsali', 'Kasama', 'Mpika', 'Isoka'],                                     answer: 'Chinsali' },
    { question: 'The provincial capital of Southern Province is…',            options: ['Choma', 'Livingstone', 'Monze', 'Mazabuka'],                                answer: 'Choma' },
    { question: 'Which of these does NOT border Zambia?',                     options: ['Kenya', 'Angola', 'Tanzania', 'Botswana'],                                  answer: 'Kenya' },
    { question: 'Which lake is shared by Zambia, DR Congo, Tanzania and Burundi?', options: ['Lake Tanganyika', 'Lake Mweru', 'Lake Bangweulu', 'Lake Kariba'],      answer: 'Lake Tanganyika' },
    { question: 'The National Assembly of Zambia is the body that…',          options: ['makes laws', 'judges cases', 'collects taxes', 'runs the schools'],         answer: 'makes laws' },
    { question: 'Zambia’s biggest export is…',                                options: ['Copper', 'Maize', 'Coffee', 'Cotton'],                                      answer: 'Copper' },
    { question: 'The highest banknote in Zambia’s current currency is…',      options: ['K500', 'K100', 'K200', 'K1000'],                                            answer: 'K500' },
    { question: 'Zambia’s first President was…',                              options: ['Kenneth Kaunda', 'Frederick Chiluba', 'Levy Mwanawasa', 'Harry Nkumbula'],  answer: 'Kenneth Kaunda' },
  ],
}

const KNOW_ZAMBIA_G7 = {
  id: 'social_know_zambia_g7',
  title: 'Know Zambia',
  subject: 'social studies',
  grade: 7,
  type: 'map_place',
  difficulty: 'medium',
  description: 'Tap a province name, then tap where it goes. Three first, then five, then all ten.',
  timer: 0,
  points: 15,
  active: true,
  cbc_topic: 'Zambia',
  // The engine reads the outlines, the label anchors and the positional
  // hints from src/data/zambiaGeography.js (generated from the datasets in
  // docs/learner), so this pack carries no questions. `waves` is optional —
  // omitting it plays the default three, then five, then all ten.
  questions: [],
}

/* ═══════════════════════════════════════════════════════════════════
 *  FRACTION LADDER — the nine levels from
 *  docs/learner/zedexams-fraction-levels.html and the picture-first
 *  first level from docs/learner/zedexams-fractions-level1.html.
 *
 *  The QUESTIONS live in `./fractionPack.js`, not here: thirty-one
 *  stages of content inside this file would bury the other forty-six
 *  games, and the ladder is meant to grow a level at a time without
 *  the catalogue being touched. The pack file carries the rules the
 *  content itself has to keep — pictures before the symbol, no
 *  "numerator" in level 1, a named misconception per predicted wrong
 *  answer — and `test:fraction-content` fails the build on each.
 * ═══════════════════════════════════════════════════════════════════ */
const FRACTION_LADDER_G7 = {
  id: 'math_fraction_ladder_g7',
  title: 'Fraction Ladder',
  subject: 'mathematics',
  grade: 7,
  type: 'fraction_ladder',
  difficulty: 'medium',
  description: 'Nine levels, from what a fraction is to fractions in real life. Each one opens the next.',
  timer: 0,
  points: 20,
  active: true,
  cbc_topic: 'Fractions',
  questions: FRACTION_QUESTIONS,
}

/*
 * Five more modes of the same map engine (`type: 'map_place'`, `mode:`).
 *
 * One pack per mode rather than one pack with a menu inside it: the games hub
 * IS the menu here, and a pack is what gives a mode its own titled row, its
 * own description and its own place in the daily rotation. A menu nested
 * inside one pack would put a screen between the learner and the game and
 * hide four of the five from the hub entirely.
 *
 * None of them carries questions. Every province outline, capital, border,
 * route and ceremony is read from src/data/zambiaGeography.js, which is
 * generated from the datasets in docs/learner — the ones a Zambian teacher
 * signs off in. Facts in a pack here would be a second copy to keep in step.
 */

const KNOW_ZAMBIA_CAPITALS_G7 = {
  id: 'social_know_zambia_capitals_g7',
  title: 'Zambia: Where’s the capital?',
  subject: 'social studies',
  grade: 7,
  type: 'map_place',
  mode: 'capital',
  difficulty: 'medium',
  description: 'A town appears on the map. Tap the province it is the capital of.',
  timer: 0,
  points: 15,
  active: true,
  cbc_topic: 'Zambia',
  questions: [],
}

const KNOW_ZAMBIA_JOURNEY_G7 = {
  id: 'social_know_zambia_journey_g7',
  title: 'Zambia: Journey',
  subject: 'social studies',
  grade: 7,
  type: 'map_place',
  mode: 'journey',
  difficulty: 'hard',
  description: 'Travel Livingstone to Kasama and three more roads. Tap every province you cross, in order.',
  timer: 0,
  points: 20,
  active: true,
  cbc_topic: 'Zambia',
  // Omitting `routeId` plays all four routes in the dataset, one after another.
  questions: [],
}

const KNOW_ZAMBIA_ODD_G7 = {
  id: 'social_know_zambia_odd_g7',
  title: 'Zambia: Odd one out',
  subject: 'social studies',
  grade: 7,
  type: 'map_place',
  mode: 'odd',
  difficulty: 'hard',
  description: 'Four provinces are lit and six are dimmed. Three share something. One does not.',
  timer: 0,
  points: 20,
  active: true,
  cbc_topic: 'Zambia',
  questions: [],
}

const KNOW_ZAMBIA_NEIGHBOURS_G7 = {
  id: 'social_know_zambia_neighbours_g7',
  title: 'Zambia: Our neighbours',
  subject: 'social studies',
  grade: 7,
  type: 'map_place',
  mode: 'neighbours',
  difficulty: 'medium',
  description: 'Eight countries touch Zambia. Tap a name, then tap the box it belongs in.',
  timer: 0,
  points: 15,
  active: true,
  cbc_topic: 'Zambia',
  questions: [],
}

const KNOW_ZAMBIA_CEREMONY_G7 = {
  id: 'social_know_zambia_ceremony_g7',
  title: 'Zambia: Where’s the ceremony?',
  subject: 'social studies',
  grade: 7,
  type: 'map_place',
  mode: 'ceremony',
  difficulty: 'medium',
  description: 'Kuomboka, N’cwala, Mutomboko, Likumbi Lya Mize — where each is held, whose it is and when.',
  timer: 0,
  points: 15,
  active: true,
  cbc_topic: 'Zambia',
  questions: [],
}

export const GAMES_SEED = [
  // GRADE 7 ONLY. The app is open to Grade 7 alone (LEARNER_GRADES), and on
  // 2026-08-20 the other 44 entries were removed: grades 1-3 and 8-9 were
  // outside the authoring catalogue entirely, grades 4-6 were unreachable, and
  // ten packs were of mechanics whose engines the 2026-08 redesign retired.
  // None of them could be played by anybody; all of them shipped in the bundle.
  //
  // Adding a grade back means adding its packs here AND opening it in
  // LEARNER_GRADES + DAILY_EXAM_GRADES; test:learner-grade-games fails on a
  // grade opened without content.
  PUNCTUATION_G7,
  MEANING_MATCH_G7,
  NUMBER_TARGET_G7,
  WORD_BUILDER_G7,
  RATIO_PERCENT_G7,
  ENGLISH_GRAMMAR_G7,
  SCIENCE_SYSTEMS_G7,
  SOCIAL_CIVICS_G7,
  KNOW_ZAMBIA_G7,
  KNOW_ZAMBIA_CAPITALS_G7,
  KNOW_ZAMBIA_JOURNEY_G7,
  KNOW_ZAMBIA_ODD_G7,
  KNOW_ZAMBIA_NEIGHBOURS_G7,
  KNOW_ZAMBIA_CEREMONY_G7,
  FRACTION_LADDER_G7,
  INTEGERS_G7,
].map(applyGameAccessDefaults)

export function isDemoGame(game) {
  if (!game) return false
  return typeof game.isDemo === 'boolean'
    ? game.isDemo
    : DEFAULT_DEMO_GAME_IDS.has(game.id)
}

/**
 * A "fallback" games list for the UI when Firestore is empty / unreachable.
 * Lets the site render meaningful content before the admin seeds the DB.
 * The ids match the seed so deep-links keep working after seeding.
 *
 * Mirrors `listGames()` by hiding any seed entry with `active: false` so
 * out-of-scope games (G7+ placeholders, deactivated packs) never leak into
 * the player UI when Firestore reads time out.
 *
 * `filter.exclude` is the set of game ids an admin has PERMANENTLY DELETED
 * (`gameTombstones` — see `src/utils/gameTombstones.js`). Without it a
 * deletion would be invisible to learners: the seed ships in the bundle, so
 * removing `games/{id}` from Firestore does nothing to the copy this
 * function reads. Callers pass the set they loaded; omitting it filters
 * nothing, which is the pre-existing behaviour and the right answer for a
 * caller that has no way to know.
 */
export function getFallbackGames(filter = {}) {
  const excluded = filter.exclude
  let games = GAMES_SEED.filter((g) => g.active !== false && !RETIRED_GAME_TYPES.has(g.type))
  if (excluded?.size) games = games.filter((g) => !excluded.has(g.id))
  if (filter.grade != null) games = games.filter((g) => g.grade === Number(filter.grade))
  if (filter.subject) games = games.filter((g) => g.subject === filter.subject)
  return games
}

/**
 * The bundled seed doc behind a `/games/play/:id` link, or null.
 *
 * `options.exclude` carries the same deletion list as `getFallbackGames`,
 * and it is what stops a permanently deleted game staying launchable
 * through an old direct URL — that path never resolved the id through
 * Firestore, so deleting the document alone would not have closed it.
 */
export function getFallbackGame(id, options = {}) {
  if (options.exclude?.has(id)) return null
  const found = GAMES_SEED.find((g) => g.id === id) || null
  if (!found || found.active === false || RETIRED_GAME_TYPES.has(found.type)) return null
  return found
}

/**
 * Game types whose engines the 2026-08 learner redesign retired (step 4:
 * the legacy mechanics gave way to the prototype's four — Number Path,
 * Word Builder, Meaning Match, Punctuation Pro — with timed_quiz kept
 * for the daily quiz). The seed entries above stay for the record, but
 * fallbacks and player-facing lists filter them, and PlayGame shows a
 * retirement card for any live Firestore doc still carrying one.
 */
export const RETIRED_GAME_TYPES = new Set([
  'province_shapes',
  'sorting_factory',
  'sentence_scramble',
  'market_challenge',
])

/**
 * The four mechanics a learner can be SHOWN as catalogue entries, in the
 * order the mockup lists them, each with the name the mockup gives it.
 *
 * The NAME belongs to the MECHANIC, not to the content pack behind it.
 * A game doc's `title` names its content ("Spell the Animal", "Number
 * Target: Master", "Fraction · Decimal · Percent Match"), and which pack
 * a learner gets depends on their grade — so titling the hub cards from
 * the docs made the catalogue rename itself per grade and per seeding
 * state. The hub therefore reads the card name from here and leaves the
 * doc title to the play surface, where the content is what is on screen.
 *
 * timed_quiz is deliberately absent: it stays playable — it serves the
 * daily challenge and the duel's question pool — but is not a browsable
 * catalogue card.
 */
export const CATALOGUE_MECHANICS = [
  { type: 'number_target', name: 'Number Path' },
  // The card a learner taps to reach the spelling ladder. The TYPE is the
  // registry key and does not move; the NAME is what a child reads.
  { type: 'word_builder',  name: 'Spelling' },
  { type: 'memory_match',  name: 'Meaning Match' },
  { type: 'punctuation',   name: 'Punctuation Pro' },
]

/** The same four, as a membership test. Derived so the two cannot drift. */
export const CATALOGUE_GAME_TYPES = new Set(CATALOGUE_MECHANICS.map((m) => m.type))

/** The mechanic name for a game doc, or its own title if it is not one of the four. */
export function mechanicName(game) {
  return CATALOGUE_MECHANICS.find((m) => m.type === game?.type)?.name || game?.title || 'Game'
}

/**
 * Everything a learner may PLAY: the catalogue mechanics, the daily-quiz
 * engine, and `map_place` — the Know Zambia map game.
 *
 * map_place is deliberately NOT a catalogue mechanic. A mechanic gets a row at
 * every grade whether it has a pack there or not — that is what makes a gap
 * visible for the four the mockup names — and a fifth would print "Know
 * Zambia · Coming soon for Grade 4" on every grade that has no map pack.
 * Listed here instead, it appears as its own titled row wherever a pack for
 * that grade exists and is simply absent everywhere else, which is how the
 * timed_quiz packs already behave.
 */
export const PLAYABLE_GAME_TYPES = new Set([...CATALOGUE_GAME_TYPES, 'timed_quiz', 'map_place', 'fraction_ladder'])
