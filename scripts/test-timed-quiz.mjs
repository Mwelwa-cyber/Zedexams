/**
 * Tests for the Timed Quiz game core (src/features/games/lib/timedQuizCore.js).
 *
 * Run: node scripts/test-timed-quiz.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  EMPTY_QUESTION,
  accuracyPct,
  advanceDeck,
  applyPenalty,
  avoidImmediateRepeat,
  correctGain,
  correctIndexFor,
  DEFAULT_ROUND_QUESTIONS,
  optionDisplayOrder,
  optionLetter,
  questionAt,
  ratingStars,
  resolveGameConfig,
  resolveRoundLength,
  roundProgressPct,
  shouldCelebrate,
  streakBonus,
  timeSpentSeconds,
  wrongPenalty,
} from '../src/features/games/lib/timedQuizCore.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

/* ── resolveGameConfig: per-game tunables with defaults ───────── */

assert(resolveGameConfig({ points: 15, timer: 90 }).points === 15, 'explicit points win')
assert(resolveGameConfig({ points: 15, timer: 90 }).duration === 90, 'explicit timer wins')
assert(resolveGameConfig({}).points === 10, 'missing points defaults to 10')
assert(resolveGameConfig({}).duration === 60, 'missing timer defaults to 60')
assert(resolveGameConfig({ points: 0, timer: 0 }).points === 10, 'zero points falls back to 10')
assert(resolveGameConfig({ points: 0, timer: 0 }).duration === 60, 'zero timer falls back to 60')
assert(resolveGameConfig({ points: 'abc', timer: 'xyz' }).points === 10, 'non-numeric points falls back')
assert(resolveGameConfig({ points: 'abc', timer: 'xyz' }).duration === 60, 'non-numeric timer falls back')
assert(resolveGameConfig({ points: '20', timer: '45' }).points === 20, 'numeric-string points parse')
assert(resolveGameConfig({ points: '20', timer: '45' }).duration === 45, 'numeric-string timer parses')
assert(resolveGameConfig(undefined).points === 10, 'no game object still yields defaults')

/* ── questionAt: safe deck access ─────────────────────────────── */

const qA = { question: 'A?', options: ['1', '2'], answer: '2' }
const qB = { question: 'B?', options: ['x', 'y'], answer: 'x' }
assert(questionAt([qA, qB], 0) === qA, 'in-range position returns the question')
assert(questionAt([qA, qB], 1) === qB, 'second position returns the second question')
assert(questionAt([qA, qB], 2) === EMPTY_QUESTION, 'past-the-end returns the empty question')
assert(questionAt([], 0) === EMPTY_QUESTION, 'empty deck returns the empty question')
assert(EMPTY_QUESTION.question === '' && Array.isArray(EMPTY_QUESTION.options) && EMPTY_QUESTION.answer === '',
  'empty question has the render-safe shape')

/* ── correctIndexFor: loose (string) answer matching ──────────── */

assert(correctIndexFor({ options: ['cat', 'dog', 'goat'], answer: 'dog' }) === 1, 'plain string match')
assert(correctIndexFor({ options: [7, 8, 9], answer: '8' }) === 1, 'number option matches string answer')
assert(correctIndexFor({ options: ['7', '8', '9'], answer: 9 }) === 2, 'string option matches number answer')
assert(correctIndexFor({ options: ['a', 'b'], answer: 'z' }) === -1, 'no match returns -1')
assert(correctIndexFor({ options: [], answer: 'a' }) === -1, 'empty options returns -1')
assert(correctIndexFor(EMPTY_QUESTION) === -1, 'empty question has no correct index')
assert(correctIndexFor({ options: ['x', 'x'], answer: 'x' }) === 0, 'duplicate options: first wins')

/* ── scoring: streak bonus boundaries + gains ─────────────────── */

