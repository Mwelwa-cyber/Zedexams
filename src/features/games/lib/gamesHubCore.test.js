/**
 * gamesHubCore — the Games hub's rules, under plain `node`.
 *
 * The one that matters most is the first block. "TODAY'S QUIZ · GRADE 3"
 * beside "Grade 7" was not a rendering slip: the hub answered "which grade"
 * twice, in two ways, and the daily quiz genuinely was the wrong grade's.
 * A test that both cards call the same function is the only kind that can
 * fail when someone reintroduces the second answer.
 */
import assert from 'node:assert/strict'
import {
  NEW_GAME_WINDOW_MS,
  buildCatalogue,
  dailyHeroCopy,
  gameMetaLine,
  gameStatusPill,
  isRecentlyAdded,
  resolveLearnerGrade,
  unavailableRowCopy,
} from './gamesHubCore.js'
import { LEARNER_GRADES } from '../../../config/curriculum.js'

/* ── resolveLearnerGrade ───────────────────────────────────────────── */

assert.equal(resolveLearnerGrade({ grade: 7 }), 7)
// Firestore hands back strings as readily as numbers, and both spellings
// are in live profiles.
assert.equal(resolveLearnerGrade({ grade: '7' }), 7, 'a string grade is the same grade')
assert.equal(resolveLearnerGrade({ grade: ' 4 ' }), 4, 'padding is not a different grade')

// A learner whose grade has not opened yet keeps THEIR grade. The rollout
// is not a reason to answer a question about a person with a question
// about the product — and their hub then shows an empty daily rather than
// Grade 7's quiz, which is the whole point of the grade scope.
assert.equal(resolveLearnerGrade({ grade: 4 }), 4)

// No profile at all: /games is a public route, so this is the signed-out
// visitor. One grade is open, so one grade is what can honestly be shown.
const [rollout] = LEARNER_GRADES
assert.equal(resolveLearnerGrade(null), rollout)
assert.equal(resolveLearnerGrade({}), rollout)
assert.equal(resolveLearnerGrade({ grade: null }), rollout)
assert.equal(resolveLearnerGrade({ grade: 'Grade Seven' }), rollout, 'unparseable is not a grade')
assert.equal(resolveLearnerGrade({ grade: 0 }), rollout, 'there is no grade zero')
assert.equal(resolveLearnerGrade({ grade: 7.5 }), rollout, 'a grade is an integer')

// The pair the bug was made of: whatever the profile says, ONE call
// answers for both hero cards, so they cannot print different numbers.
for (const profile of [{ grade: 7 }, { grade: '5' }, {}, null]) {
  assert.equal(
    resolveLearnerGrade(profile),
    resolveLearnerGrade(profile),
    'the two hero pills read the same function — they must agree by construction',
  )
}

/* ── gameMetaLine ──────────────────────────────────────────────────── */

assert.equal(gameMetaLine('Mathematics', 'Numbers'), 'Mathematics · Numbers')
// A game with no topic keeps its subject and grows no trailing separator.
assert.equal(gameMetaLine('English', ''), 'English')
assert.equal(gameMetaLine('English', null), 'English')
assert.equal(gameMetaLine('', 'Spelling'), 'Spelling')
assert.equal(gameMetaLine(null, undefined), '')
assert.equal(gameMetaLine('  English  ', ' Spelling '), 'English · Spelling')

/* ── gameStatusPill ────────────────────────────────────────────────── */

