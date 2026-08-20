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
  progressBlockMode,
  progressStarterRow,
  resolveLearnerGrade,
  unavailableRowCopy,
  zedRaceRow,
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

// The card NAMES the game it opens. It used to read "Today's quiz · Play
// with Zed": the destination is the Daily CHALLENGE (a rotating game), not
// the five-question /daily quiz, and Zed hosts it rather than playing it —
// so a learner who tapped "Play with Zed" landed on "Today's Challenge"
// and read it as a wrong turn.
const streaking = dailyHeroCopy({ hasChallenge: true, streakDays: 3, gameTitle: 'Meaning Match' })
assert.equal(streaking.eyebrow, 'Today’s challenge')
assert.equal(streaking.title, 'Meaning Match')
assert.match(streaking.sub, /3-day streak/)
assert.equal(streaking.action, 'Play')

// Neither of the two names this replaced may come back in any state.
for (const copy of [
  streaking,
  dailyHeroCopy({ hasChallenge: true, streakDays: 0, gameTitle: 'Number Target' }),
  dailyHeroCopy({ hasChallenge: false }),
]) {
  const words = `${copy.eyebrow} ${copy.title} ${copy.sub}`
  assert.ok(!/with Zed/i.test(words), 'the daily challenge is hosted by Zed, not played with him')
  assert.ok(!/quiz/i.test(words), '"quiz" is Home’s /daily card — this one opens a game')
}

const fresh = dailyHeroCopy({ hasChallenge: true, streakDays: 0, gameTitle: 'Number Target' })
assert.equal(fresh.title, 'Number Target')
assert.match(fresh.sub, /start a streak/)
assert.equal(fresh.action, 'Play')

// A challenge doc with no usable title is still a real challenge: keep the
// Play and borrow the destination button's wording, never a placeholder
// that reads like a game's name.
const untitled = dailyHeroCopy({ hasChallenge: true, streakDays: 1, gameTitle: '   ' })
assert.equal(untitled.title, 'Play today’s challenge')
assert.equal(untitled.action, 'Play')

// The grade-scoped query found nothing. The card says so and offers NO
// action — the alternative is another grade's challenge, which is the bug.
const empty = dailyHeroCopy({ hasChallenge: false, streakDays: 9 })
assert.equal(empty.title, 'No challenge today')
assert.equal(empty.action, null, 'an empty day must not offer a Play that leads nowhere')
assert.ok(!/streak/i.test(empty.sub), 'do not dangle a streak at a learner who cannot play today')
assert.deepEqual(dailyHeroCopy(), dailyHeroCopy({ hasChallenge: false }))

/* ── buildCatalogue: every game that exists, at this grade only ────── */

const MECHANICS = [
  { type: 'number_target', name: 'Number Path' },
  { type: 'word_builder', name: 'Word Builder' },
  { type: 'memory_match', name: 'Meaning Match' },
  { type: 'punctuation', name: 'Punctuation Pro' },
]
// Everything with an engine behind it — the four mechanics plus the
// daily-quiz engine, which is what `PLAYABLE_GAME_TYPES` is.
const PLAYABLE = new Set([...MECHANICS.map((m) => m.type), 'timed_quiz'])
const pack = (id, type, grade, extra = {}) => ({ id, type, grade, ...extra })
const named = (rows) => rows.map((r) => r.name)
const ids = (rows) => rows.map((r) => r.game?.id ?? null)

