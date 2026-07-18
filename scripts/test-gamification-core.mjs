/**
 * Node test for the pure gamification core — in particular that
 * computeExamCompletion is idempotent on attemptId, so the transactional
 * wrapper can never double-award XP / streak / examsCompleted.
 *
 * Run: node scripts/test-gamification-core.mjs
 */

import assert from 'node:assert'
import {
  levelFromXp,
  computeStreakAfter,
  xpForAttempt,
  defaultStats,
  computeExamCompletion,
} from '../src/utils/gamificationCore.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('gamification-core')

// ── levelFromXp sanity ────────────────────────────────────────────────────
ok('level 1 at 0 xp', levelFromXp(0).level === 1)
ok('level 2 at 100 xp', levelFromXp(100).level === 2)
ok('clamps negative xp', levelFromXp(-50).level === 1)

// ── streak maths ──────────────────────────────────────────────────────────
ok('first activity → streak 1', computeStreakAfter(0, null, '2026-07-18') === 1)
ok('same day → unchanged', computeStreakAfter(5, '2026-07-18', '2026-07-18') === 5)
ok('yesterday → +1', computeStreakAfter(5, '2026-07-17', '2026-07-18') === 6)
ok('gap → reset to 1', computeStreakAfter(5, '2026-07-10', '2026-07-18') === 1)

// ── xp is deterministic ───────────────────────────────────────────────────
ok('xp deterministic', xpForAttempt({ percentage: 95, rank: 1, streakAfter: 7, personalBest: true }) ===
  xpForAttempt({ percentage: 95, rank: 1, streakAfter: 7, personalBest: true }))

// ── computeExamCompletion: first record awards, second dedups ─────────────
const attempt = { id: 'attempt-1', percentage: 80, subject: 'Mathematics', attemptDate: '2026-07-18' }

const first = computeExamCompletion(defaultStats(), { attempt, rank: 2, todayKey: '2026-07-18', nowMs: 1000 })
ok('first completion is not deduped', first.deduped === false)
ok('first completion awards xp', first.envelope.xpEarned > 0)
ok('examsCompleted goes 0 → 1', first.next.examsCompleted === 1)
ok('subject attempts goes 0 → 1', first.next.subjectBests.Mathematics.attempts === 1)

// Feed the produced doc back in (simulating the committed transaction state)
// and replay the SAME attempt — this is the concurrent-duplicate scenario.
const replay = computeExamCompletion(first.next, { attempt, rank: 2, todayKey: '2026-07-18', nowMs: 2000 })
ok('replaying the same attempt is deduped', replay.deduped === true)
ok('deduped replay does NOT increment examsCompleted', replay.stats.examsCompleted === 1)
ok('deduped replay does NOT change xp', replay.stats.xp === first.next.xp)

// A DIFFERENT attempt on top of the first must still award (and stack counts).
const second = computeExamCompletion(first.next, {
  attempt: { id: 'attempt-2', percentage: 90, subject: 'Mathematics', attemptDate: '2026-07-18' },
  rank: 1, todayKey: '2026-07-18', nowMs: 3000,
})
ok('a new attempt is not deduped', second.deduped === false)
ok('examsCompleted goes 1 → 2', second.next.examsCompleted === 2)
ok('xp accumulates across distinct attempts', second.next.xp > first.next.xp)

// The 30-entry processedAttempts window is bounded (no unbounded growth).
let stats = defaultStats()
for (let i = 0; i < 40; i++) {
  const r = computeExamCompletion(stats, {
    attempt: { id: `a-${i}`, percentage: 70, subject: 'Science', attemptDate: '2026-07-18' },
    rank: null, todayKey: '2026-07-18', nowMs: 1000 + i,
  })
  stats = r.next
}
ok('processedAttempts stays bounded at 30', stats.processedAttempts.length === 30)
ok('examsCompleted counted all 40 distinct attempts', stats.examsCompleted === 40)

console.log(`\ngamification-core: ${passed} assertions passed`)