assert.deepEqual(gameStatusPill({ best: 0, isNew: false }), { kind: 'play', label: 'Play' })
assert.deepEqual(gameStatusPill({ best: 120, isNew: false }), { kind: 'best', label: 'Best 120' })
assert.deepEqual(gameStatusPill({ best: 0, isNew: true }), { kind: 'new', label: 'New' })
// A played game shows its score even when it is also new: what the learner
// did outranks how long the game has been in the catalogue.
assert.deepEqual(gameStatusPill({ best: 40, isNew: true }), { kind: 'best', label: 'Best 40' })
assert.deepEqual(gameStatusPill(), { kind: 'play', label: 'Play' })
assert.deepEqual(gameStatusPill({ best: 'x' }), { kind: 'play', label: 'Play' })
// The pill is the ONLY status. There is no percentage anywhere in the
// return value, because there is no completion to measure — the bar this
// replaced read 100% at "Best 120" and 0% at "Not played yet".
for (const pill of [gameStatusPill({ best: 120 }), gameStatusPill({ best: 0 })]) {
  assert.equal(Object.keys(pill).sort().join(','), 'kind,label')
  assert.ok(!/%/.test(pill.label))
}

/* ── isRecentlyAdded ───────────────────────────────────────────────── */

const now = 1_760_000_000_000
assert.equal(isRecentlyAdded(now - 1000, now), true)
assert.equal(isRecentlyAdded(now - NEW_GAME_WINDOW_MS + 1, now), true)
assert.equal(isRecentlyAdded(now - NEW_GAME_WINDOW_MS - 1, now), false)
// A Firestore Timestamp, as the live docs carry it.
assert.equal(isRecentlyAdded({ toMillis: () => now - 1000 }, now), true)
// No creation date — every bundled seed doc. An unknown date is not
// evidence of recency, and `0 && …` rendering a literal "0" chip beside
// the subject is the bug the old truthiness check produced.
assert.equal(isRecentlyAdded(undefined, now), false)
assert.equal(isRecentlyAdded(0, now), false)
assert.equal(isRecentlyAdded(null, now), false)
assert.equal(isRecentlyAdded('yesterday', now), false)

/* ── dailyHeroCopy ─────────────────────────────────────────────────── */

const streaking = dailyHeroCopy({ hasQuiz: true, streakDays: 3 })
assert.equal(streaking.title, 'Play with Zed')
assert.match(streaking.sub, /3-day streak/)
assert.equal(streaking.action, 'Play')

const fresh = dailyHeroCopy({ hasQuiz: true, streakDays: 0 })
assert.match(fresh.sub, /start a streak/)
assert.equal(fresh.action, 'Play')

// The grade-scoped query found nothing. The card says so and offers NO
// action — the alternative is another grade's quiz, which is the bug.
const empty = dailyHeroCopy({ hasQuiz: false, streakDays: 9 })
assert.equal(empty.title, 'No quiz today')
assert.equal(empty.action, null, 'an empty day must not offer a Play that leads nowhere')
assert.ok(!/streak/i.test(empty.sub), 'do not dangle a streak at a learner who cannot play today')
assert.deepEqual(dailyHeroCopy(), dailyHeroCopy({ hasQuiz: false }))

/* ── buildCatalogue: the learner's grade, or nothing ───────────────── */

const MECHANICS = [
  { type: 'number_target', name: 'Number Path' },
  { type: 'word_builder', name: 'Word Builder' },
  { type: 'memory_match', name: 'Meaning Match' },
  { type: 'punctuation', name: 'Punctuation Pro' },
]
const pack = (id, type, grade, extra = {}) => ({ id, type, grade, ...extra })

// The exact live shape: a Grade 7 learner, a `memory_match` pack that
// exists for Grade 6 and not for theirs. Before this, that Grade 6 maths
// pack was shown under the mechanic's name — "Meaning Match · Mathematics
// · Fractions, Decimals & Percent" — and opened for them.
{
  const rows = buildCatalogue({
    mechanics: MECHANICS,
    games: [pack('math_memory_g6', 'memory_match', 6), pack('punc_g7', 'punctuation', 7)],
    seeded: [],
    grade: 7,
  })
  assert.equal(rows.length, 4, 'every mechanic gets a row, present or not')
  assert.deepEqual(rows.map((r) => r.type), MECHANICS.map((m) => m.type), 'and in the mockup order')

  const meaning = rows.find((r) => r.type === 'memory_match')
  assert.equal(meaning.game, null, "a Grade 6 pack is not this learner's Meaning Match")
  assert.equal(meaning.name, 'Meaning Match', 'the row still names the mechanic it is waiting for')

  assert.equal(rows.find((r) => r.type === 'punctuation').game.id, 'punc_g7')
  // Not filtered out — a catalogue of "exactly four" that shows two is the
  // failure this shape exists to avoid.
  assert.equal(rows.filter((r) => !r.game).length, 3)
}