assert(streakBonus(0) === 0, 'streak 0 → no bonus')
assert(streakBonus(1) === 0, 'streak 1 → no bonus')
assert(streakBonus(2) === 0, 'streak 2 → no bonus')
assert(streakBonus(3) === 1, 'streak 3 → +1 (first bonus tier)')
assert(streakBonus(5) === 1, 'streak 5 → still +1')
assert(streakBonus(6) === 2, 'streak 6 → +2')
assert(streakBonus(14) === 4, 'streak 14 → +4')
assert(streakBonus(15) === 5, 'streak 15 → +5 (cap reached)')
assert(streakBonus(99) === 5, 'streak 99 → capped at +5')

assert(correctGain(10, 1) === 10, 'first correct: base points only')
assert(correctGain(10, 3) === 11, 'streak 3: base + 1')
assert(correctGain(10, 30) === 15, 'long streak: base + capped 5')
assert(correctGain(25, 6) === 27, 'custom points: 25 + 2')

/* ── scoring: wrong-answer penalty + floor at zero ────────────── */

assert(wrongPenalty(10) === 2, 'points 10 → penalty 2 (quarter)')
assert(wrongPenalty(4) === 2, 'points 4 → floor of 2')
assert(wrongPenalty(1) === 2, 'tiny points still cost at least 2')
assert(wrongPenalty(12) === 3, 'points 12 → penalty 3')
assert(wrongPenalty(40) === 10, 'points 40 → penalty 10')
assert(wrongPenalty(11) === 2, 'points 11 → floor(11/4) = 2')

assert(applyPenalty(10, 2) === 8, 'penalty subtracts from score')
assert(applyPenalty(1, 4) === 0, 'score never goes negative')
assert(applyPenalty(0, 2) === 0, 'zero score stays zero')
assert(applyPenalty(2, 2) === 0, 'exact hit lands on zero')

/* ── deck sequencing: no immediate repeat after reshuffle ─────── */

const p1 = { question: 'one', options: [], answer: '' }
const p2 = { question: 'two', options: [], answer: '' }
const p3 = { question: 'three', options: [], answer: '' }

{
  const rotated = avoidImmediateRepeat([p1, p2, p3], 'one')
  assert(rotated[0] === p2 && rotated[1] === p1 && rotated[2] === p3,
    'repeat at head rotates the first two questions')
}
{
  const deck = [p1, p2, p3]
  assert(avoidImmediateRepeat(deck, 'two') === deck, 'no repeat at head leaves the deck untouched')
  assert(avoidImmediateRepeat(deck, undefined) === deck, 'unknown last question leaves the deck untouched')
}
{
  const single = [p1]
  assert(avoidImmediateRepeat(single, 'one') === single, 'single-question deck cannot rotate')
  const empty = []
  assert(avoidImmediateRepeat(empty, 'one') === empty, 'empty deck is returned unchanged')
}

/* ── deck sequencing: advanceDeck ─────────────────────────────── */

// Mid-deck: cursor bumps, deck untouched, shuffle never called.
{
  const deck = [p1, p2, p3]
  const next = advanceDeck({
    deck, pos: 0, pool: deck,
    shuffle: () => { throw new Error('shuffle must not run mid-deck') },
    seed: 1,
  })
  assert(next.deck === deck, 'mid-deck keeps the same deck reference')
  assert(next.pos === 1, 'mid-deck advances the cursor by one')
}

// End of deck: reshuffles the pool with the given seed, cursor resets.
{
  const pool = [p1, p2, p3]
  let calledWith = null
  const next = advanceDeck({
    deck: [p3, p1, p2], pos: 2, pool,
    shuffle: (arr, seed) => { calledWith = { arr, seed }; return [p3, p1, p2] },
    seed: 77,
  })
  assert(calledWith.arr === pool && calledWith.seed === 77, 'exhausted deck reshuffles the pool with the seed')
  assert(next.pos === 0, 'reshuffle resets the cursor')
  assert(next.deck[0] === p3, 'fresh deck starts as shuffled when there is no repeat')
}

