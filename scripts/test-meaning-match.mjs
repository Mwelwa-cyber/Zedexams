/**
 * Tests for the Meaning Match game core (src/features/games/lib/meaningMatchCore.js)
 * — the prototype-v3 tap-pair mechanic that replaced the card-flip
 * Memory Match engine in learner redesign step 4 (same `memory_match`
 * type and pair content, new mechanic).
 *
 * Run: node scripts/test-meaning-match.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  BOARD_PAIRS,
  FALLBACK_PAIRS,
  ROUND_BOARDS,
  dealBoard,
  matchGain,
  meaningOrder,
  pairPool,
  playablePairs,
  roundPairs,
  roundResult,
  starsForScore,
} from '../src/features/games/lib/meaningMatchCore.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ── Content normalisation ─────────────────────────────────────── */
{
  const pairs = playablePairs([
    { question: '1/2', answer: '50%' },
    { question: 'Zambia', answer: 'Lusaka' },
    { question: '  ', answer: 'orphan meaning' },
    { question: 'orphan word', answer: '' },
  ])
  assert(pairs.length === 2, 'only pairs with both sides survive')
  assert(pairs[0].word === '1/2' && pairs[0].meaning === '50%', 'sides stay verbatim — maths pairs are valid')
}
{
  const pool = pairPool([{ question: 'a', answer: 'b' }], mulberry32(1))
  assert(pool.length === 1 && pool[0].word === 'a', 'pool holds the game pairs')
  const fallback = pairPool([], mulberry32(2))
  assert(fallback.length === FALLBACK_PAIRS.length, 'no usable pairs → the prototype fallback list')
  assert(FALLBACK_PAIRS.every((p) => p.word && p.meaning), 'fallback pairs are complete')
}

/* ── Board dealing ─────────────────────────────────────────────── */
{
  const all = FALLBACK_PAIRS
  const rng = mulberry32(3)
  let { board, pool } = dealBoard(pairPool([], rng), all, rng)
  assert(board.length === BOARD_PAIRS, 'a full pool deals four pairs')
  assert(pool.length === all.length - BOARD_PAIRS, 'dealt pairs leave the pool')
  // Drain to the recycle: two more deals empty the ten-pair pool.
  ;({ board, pool } = dealBoard(pool, all, rng))
  ;({ board, pool } = dealBoard(pool, all, rng))
  assert(board.length === BOARD_PAIRS, 'a short pool refills from the full list')
  assert(pool.length === all.length - BOARD_PAIRS, 'the refilled pool carries the remainder')
  const words = new Set(board.map((p) => p.word))
  assert(words.size === board.length, 'a board never repeats a word')
}
{
  // A doc with fewer than four pairs deals what it has, no duplicates.
  const two = [{ question: 'x', answer: '1' }, { question: 'y', answer: '2' }]
  const all = playablePairs(two)
  const { board } = dealBoard(pairPool(two, mulberry32(4)), all, mulberry32(4))
  assert(board.length === 2, 'a two-pair game deals two-pair boards')
  assert(new Set(board.map((p) => p.word)).size === 2, 'still no duplicates')
}

/* ── Meaning column order ──────────────────────────────────────── */
{
  for (let seed = 0; seed < 30; seed++) {
    const order = meaningOrder(4, mulberry32(seed))
    assert(order.slice().sort().join() === '0,1,2,3', `seed ${seed}: order is a permutation`)
    assert(order.some((v, i) => v !== i), `seed ${seed}: never the identity — the board must not solve itself`)
  }
  assert(meaningOrder(1, mulberry32(9)).join() === '0', 'a one-pair board is allowed to align')
  const constant = meaningOrder(4, () => 0.999999)
  assert(constant.some((v, i) => v !== i), 'a pathological rng still avoids the identity')
}

/* ── Scoring ───────────────────────────────────────────────────── */
assert(matchGain(1) === 20 && matchGain(5) === 100, 'a match pays 20 × combo')
assert(matchGain(0) === 20, 'combo floors at ×1')
assert(starsForScore(140) === 3 && starsForScore(60) === 2 && starsForScore(0) === 1, 'star thresholds match the prototype word games')
assert(ROUND_BOARDS === 4, 'a round is four boards — the fixed set that replaced the clock')
assert(roundPairs(BOARD_PAIRS) === ROUND_BOARDS * BOARD_PAIRS, 'a full round is boards × pairs')
assert(roundPairs(2) === ROUND_BOARDS * 2, 'a short pair list shrinks the board, not the round')
assert(roundPairs(0) === ROUND_BOARDS * BOARD_PAIRS, 'a nonsense board size falls back to the full board')
assert(roundPairs(99) === ROUND_BOARDS * BOARD_PAIRS, 'a board is never bigger than BOARD_PAIRS')

/* ── useGameFinish result mapping ──────────────────────────────── */
{
  const game = { id: 'math_memory_g6' }
  const result = roundResult({ game, score: 200, solved: 8, misses: 2, peakCombo: 5, timeSpent: 74 })
  assert(result.game === game, 'the game doc rides through untouched')
  assert(result.correct === 8 && result.wrong === 2 && result.accuracy === 80, 'solved/misses map to correct/wrong/accuracy')
  assert(result.bestStreak === 5, 'peak combo carries over')
  // MEASURED, never the old fixed 60 — a round takes as long as it takes.
  assert(result.timeSpent === 74, 'the measured elapsed seconds carry over')
  assert(roundResult({ game, score: 0, solved: 0, misses: 0, peakCombo: 1 }).timeSpent === 0,
    'an unmeasured round records 0 seconds rather than inventing a round length')
  const idle = roundResult({ game, score: 0, solved: 0, misses: 0, peakCombo: 1 })
  assert(idle.accuracy === 0, 'an idle round is 0% accuracy, not NaN')
}

console.log(`test-meaning-match: ${passed} assertions passed`)
