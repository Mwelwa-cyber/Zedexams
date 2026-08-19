/**
 * Tests for the Punctuation Pro game core (src/features/games/lib/punctuationCore.js)
 * — the prototype-v3 tap-the-correctly-punctuated-sentence mechanic
 * (learner redesign step 4), a new `punctuation` game type on the
 * repo's standard MCQ content shape.
 *
 * Run: node scripts/test-punctuation.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  FALLBACK_ITEMS,
  ROUND_ITEMS,
  dealOptions,
  itemQueue,
  pickGain,
  playableItems,
  roundResult,
  starsForScore,
} from '../src/features/games/lib/punctuationCore.js'

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
  const items = playableItems([
    { question: 'Pick the correct sentence.', options: ['We won!', 'we won!'], answer: 'We won!' },
    { question: '', options: ['A.', 'B.', 'C.'], answer: '2' },          // index answer
    { question: '', options: ['Only one'], answer: 'Only one' },          // too few options
    { question: '', options: ['X', 'Y'], answer: 'Z' },                   // answer not present
    { question: '', options: ['Same', 'Same'], answer: 'Same' },          // no real choice
    { question: '', options: ['P', 'Q'], answer: '9' },                   // index out of range
  ])
  assert(items.length === 2, 'only items with 2+ distinct options and a resolvable answer survive')
  assert(items[0].answer === 'We won!' && items[0].prompt === 'Pick the correct sentence.', 'verbatim answers and prompts ride along')
  assert(items[1].answer === 'C.', 'a numeric answer resolves as an index into options')
}
{
  const queue = itemQueue([{ options: ['A!', 'a!'], answer: 'A!' }], mulberry32(1))
  assert(queue.length === 1 && queue[0].answer === 'A!', 'queue holds the game items')
  const fallback = itemQueue([], mulberry32(2))
  assert(fallback.length === FALLBACK_ITEMS.length, 'no usable items → the prototype fallback list')
  assert(
    FALLBACK_ITEMS.every((it) => it.options.includes(it.answer) && new Set(it.options).size >= 2),
    'every fallback item is well-formed',
  )
}

/* ── Option dealing ────────────────────────────────────────────── */
{
  const item = FALLBACK_ITEMS[0]
  const dealt = dealOptions(item, mulberry32(3))
  assert(dealt.slice().sort().join('|') === item.options.slice().sort().join('|'), 'dealing permutes, never edits')
  let moved = false
  for (let seed = 0; seed < 10 && !moved; seed++) {
    if (dealOptions(item, mulberry32(seed)).join('|') !== item.options.join('|')) moved = true
  }
  assert(moved, 'the order is shuffled for some seed')
}

/* ── Scoring ───────────────────────────────────────────────────── */
assert(pickGain(1) === 20 && pickGain(3) === 60, 'a correct pick pays 20 × combo')
assert(pickGain(0) === 20, 'combo floors at ×1')
assert(starsForScore(140) === 3 && starsForScore(60) === 2 && starsForScore(59) === 1, 'star thresholds match the prototype word games')
assert(ROUND_ITEMS === 10, 'a round is ten sentences — the fixed set that replaced the clock')

/* ── useGameFinish result mapping ──────────────────────────────── */
{
  const game = { id: 'english_punctuation_g7' }
  const result = roundResult({ game, score: 180, solved: 7, misses: 3, peakCombo: 4, timeSpent: 96 })
  assert(result.game === game, 'the game doc rides through untouched')
  assert(result.correct === 7 && result.wrong === 3 && result.accuracy === 70, 'picks map to correct/wrong/accuracy')
  assert(result.bestStreak === 4, 'peak combo carries over')
  // MEASURED, never the old fixed 60 — a round takes as long as it takes.
  assert(result.timeSpent === 96, 'the measured elapsed seconds carry over')
  assert(roundResult({ game, score: 0, solved: 0, misses: 0, peakCombo: 1 }).timeSpent === 0,
    'an unmeasured round records 0 seconds rather than inventing a round length')
  const idle = roundResult({ game, score: 0, solved: 0, misses: 0, peakCombo: 1 })
  assert(idle.accuracy === 0, 'an idle round is 0% accuracy, not NaN')
}

console.log(`test-punctuation: ${passed} assertions passed`)
