/**
 * Node test for the /games hub's pure decisions.
 * Run: node src/features/games/lib/gamesHubCore.test.js
 *
 * The rule these exist to keep: a learner is never shown another grade's
 * content, and is never told a grade they did not state. Both halves
 * failed silently on the live hub — the daily hero read its grade off
 * whatever game the rotation picked while the challenge card read it off
 * the profile, so one screen said "GRADE 3" and "Grade 7" for the same
 * child, and neither looked broken.
 */

import assert from 'node:assert'
import {
  challengeMatchesGrade,
  gameMetaLine,
  gameStatusPill,
  pickGameForGrade,
  resolveLearnerGrade,
} from './gamesHubCore.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('gamesHubCore')

// ── resolveLearnerGrade ────────────────────────────────────────────────
ok('a stated grade resolves', resolveLearnerGrade({ grade: 7 }) === 7)
ok('a numeric string resolves', resolveLearnerGrade({ grade: '4' }) === 4)
// null is a REAL state: /games is public, so a visitor genuinely has none.
ok('no profile → null, never a default', resolveLearnerGrade(undefined) === null)
ok('no grade field → null', resolveLearnerGrade({}) === null)
ok('a junk grade → null', resolveLearnerGrade({ grade: 'seven' }) === null)
ok('zero is not a grade', resolveLearnerGrade({ grade: 0 }) === null)

// ── pickGameForGrade ───────────────────────────────────────────────────
// The exact catalogue that produced the live bug: a Grade 6 MATHEMATICS
// memory pack and a Grade 7 ENGLISH one, both type `memory_match`.
const POOL = [
  { id: 'math_memory_g6', type: 'memory_match', grade: 6, subject: 'mathematics' },
  { id: 'english_meaning_match_g7', type: 'memory_match', grade: 7, subject: 'english' },
  { id: 'word_builder_g4', type: 'word_builder', grade: 4, subject: 'english' },
]

ok('picks the learner\'s own grade',
  pickGameForGrade(POOL, 'memory_match', 7).id === 'english_meaning_match_g7')
ok('picks a different grade for a different learner',
  pickGameForGrade(POOL, 'memory_match', 6).id === 'math_memory_g6')

// THE regression. The old rule ended `|| ofType[0]`, so a Grade 4 learner
// was handed math_memory_g6 — a Grade 6 Mathematics pack — under the
// "Meaning Match" name. A missing card is honest; a card from the wrong
// grade is a wrong answer delivered confidently.
ok('returns null rather than another grade\'s game',
  pickGameForGrade(POOL, 'memory_match', 4) === null)
ok('an unknown mechanic is null, not the first thing in the pool',
  pickGameForGrade(POOL, 'no_such_type', 7) === null)

// Signed out: there is no grade to be wrong about, so the hub still shows
// a catalogue rather than an empty screen.
ok('a null grade is unscoped, so the public hub still lists games',
  pickGameForGrade(POOL, 'memory_match', null).id === 'math_memory_g6')
ok('an empty or missing pool is null, never a throw',
  pickGameForGrade([], 'memory_match', 7) === null &&
  pickGameForGrade(undefined, 'memory_match', 7) === null)

// ── challengeMatchesGrade ──────────────────────────────────────────────
ok('a same-grade challenge is shown', challengeMatchesGrade({ grade: 7 }, 7) === true)
// An admin date-override names one game id and knows nothing about who is
// looking, so it is checked rather than trusted.
ok('another grade\'s challenge is refused', challengeMatchesGrade({ grade: 3 }, 7) === false)
ok('no challenge at all is refused', challengeMatchesGrade(null, 7) === false)
ok('a signed-out visitor is not filtered out', challengeMatchesGrade({ grade: 3 }, null) === true)

// ── gameStatusPill ─────────────────────────────────────────────────────
const NOW = 1_760_000_000_000
const DAY = 24 * 60 * 60 * 1000

ok('a played game shows its best SCORE, as a number',
  gameStatusPill({}, 120, { now: NOW }).label === 'Best 120')
ok('...tagged best, so it can be styled apart from Play',
  gameStatusPill({}, 120, { now: NOW }).kind === 'best')
ok('a never-played game invites a play',
  gameStatusPill({}, 0, { now: NOW }).label === 'Play')
ok('a recent game is New', 
  gameStatusPill({ createdAt: NOW - 5 * DAY }, 0, { now: NOW }).label === 'New')
ok('an old game is not New', 
  gameStatusPill({ createdAt: NOW - 90 * DAY }, 0, { now: NOW }).label === 'Play')
// A score outranks novelty: once you have played it, the number is the
// more useful thing to show.
ok('a played New game shows the score, not the badge',
  gameStatusPill({ createdAt: NOW - 5 * DAY }, 42, { now: NOW }).label === 'Best 42')
// A seed doc has no createdAt, and `0 && …` is 0 — which React renders as
// a literal "0" beside the pill.
ok('a seed doc with no createdAt is Play, never a stray 0',
  gameStatusPill({ createdAt: 0 }, 0, { now: NOW }).label === 'Play')
ok('a Firestore Timestamp createdAt is read',
  gameStatusPill({ createdAt: { toMillis: () => NOW - DAY } }, 0, { now: NOW }).label === 'New')

// ── gameMetaLine ───────────────────────────────────────────────────────
ok('subject and topic join with a separator',
  gameMetaLine('English', 'Spelling') === 'English · Spelling')
// No trailing separator when a pack has no CBC topic.
ok('a missing topic leaves no dangling separator',
  gameMetaLine('English', null) === 'English' && gameMetaLine('English', '') === 'English')
ok('a missing subject does not lead with a separator',
  gameMetaLine('', 'Spelling') === 'Spelling')
ok('both missing is empty, not " · "', gameMetaLine(null, undefined) === '')

console.log(`\n─── ${passed} assertions · all passed ───`)
