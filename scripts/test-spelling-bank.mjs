/**
 * The Grade 7 spelling bank's contract.
 *
 * The bank is CONTENT, and content is where a spelling game goes wrong: a
 * sentence that contains its own answer turns the exercise into copying, an
 * American spelling teaches a child to lose a mark in an ECZ paper, and a
 * duplicate word makes a "fresh" stage serve a word the learner just did.
 * None of those break a build or throw at runtime — they just quietly make the
 * game worse. So they are pinned here.
 *
 * Run: npm run test:spelling-bank
 */
import {
  SPELLING_BANK,
  SPELLING_BANDS,
  SPELLING_GRADE,
  bandCounts,
  fillSentence,
  wordsInBand,
} from '../src/data/spellingBank.js'
import {
  COACH_STRATEGIES,
  SPELLING_COACH,
  coachFor,
  validateCoachEntry,
} from '../src/data/spellingCoach.js'

let passed = 0
const failures = []
function check(cond, msg) {
  if (cond) { passed += 1; return }
  failures.push(msg)
}

/* ── shape ──────────────────────────────────────────────────────────── */

check(SPELLING_GRADE === 7, 'the bank declares the one grade it serves')
check(SPELLING_BANK.length >= 800,
  `the bank holds at least 800 words (has ${SPELLING_BANK.length})`)

const BAND_IDS = new Set(SPELLING_BANDS.map((b) => b.id))
check(BAND_IDS.size === SPELLING_BANDS.length, 'band ids are unique')

for (const row of SPELLING_BANK) {
  check(typeof row.word === 'string' && row.word.length > 0, `every row has a word (${JSON.stringify(row)})`)
  check(BAND_IDS.has(row.band), `"${row.word}" sits in a declared band (got "${row.band}")`)
  check(typeof row.sentence === 'string' && row.sentence.length > 0, `"${row.word}" has a sentence`)
}

/* ── no duplicates ──────────────────────────────────────────────────── */

const seen = new Map()
for (const row of SPELLING_BANK) {
  const key = row.word.toLowerCase()
  check(!seen.has(key), `"${row.word}" appears once (also in band "${seen.get(key)}")`)
  seen.set(key, row.band)
}

/* ── the sentence never contains its own answer ─────────────────────── */
//
// The whole mechanic is "hear it, then produce it". A sentence printing the
// word turns that into copying. Checked as a WHOLE WORD so "practise" in a
// sentence does not trip on "practice", and so "her" inside "there" is fine.