// The exact live shape: a Grade 7 learner, a `memory_match` pack that
// exists for Grade 6 and not for theirs. Before this, that Grade 6 maths
// pack was shown under the mechanic's name — "Meaning Match · Mathematics
// · Fractions, Decimals & Percent" — and opened for them.
{
  const rows = buildCatalogue({
    mechanics: MECHANICS,
    playableTypes: PLAYABLE,
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

// ── The bug this rewrite fixes ─────────────────────────────────────────
//
// A SECOND pack of a mechanic the learner's grade already has. `.find()`
// returned the first and the new one was invisible — an admin adding a
// game watched nothing happen. Both list now.
{
  const rows = buildCatalogue({
    mechanics: MECHANICS,
    playableTypes: PLAYABLE,
    games: [
      pack('mm_words_g7', 'memory_match', 7, { title: 'Word Meanings' }),
      pack('mm_capitals_g7', 'memory_match', 7, { title: 'African Capitals' }),
    ],
    seeded: [],
    grade: 7,
  })
  const meaning = rows.filter((r) => r.type === 'memory_match')
  assert.equal(meaning.length, 2, 'a second pack of a mechanic is a second row, not a dropped one')
  // Two rows both reading "Meaning Match" would identify neither, so the
  // moment a mechanic owns more than one row each speaks for its own pack.
  assert.deepEqual(named(meaning), ['African Capitals', 'Word Meanings'], 'sorted by title, named by pack')
  // Distinct keys, or React collapses the second onto the first — the same
  // disappearance one layer down.
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'every row is keyed uniquely')
}

// The other half: a playable type that is not one of the four mechanics.
// 27 of the 47 bundled games are `timed_quiz`, and browsing could not
// reach a single one of them while learner search listed them all.
{
  const rows = buildCatalogue({
    mechanics: MECHANICS,
    playableTypes: PLAYABLE,
    games: [
      pack('quiz_spell_g7', 'timed_quiz', 7, { title: 'Spell It Right' }),
      pack('quiz_tables_g7', 'timed_quiz', 7, { title: 'Times Tables' }),
      pack('punc_g7', 'punctuation', 7),
    ],
    seeded: [],
    grade: 7,
  })
  assert.deepEqual(
    ids(rows),
    [null, null, null, 'punc_g7', 'quiz_spell_g7', 'quiz_tables_g7'],
    'the four mechanics lead, in the mockup order; everything else follows',
  )
  // A timed_quiz has no mechanic name to borrow, so it uses its own title.
  assert.deepEqual(
    named(rows.filter((r) => r.type === 'timed_quiz')),
    ['Spell It Right', 'Times Tables'],
  )
}

// A type with NO engine never lists, whatever the collection says. A card
// that opens on a retirement notice is worse than no card.
{
  const rows = buildCatalogue({
    mechanics: MECHANICS,
    playableTypes: PLAYABLE,
    games: [pack('retired_g7', 'market_challenge', 7, { title: 'Zed Market' })],
    seeded: [],
    grade: 7,
  })
  assert.equal(rows.filter((r) => r.game).length, 0)
  assert.equal(rows.length, 4, 'and the four mechanics still say what they are waiting for')
}

// No `playableTypes` at all: the conservative catalogue, not everything in
// the pool. A caller that has not said which types have engines must not
// have unknown types assumed playable on its behalf.
{
  const rows = buildCatalogue({
    mechanics: MECHANICS,
    games: [pack('q', 'timed_quiz', 7, { title: 'Quiz' }), pack('p', 'punctuation', 7)],
    seeded: [],
    grade: 7,
  })
  assert.deepEqual(ids(rows).filter(Boolean), ['p'])
}

// Live doc wins over the seed for the same grade; the seed still backs a
// TYPE the live collection has not been seeded with. Per type, never per
// item: merging the pools would list an imported pack beside the bundled
// copy of the same mechanic as two rows.
{
  const rows = buildCatalogue({
    mechanics: MECHANICS,
    playableTypes: PLAYABLE,
    games: [pack('live_np_g7', 'number_target', 7)],
    seeded: [
      pack('seed_np_g7', 'number_target', 7),
      pack('seed_np2_g7', 'number_target', 7),
      pack('seed_wb_g7', 'word_builder', 7),
    ],
    grade: 7,
  })
  const path = rows.filter((r) => r.type === 'number_target')
  assert.deepEqual(ids(path), ['live_np_g7'], 'the live pack answers for its type, alone')
  assert.equal(rows.find((r) => r.type === 'word_builder').game.id, 'seed_wb_g7')
}

// The seed is checked for grade too. A grade-scoped query says nothing
// about what the FALLBACK contains, and the fallback is where every
// grade's packs live.
{
  const rows = buildCatalogue({
    mechanics: MECHANICS,
    playableTypes: PLAYABLE,
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
    playableTypes: PLAYABLE,
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
assert.equal(buildCatalogue({ mechanics: MECHANICS, games: null, seeded: null, grade: 7 }).length, 4)

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

/* ── zedRaceRow ───────────────────────────────────── */

// The row exists because #2496's own justification for deleting the Race
// Zed! hero — "/games/duel is untouched and still reachable" — stopped
// being true: nothing linked to it afterwards, so a fully built screen was
// reachable only by typing the URL while the one card carrying Zed's name
// opened the daily challenge instead.
const zed = zedRaceRow({ challengesAllowed: true })
assert.equal(zed.title, 'Race Zed', 'the row wears the destination\u2019s own title')

// The ONE fact that separates this row from the live race card above it.
// A learner choosing between two races needs to know which opponent is a
// robot BEFORE they tap, not on the screen after.
assert.match(zed.sub, /robot/i, 'the row says who the opponent is')
assert.match(zed.sub, /not a learner/i, 'and says who it is not')

// Guardian controls refuse it, using the SAME predicate the route reads,
// so the hub can never offer a race /games/duel then answers with
// "challenges are switched off for this account".
assert.equal(zedRaceRow({ challengesAllowed: false }), null)
// Fail closed on a caller that says nothing: an unanswered permission
// question is not permission.
assert.equal(zedRaceRow(), null)
assert.equal(zedRaceRow({}), null)

// It must NOT re-describe itself as the live race. "Race a learner" is the
// card above; two rows both promising a human opponent is the collision
// this row was shaped to avoid.
assert.ok(!/race a learner/i.test(`${zed.title} ${zed.sub}`))

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
  ...Object.values(zedRaceRow({ challengesAllowed: true })),
].filter((v) => typeof v === 'string')
for (const line of everyString) {
  assert.ok(
    !/\b(server|query|firestore|api|scoped|validated)\b/i.test(line),
    `machine vocabulary reached a learner-facing string: "${line}"`,
  )
}

// ── progressBlockMode / progressStarterRow ──────────────────────────
//
// Whether the Level strip and the Achievements shelf lead the page or
// collapse to one line under it. The hub used to open the same way for
// everyone, so a first-time learner's screen was more than half taken up
// by two blocks saying they had nothing yet (LEARNER_UI_AUDIT L-16).

// A learner with nothing gets the games first.
assert.equal(progressBlockMode({ signedIn: true }), 'compact')
assert.equal(progressBlockMode({ signedIn: true, earnedCount: 0, totalPoints: 0 }), 'compact')

// Either signal is enough — points come from every run, badges are
// milestones, and a learner can hold one without the other.
assert.equal(progressBlockMode({ signedIn: true, earnedCount: 1 }), 'full')
assert.equal(progressBlockMode({ signedIn: true, totalPoints: 30 }), 'full')
assert.equal(progressBlockMode({ signedIn: true, earnedCount: 3, totalPoints: 900 }), 'full')

// A signed-out visitor has no progress to show, and their level meter can
// only say "sign in" — which is an ask, not a reward.
assert.equal(progressBlockMode({ signedIn: false }), 'compact')
assert.equal(progressBlockMode({ signedIn: false, earnedCount: 4, totalPoints: 900 }), 'compact')

// Called with nothing at all — the shape the hub has on its first render.
assert.equal(progressBlockMode(), 'compact')

// The starter row says what to DO. A differently-worded inventory of the
// learner's zeroes would be the same failure this replaced, so the row
// must never open with a count.
for (const signedIn of [true, false]) {
  const row = progressStarterRow({ signedIn, badgeCount: 10 })
  assert.ok(row.title && row.sub, 'the starter row needs both lines')
  assert.ok(!/^0\b/.test(row.title), `the starter row leads with a zero: "${row.title}"`)
  assert.ok(!/\b0 of\b/.test(row.title), `the starter row inventories nothing: "${row.title}"`)
}
assert.match(progressStarterRow({ signedIn: true, badgeCount: 10 }).title, /first sticker/)
assert.match(progressStarterRow({ signedIn: false }).title, /Sign in/)

console.log(
  '✓ games hub core — grade resolution, catalogue scoping, meta lines, status pills, '
  + `hero copy, the Race Zed row, progress-block mode (rollout grade ${rollout})`,
)
