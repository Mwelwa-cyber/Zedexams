/**
 * `src/components/games/timedQuizRound.js` — the round's scoring state machine.
 *
 * The replay comparison (`test:replay-game-round`) proves the OLD and ENGINE
 * verdicts produce the same document. It cannot prove the arithmetic BETWEEN
 * the verdict and the document is right, because it runs that arithmetic on
 * both sides — two wrong answers agree perfectly. That is what this covers: the
 * numbers a leaderboard is built from, asserted against the behaviour
 * `TimedQuizGame` had before the extraction.
 *
 * Plain-node (`npm run test:game-round`), auto-discovered by run-all-tests.
 */
import assert from 'node:assert/strict'
import {
  EMPTY_ROUND,
  GAME_ROUND_OUTCOME_KEYS,
  applyPick,
  buildGameRoundOutcome,
  roundOutcome,
} from '../src/components/games/timedQuizRound.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('timed-quiz round')

const POINTS = 10
const fold = (verdicts, points = POINTS) => verdicts.reduce(
  (round, correct) => applyPick(round, { correct, points }).round,
  EMPTY_ROUND,
)

// ── The transition ───────────────────────────────────────────────────────────

test('a correct answer adds the points and advances the streak', () => {
  const { round, gained, penalty } = applyPick(EMPTY_ROUND, { correct: true, points: POINTS })
  assert.equal(round.score, 10)
  assert.equal(round.correct, 1)
  assert.equal(round.streak, 1)
  assert.equal(round.bestStreak, 1)
  assert.equal(gained, 10)
  assert.equal(penalty, 0)
})

test('the streak bonus starts at the third consecutive answer, and caps', () => {
  // +1 per three consecutive, capped at +5 — `correctGain` via `streakBonus`.
  assert.equal(fold([true, true]).score, 20, 'no bonus below three')
  assert.equal(fold([true, true, true]).score, 31, 'the third carries +1')
  // Fifteen in a row reaches the +5 cap and stays there.
  const long = fold(Array(18).fill(true))
  assert.equal(long.streak, 18)
  assert.equal(long.bestStreak, 18)
  assert.equal(applyPick(long, { correct: true, points: POINTS }).gained, 15, 'capped at points + 5')
})

test('a wrong answer deducts a quarter of the points value and resets the streak', () => {
  const after = fold([true, true, true])
  const { round, gained, penalty } = applyPick(after, { correct: false, points: POINTS })
  assert.equal(penalty, 2, 'max(2, floor(10/4))')
  assert.equal(gained, 0)
  assert.equal(round.score, after.score - 2)
  assert.equal(round.streak, 0)
  assert.equal(round.wrong, 1)
  assert.equal(round.bestStreak, 3, 'the best streak survives the break — a round\'s best is not its last')
})

test('the score floors at zero rather than going negative', () => {
  const round = fold([false, false, false, false])
  assert.equal(round.score, 0)
  assert.equal(round.wrong, 4)
})

test('the penalty has a floor of 2 even for a low-value game', () => {
  const round = applyPick({ ...EMPTY_ROUND, score: 10 }, { correct: false, points: 4 }).round
  assert.equal(round.score, 8, 'floor(4/4) is 1, but the penalty is never below 2')
})

test('applyPick does not mutate the round it is given', () => {
  // The component holds the round in React state and passes it straight in; a
  // mutating reducer would move the score without a re-render.
  const before = fold([true, true])
  const snapshot = { ...before }
  applyPick(before, { correct: false, points: POINTS })
  assert.deepEqual(before, snapshot)
  assert.deepEqual(EMPTY_ROUND, { score: 0, correct: 0, wrong: 0, streak: 0, bestStreak: 0 })
})

// ── Closing the round ────────────────────────────────────────────────────────

test('an outcome carries exactly the six numbers the four writes read', () => {
  const outcome = roundOutcome({
    round: fold([true, false]), duration: 60, startedAtMs: 1000, nowMs: 31000,
  })
  assert.deepEqual(Object.keys(outcome).sort(), [...GAME_ROUND_OUTCOME_KEYS].sort())
  assert.equal(outcome.accuracy, 50)
  assert.equal(outcome.timeSpent, 30)
})

test('accuracy is 0 when nothing was answered, not NaN', () => {
  const outcome = roundOutcome({ round: EMPTY_ROUND, duration: 45, startedAtMs: 0, nowMs: 45000 })
  assert.equal(outcome.accuracy, 0)
  assert.ok(Number.isFinite(outcome.accuracy))
})

test('an unstarted round records the full duration', () => {
  assert.equal(
    roundOutcome({ round: EMPTY_ROUND, duration: 45, startedAtMs: null, nowMs: 9_999_999 }).timeSpent,
    45,
  )
})

// ── The fold, which is what the harness replays with ─────────────────────────

test('buildGameRoundOutcome folds the same transition the component applies', () => {
  // The two must not drift: if this ever stopped agreeing with a hand-rolled
  // fold of applyPick, the comparison harness would be measuring a
  // re-implementation rather than the shipped arithmetic.
  const verdicts = [true, true, false, true, true, true, false]
  const built = buildGameRoundOutcome({
    points: POINTS,
    duration: 60,
    picks: verdicts.map((correct, i) => ({ correct, i })),
    isCorrect: (pick) => pick.correct,
    startedAtMs: 5000,
    nowMs: 65000,
  })
  assert.deepEqual(built, roundOutcome({
    round: fold(verdicts), duration: 60, startedAtMs: 5000, nowMs: 65000,
  }))
})

test('the verdict is coerced to a boolean, never truthiness leaking into the count', () => {
  const built = buildGameRoundOutcome({
    points: POINTS,
    duration: 60,
    picks: [1, 0, undefined],
    isCorrect: (pick) => pick,
    startedAtMs: 0,
    nowMs: 1000,
  })
  assert.equal(built.correct, 1)
  assert.equal(built.wrong, 2)
})

test('no picks at all is a valid round', () => {
  const built = buildGameRoundOutcome({
    points: POINTS, duration: 60, picks: undefined, isCorrect: () => true, startedAtMs: 0, nowMs: 1000,
  })
  assert.equal(built.score, 0)
  assert.equal(built.correct, 0)
})

console.log(`\ntimed-quiz round: ${passed} passed`)