// End of deck where the fresh shuffle would repeat the last question.
{
  const pool = [p1, p2, p3]
  const next = advanceDeck({
    deck: [p3, p1, p2], pos: 2, pool,
    shuffle: () => [p2, p3, p1], // starts with what was just asked ("two")
    seed: 5,
  })
  assert(next.deck[0] === p3 && next.deck[1] === p2 && next.deck[2] === p1,
    'a repeat at the head of the fresh deck is rotated away')
  assert(next.pos === 0, 'rotated reshuffle still resets the cursor')
}

// One-question pool: the repeat is unavoidable and must not loop or throw.
{
  const pool = [p1]
  const next = advanceDeck({ deck: [p1], pos: 0, pool, shuffle: () => [p1], seed: 9 })
  assert(next.deck[0] === p1 && next.pos === 0, 'single-question pool repeats without rotating')
}

/* ── round stats: accuracy, celebration, time, stars ──────────── */

assert(accuracyPct(0, 0) === 0, 'no answers → 0% (no divide-by-zero)')
assert(accuracyPct(3, 1) === 75, '3 of 4 → 75%')
assert(accuracyPct(1, 2) === 33, '1 of 3 rounds to 33%')
assert(accuracyPct(2, 1) === 67, '2 of 3 rounds to 67%')
assert(accuracyPct(5, 0) === 100, 'all correct → 100%')
assert(accuracyPct(0, 4) === 0, 'all wrong → 0%')

assert(shouldCelebrate(50, 0) === true, 'score 50 celebrates regardless of accuracy')
assert(shouldCelebrate(0, 80) === true, '80% accuracy celebrates regardless of score')
assert(shouldCelebrate(49, 79) === false, 'just under both bars does not celebrate')
assert(shouldCelebrate(0, 0) === false, 'nothing achieved, nothing celebrated')

assert(timeSpentSeconds(1000, 31000, 60) === 30, 'elapsed ms rounds to whole seconds')
assert(timeSpentSeconds(1000, 1499, 60) === 0, 'sub-half-second rounds down')
assert(timeSpentSeconds(1000, 1500, 60) === 1, 'half-second rounds up')
assert(timeSpentSeconds(null, 31000, 60) === 60, 'missing start falls back to the full duration')

/* ── the fixed set that replaced the countdown ────────────────── */

// A round is questions, not seconds. `game.timer` is deliberately NOT an
// input here — it survives only as `roundOutcome`'s timeSpent fallback.
const TEN = Array.from({ length: 10 }, (_, i) => ({ question: `q${i}` }))
const THIRTY = Array.from({ length: 30 }, (_, i) => ({ question: `q${i}` }))

assert(DEFAULT_ROUND_QUESTIONS === 10, 'a round defaults to ten questions')
assert(resolveRoundLength({}, THIRTY) === 10, 'a big pool still plays the default set')
assert(resolveRoundLength({}, TEN) === 10, 'a pool of exactly the set size plays all of it')
assert(resolveRoundLength({}, [{ question: 'only' }]) === 1,
  'a short pool caps the round — a set never recycles the deck back over itself')
assert(resolveRoundLength({ roundQuestions: 5 }, THIRTY) === 5, 'a game doc may name its own set size')
assert(resolveRoundLength({ roundQuestions: 50 }, TEN) === 10, 'an authored size is still capped by the pool')
assert(resolveRoundLength({ roundQuestions: 0 }, THIRTY) === 10, 'zero falls back to the default')
assert(resolveRoundLength({ roundQuestions: 'abc' }, THIRTY) === 10, 'nonsense falls back to the default')
assert(resolveRoundLength({ timer: 90 }, THIRTY) === 10, 'the legacy timer field never sets the round length')
assert(resolveRoundLength({}, []) === 10, 'an empty pool falls back rather than yielding a zero-question round')
assert(resolveRoundLength({}, undefined) === 10, 'a missing pool falls back')
assert(resolveRoundLength(undefined, undefined) >= 1, 'a round is never shorter than one question')

