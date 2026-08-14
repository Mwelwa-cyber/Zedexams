/**
 * Tests for the Sentence Scramble game core
 * (src/features/games/lib/sentenceScrambleCore.js) and the seed content.
 *
 * Run: node scripts/test-sentence-scramble.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  isCorrectOrder,
  normalizeItems,
  scrambleTokens,
  tokenizeAnswer,
  validateScrambleContent,
} from '../src/features/games/lib/sentenceScrambleCore.js'
import { GAMES_SEED } from '../src/data/gamesSeed.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

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

/* ── tokenizeAnswer ──────────────────────────────────────────── */

assert(tokenizeAnswer('The goat eats grass.').join('/') === 'The/goat/eats/grass.', 'sentence splits on whitespace')
assert(tokenizeAnswer('  The   sun  is hot ').length === 4, 'extra whitespace is collapsed')
assert(
  tokenizeAnswer('Evaporation|Condensation|Rainfall|Collection').join('/') === 'Evaporation/Condensation/Rainfall/Collection',
  'pipe answers split into steps',
)
assert(tokenizeAnswer('Plough the field|Plant the seeds').length === 2, 'steps keep internal spaces')
assert(tokenizeAnswer(' A | B ').join('/') === 'A/B', 'steps are trimmed')
assert(tokenizeAnswer('').length === 0, 'empty answer yields no tokens')
assert(tokenizeAnswer(null).length === 0, 'null answer yields no tokens')

/* ── normalizeItems ──────────────────────────────────────────── */

const items = normalizeItems([
  { question: ' clue ', answer: ' The sun is hot ' },
  { question: '', answer: 'OneWord' },       // 1 token → dropped
  { question: '', answer: '' },
  null,
])
assert(items.length === 1, 'normalizeItems drops <2-token and blank items')
assert(items[0].question === 'clue' && items[0].tokens.length === 4, 'normalizeItems trims and tokenizes')

/* ── scrambleTokens / isCorrectOrder ─────────────────────────── */

const rand = mulberry32(7)
const SCRAMBLE_CASES = [
  ['The', 'goat', 'eats', 'green', 'grass.'],                       // typical sentence
  ['A', 'B'],                                                       // shortest playable
  ['the', 'dog', 'bit', 'the', 'man'],                              // duplicate word
  ['Plough the field', 'Plant the seeds', 'Weed', 'Harvest'],       // steps with spaces
  ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'], // max tiles
]
for (let i = 0; i < 200; i++) {
  const tokens = SCRAMBLE_CASES[i % SCRAMBLE_CASES.length]
  const out = scrambleTokens(tokens, rand)
  assert(out.length === tokens.length, `scramble #${i}: keeps every tile`)
  assert([...out].sort().join('') === [...tokens].sort().join(''), `scramble #${i}: same multiset`)
  assert(out.some((w, k) => w !== tokens[k]), `scramble #${i}: differs from the answer`)
  assert(!isCorrectOrder(out, tokens), `scramble #${i}: not already solved`)
}
assert(isCorrectOrder(['A', 'B'], ['A', 'B']), 'isCorrectOrder accepts the right order')
assert(!isCorrectOrder(['B', 'A'], ['A', 'B']), 'isCorrectOrder rejects the wrong order')
assert(!isCorrectOrder(['A'], ['A', 'B']), 'isCorrectOrder rejects incomplete placements')
// Degenerate case: identical tiles can never differ — must still terminate.
assert(scrambleTokens(['go', 'go'], rand).length === 2, 'identical tiles terminate')

/* ── validateScrambleContent ─────────────────────────────────── */

assert(!validateScrambleContent([]).ok, 'empty content is rejected')
assert(!validateScrambleContent([
  { question: '', answer: 'a b' },
  { question: '', answer: 'c d' },
]).ok, 'fewer than 4 items is rejected')
assert(!validateScrambleContent([
  { question: '', answer: 'one two three four five six seven eight nine ten eleven' },
  { question: '', answer: 'a b' },
  { question: '', answer: 'c d' },
  { question: '', answer: 'e f' },
]).ok, 'items longer than 10 tiles are rejected')

/* ── seed content: every scramble game must be playable ──────── */

const scrambleSeeds = GAMES_SEED.filter((g) => g.type === 'sentence_scramble')
assert(scrambleSeeds.length >= 3, 'at least 3 sentence_scramble games in the seed')
for (const game of scrambleSeeds) {
  const result = validateScrambleContent(game.questions)
  assert(result.ok, `${game.id}: content validates (${result.reason || ''})`)
  assert(result.items.length >= 8, `${game.id}: has at least 8 items`)
  for (const item of result.items) {
    assert(item.tokens.length >= 3 && item.tokens.length <= 10, `${game.id}: "${item.answer}" fits 3-10 tiles`)
  }
  assert(game.subject && game.grade && game.points, `${game.id}: has subject/grade/points`)
}

console.log(`sentence-scramble core + seeds: ${passed} assertions passed ✓`)