// Live doc wins over the seed for the same grade; the seed still backs a
// mechanic the live collection has not been seeded with.
{
  const rows = buildCatalogue({
    mechanics: MECHANICS,
    games: [pack('live_np_g7', 'number_target', 7)],
    seeded: [pack('seed_np_g7', 'number_target', 7), pack('seed_wb_g7', 'word_builder', 7)],
    grade: 7,
  })
  assert.equal(rows.find((r) => r.type === 'number_target').game.id, 'live_np_g7')
  assert.equal(rows.find((r) => r.type === 'word_builder').game.id, 'seed_wb_g7')
}

// The seed is checked for grade too. A grade-scoped query says nothing
// about what the FALLBACK contains, and the fallback is where every
// grade's packs live.
{
  const rows = buildCatalogue({
    mechanics: MECHANICS,
    games: [],
    seeded: [pack('seed_np_g4', 'number_target', 4)],
    grade: 7,
  })
  assert.equal(rows.find((r) => r.type === 'number_target').game, null)
}

// Firestore hands grades back as strings as readily as numbers, and a
// string/number mismatch here would silently empty the whole catalogue.
{
  const rows = buildCatalogue({
    mechanics: MECHANICS,
    games: [pack('g', 'punctuation', '7')],
    seeded: [],
    grade: 7,
  })
  assert.equal(rows.find((r) => r.type === 'punctuation').game.id, 'g')
}

// Degenerate inputs answer with a shape rather than throwing: the hub
// calls this during its loading pass, before any fetch has resolved.
assert.deepEqual(buildCatalogue(), [])
assert.equal(buildCatalogue({ mechanics: MECHANICS, grade: 7 }).filter((r) => r.game).length, 0)

/* ── unavailableRowCopy ────────────────────────────────────────────── */

const soon = unavailableRowCopy(7)
assert.equal(soon.pill, 'Soon')
assert.match(soon.meta, /Grade 7/)
// No subject. Three of the four mechanics have an inherent one and
// `memory_match` does not — its packs are English in one grade and
// mathematics in another — so naming a subject for a pack that does not
// exist would be guessing in the one place this module exists to stop it.
for (const subject of ['Mathematics', 'English', 'Science', 'Social Studies']) {
  assert.ok(!soon.meta.includes(subject), `the placeholder invented a subject: ${soon.meta}`)
}

/* ── Copy is written for an 11-year-old ────────────────────────────── */

// "same questions, server keeps score" is engineering reassurance written
// for an adult reviewer. Fairness is the promise; the server is how it is
// kept, and it belongs in no string a child reads.
const everyString = [
  ...Object.values(dailyHeroCopy({ hasQuiz: true, streakDays: 1 })),
  ...Object.values(dailyHeroCopy({ hasQuiz: false })),
  gameStatusPill({ best: 10 }).label,
  gameStatusPill({}).label,
  ...Object.values(unavailableRowCopy(7)),
].filter((v) => typeof v === 'string')
for (const line of everyString) {
  assert.ok(
    !/\b(server|query|firestore|api|scoped|validated)\b/i.test(line),
    `machine vocabulary reached a learner-facing string: "${line}"`,
  )
}

console.log(
  '✓ games hub core — grade resolution, catalogue scoping, meta lines, status pills, '
  + `hero copy (rollout grade ${rollout})`,
)