assert(roundProgressPct(0, 10) === 0, 'an unanswered round shows an EMPTY bar — it fills, never drains')
assert(roundProgressPct(5, 10) === 50, 'half the set → 50%')
assert(roundProgressPct(10, 10) === 100, 'the whole set → 100%')
assert(roundProgressPct(11, 10) === 100, 'progress past the end clamps to 100%')
assert(roundProgressPct(-1, 10) === 0, 'nonsense progress clamps to 0%')
assert(roundProgressPct(3, 0) === 100, 'a zero-length set never divides by zero')

assert(ratingStars(100) === 5, '100% → 5 stars')
assert(ratingStars(90) === 5, '90% → 5 stars (boundary)')
assert(ratingStars(89) === 4, '89% → 4 stars')
assert(ratingStars(70) === 4, '70% → 4 stars (boundary)')
assert(ratingStars(69) === 3, '69% → 3 stars')
assert(ratingStars(50) === 3, '50% → 3 stars (boundary)')
assert(ratingStars(49) === 2, '49% → 2 stars')
assert(ratingStars(0) === 2, '0% → 2 stars (floor)')

/* ── option letters ───────────────────────────────────────────── */

assert(optionLetter(0) === 'A', 'index 0 → A')
assert(optionLetter(1) === 'B', 'index 1 → B')
assert(optionLetter(3) === 'D', 'index 3 → D')

/* ── a simulated run: scoring composes the way the engine plays ─ */

{
  // 10-point game: correct, correct, correct (streak bonus kicks in), wrong.
  const points = 10
  let score = 0
  let streak = 0
  for (let i = 0; i < 3; i++) {
    streak += 1
    score += correctGain(points, streak)
  }
  assert(score === 31, 'three straight correct at 10pts = 10 + 10 + 11')
  streak = 0
  score = applyPenalty(score, wrongPenalty(points))
  assert(score === 29, 'a wrong answer then costs 2')
  assert(streakBonus(streak + 1) === 0, 'the streak restarts cold after a miss')
}

// ── optionDisplayOrder — the anti-"always tap A" deal ─────────────────
{
  // A permutation: every index exactly once, whatever the seed.
  for (const s of [0, 1, 7, 12345, 2 ** 31]) {
    const order = optionDisplayOrder(4, s)
    assert(order.slice().sort().join(',') === '0,1,2,3', `seed ${s} yields a permutation of 0..3`)
  }
  // Deterministic per seed — a re-render mid-question must not re-deal.
  assert(
    optionDisplayOrder(4, 42).join(',') === optionDisplayOrder(4, 42).join(','),
    'same seed, same order'
  )
  // It deals FAIRLY. The first cut used gamesService's LCG with a
  // `% (i + 1)` draw, whose low bits are near-deterministic across
  // successive states: only 12 of the 24 four-option permutations were
  // reachable and stored option 0 (where the seed banks put the correct
  // answer) still landed on slot A 33% of the time — a smaller copy of
  // the bias the deal exists to remove. Pin the distribution, not just
  // "it moves": every permutation reachable, and the answer's display
  // slot within a few points of the fair 25% over 8000 seeds.
  const perms = new Set()
  const slotCounts = [0, 0, 0, 0]
  const SEEDS = 8000
  for (let s = 0; s < SEEDS; s++) {
    const order = optionDisplayOrder(4, s)
    perms.add(order.join(''))
    slotCounts[order.indexOf(0)] += 1
  }
  assert(perms.size === 24, `all 24 permutations reachable (saw ${perms.size})`)
  for (const [slot, count] of slotCounts.entries()) {
    const pct = (count / SEEDS) * 100
    assert(pct > 20 && pct < 30, `stored option 0 lands on slot ${slot} near 25% (saw ${pct.toFixed(1)}%)`)
  }
  // Degenerate inputs stay safe.
  assert(optionDisplayOrder(0, 9).length === 0, 'zero options → empty order')
  assert(optionDisplayOrder(1, 9).join(',') === '0', 'one option → [0]')
  assert(optionDisplayOrder(-3, 9).length === 0, 'negative count → empty order')
  passed += 1
}

console.log(`timed-quiz core: ${passed} assertions passed ✓`)
