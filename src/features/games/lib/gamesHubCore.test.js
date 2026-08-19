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
  dailyHeroCopy,
  gameMetaLine,
  gameStatusPill,
  isRecentlyAdded,
  resolveLearnerGrade,
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

/* ── Copy is written for an 11-year-old ────────────────────────────── */

// "same questions, server keeps score" is engineering reassurance written
// for an adult reviewer. Fairness is the promise; the server is how it is
// kept, and it belongs in no string a child reads.
const everyString = [
  ...Object.values(dailyHeroCopy({ hasQuiz: true, streakDays: 1 })),
  ...Object.values(dailyHeroCopy({ hasQuiz: false })),
  gameStatusPill({ best: 10 }).label,
  gameStatusPill({}).label,
].filter((v) => typeof v === 'string')
for (const line of everyString) {
  assert.ok(
    !/\b(server|query|firestore|api|scoped|validated)\b/i.test(line),
    `machine vocabulary reached a learner-facing string: "${line}"`,
  )
}

console.log(`✓ games hub core — grade resolution, meta lines, status pills, hero copy (rollout grade ${rollout})`)