for (const row of SPELLING_BANK) {
  const bare = row.sentence.replace('___', ' ')
  const pattern = new RegExp(`\\b${row.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  check(!pattern.test(bare), `"${row.word}" is not printed in its own sentence: "${row.sentence}"`)
}

/* ── exactly one gap, and it is the right marker ────────────────────── */

for (const row of SPELLING_BANK) {
  const gaps = row.sentence.split('___').length - 1
  check(gaps === 1, `"${row.word}" has exactly one gap (has ${gaps})`)
  check(row.sentence.trim().endsWith('.') || row.sentence.trim().endsWith('?') || row.sentence.trim().endsWith('!'),
    `"${row.word}" ends its sentence properly: "${row.sentence}"`)
}

/* ── British spelling ───────────────────────────────────────────────── */
//
// Generated word lists drift American by default, so this is a machine check
// rather than a line in a doc. practice/practise is NOT here: both are correct
// British forms (noun / verb), so no word list can decide between them — that
// is what the homophone band and its sentences are for.

const AMERICAN = [
  ['color', 'colour'], ['favorite', 'favourite'], ['neighbor', 'neighbour'],
  ['honor', 'honour'], ['labor', 'labour'], ['behavior', 'behaviour'],
  ['flavor', 'flavour'], ['humor', 'humour'], ['rumor', 'rumour'],
  ['realize', 'realise'], ['organize', 'organise'], ['recognize', 'recognise'],
  ['apologize', 'apologise'], ['criticize', 'criticise'], ['memorize', 'memorise'],
  ['center', 'centre'], ['theater', 'theatre'], ['meter', 'metre'],
  ['liter', 'litre'], ['fiber', 'fibre'], ['somber', 'sombre'],
  ['traveling', 'travelling'], ['traveled', 'travelled'], ['canceled', 'cancelled'],
  ['modeling', 'modelling'], ['labeled', 'labelled'],
  ['defense', 'defence'], ['offense', 'offence'], ['pretense', 'pretence'],
  ['program', 'programme'], ['catalog', 'catalogue'], ['dialog', 'dialogue'],
  ['gray', 'grey'], ['jewelry', 'jewellery'], ['plow', 'plough'],
  ['skillful', 'skilful'], ['fulfill', 'fulfil'], ['enrollment', 'enrolment'],
  ['math', 'maths'], ['aluminum', 'aluminium'], ['sulfur', 'sulphur'],
]

// NOT in the list above, and each for the same reason as practice/practise:
// both spellings are correct British English and only the MEANING separates
// them, which a word list cannot see.
//
//   check / cheque    — "check your answer" is British; only the bank slip is a cheque
//   draft / draught   — "a first draft" is British; only the beer and the air current
//   tire  / tyre      — "the walk will tire you" is British; only the wheel is a tyre
//   curb  / kerb      — "curb your temper" is British; only the pavement edge is a kerb
//   practice / practise — noun / verb
//
// Flagging any of these would fail the bank on correct English, which is worse
// than missing an Americanism: a check that cries wolf gets switched off. They
// belong in the homophone band, where the sentence does the deciding.

for (const row of SPELLING_BANK) {
  const hay = `${row.word} ${row.sentence}`.toLowerCase()
  for (const [us, uk] of AMERICAN) {
    const pattern = new RegExp(`\\b${us}\\b`)
    check(!pattern.test(hay),
      `"${row.word}" uses the British form — found "${us}", expected "${uk}" in "${row.sentence}"`)
  }
}

// And prove the check can fail, so it is not decoration.
{
  const bad = 'The color of the center was gray.'
  const caught = AMERICAN.filter(([us]) => new RegExp(`\\b${us}\\b`).test(bad.toLowerCase()))
  check(caught.length === 3, 'the British-spelling check catches a deliberately American sentence')
}

/* ── every band can actually field stages ───────────────────────────── */
//
// A stage is 8 words. A band that cannot fill one stage is a chapter with
// nothing in it, which is worse than a chapter that does not exist.

const WORDS_PER_STAGE = 8
const counts = bandCounts()
for (const band of SPELLING_BANDS) {
  check(counts[band.id] >= WORDS_PER_STAGE,
    `band "${band.id}" can fill at least one stage (has ${counts[band.id]})`)
  check(wordsInBand(band.id).length === counts[band.id],
    `wordsInBand("${band.id}") agrees with the count`)
}

/* ── fillSentence puts the word back, and capitalises a leading gap ─── */

check(fillSentence('friend', 'My best ___ lives in Kitwe.') === 'My best friend lives in Kitwe.',
  'fillSentence drops the word into the gap')
check(fillSentence('stretch', '___ your arms before you start running.') === 'Stretch your arms before you start running.',
  'fillSentence capitalises a word that leads its sentence')
check(fillSentence('', 'nothing ___') === 'nothing ___', 'fillSentence with no word changes nothing')
check(fillSentence('word', '') === '', 'fillSentence with no sentence returns empty')

/* ── the coach: every cut rebuilds its word ─────────────────────────── */
//
// A cut that does not rejoin to the word teaches a misspelling, which is worse
// than showing nothing. This is the check the authoring tool runs on save, run
// here over everything that has already been authored.

const coachWords = Object.keys(SPELLING_COACH)
for (const word of coachWords) {
  const problems = validateCoachEntry(word, SPELLING_COACH[word])
  check(problems.length === 0, `coach entry for "${word}" is publishable — ${problems.join('; ')}`)
}

// Prove the validator can fail, so it is not decoration.
{
  const broken = validateCoachEntry('separate', {
    chunks: ['sep', 'e', 'rate'], trap: 1, strategy: 'syllables', hook: '', hookNote: '', why: 'x', transfer: [],
  })
  check(broken.length === 1 && broken[0].includes('seperate'),
    'the coach validator catches a cut that rebuilds the wrong word')
  const noStrategy = validateCoachEntry('cat', {
    chunks: ['c', 'at'], trap: null, strategy: 'guesswork', hook: '', hookNote: '', why: 'x', transfer: [],
  })
  check(noStrategy.some((p) => p.includes('guesswork')), 'the coach validator rejects an unknown strategy')
}

// A coached word must be IN the bank — a cut for a word the game never serves
// is content nobody will ever see.
const bankWords = new Set(SPELLING_BANK.map((r) => r.word))
for (const word of coachWords) {
  check(bankWords.has(word), `coached word "${word}" is in the bank`)
}

for (const word of coachWords) {
  check(COACH_STRATEGIES.includes(SPELLING_COACH[word].strategy),
    `"${word}" declares a known strategy`)
}

check(coachFor('separate') !== null, 'coachFor finds an authored word')
check(coachFor('definitely-not-a-word') === null, 'coachFor returns null for an unauthored word')

// Hooks are meant to be RARE. If most words grew one, someone has started
// inventing them, and a forgettable mnemonic is worse than none.
{
  const withHook = coachWords.filter((w) => SPELLING_COACH[w].hook).length
  check(withHook <= Math.ceil(coachWords.length * 0.2),
    `memory hooks stay rare (${withHook} of ${coachWords.length} have one)`)
}

/* ── report ─────────────────────────────────────────────────────────── */

const stages = Math.floor(SPELLING_BANK.length / WORDS_PER_STAGE)
if (failures.length) {
  console.error(`\nspelling bank: ${failures.length} FAILED\n`)
  for (const f of failures.slice(0, 40)) console.error('  ✗ ' + f)
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`)
  process.exit(1)
}

console.log(`spelling bank: ${passed} checks passed`)
console.log(`  ${SPELLING_BANK.length} Grade ${SPELLING_GRADE} words · ${stages} stages of ${WORDS_PER_STAGE} fillable`)
for (const band of SPELLING_BANDS) {
  const n = counts[band.id]
  console.log(`  ${String(n).padStart(4)}  ${band.id.padEnd(11)} ${Math.floor(n / WORDS_PER_STAGE)} stages  — ${band.title}`)
}
const coached = Object.keys(SPELLING_COACH).length
console.log(`  coach cuts authored for ${coached} of ${SPELLING_BANK.length} words ` +
  `(${Math.round((coached / SPELLING_BANK.length) * 100)}%) — deliberately partial, see spellingCoach.js`)
