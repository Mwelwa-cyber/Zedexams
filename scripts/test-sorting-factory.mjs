/**
 * Tests for the Sorting Factory game core
 * (src/features/games/lib/sortingFactoryCore.js) and the seed content.
 *
 * Run: node scripts/test-sorting-factory.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  extractBins,
  matchesBin,
  multiplierFor,
  normalizeItems,
  validateSortingContent,
} from '../src/features/games/lib/sortingFactoryCore.js'
import { GAMES_SEED } from '../src/data/gamesSeed.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

/* ── normalizeItems ──────────────────────────────────────────── */

const messy = [
  { question: '  Goat ', answer: ' Living ' },
  { question: '', answer: 'Living' },
  { question: 'Rock', answer: '' },
  { question: null, answer: 'Living' },
  { question: 'Chair', answer: 'Non-living' },
  null,
]
const cleaned = normalizeItems(messy)
assert(cleaned.length === 2, 'normalizeItems drops blank/missing entries')
assert(cleaned[0].question === 'Goat' && cleaned[0].answer === 'Living', 'normalizeItems trims fields')

/* ── extractBins ─────────────────────────────────────────────── */

const bins = extractBins(normalizeItems([
  { question: 'a', answer: 'Living' },
  { question: 'b', answer: 'Non-living' },
  { question: 'c', answer: 'living' },     // case-insensitive duplicate
  { question: 'd', answer: 'Non-living' },
]))
assert(bins.length === 2, 'extractBins dedupes case-insensitively')
assert(bins[0] === 'Living' && bins[1] === 'Non-living', 'extractBins keeps first-appearance order and casing')

/* ── matchesBin ──────────────────────────────────────────────── */

assert(matchesBin({ answer: 'Living' }, 'living'), 'matchesBin is case-insensitive')
assert(matchesBin({ answer: ' Gas ' }, 'gas'), 'matchesBin trims')
assert(!matchesBin({ answer: 'Solid' }, 'Liquid'), 'matchesBin rejects different bins')
assert(!matchesBin(null, 'Solid'), 'matchesBin tolerates null items')

/* ── multiplierFor ───────────────────────────────────────────── */

assert(multiplierFor(0) === 1, 'no streak → ×1')
assert(multiplierFor(3) === 1, 'streak 3 → ×1')
assert(multiplierFor(4) === 2, 'streak 4 → ×2')
assert(multiplierFor(7) === 2, 'streak 7 → ×2')
assert(multiplierFor(8) === 3, 'streak 8 → ×3')
assert(multiplierFor(20) === 3, 'streak 20 → ×3')

/* ── validateSortingContent ──────────────────────────────────── */

assert(!validateSortingContent([]).ok, 'empty content is rejected')
assert(!validateSortingContent([
  { question: 'a', answer: 'X' },
  { question: 'b', answer: 'X' },
  { question: 'c', answer: 'X' },
  { question: 'd', answer: 'X' },
]).ok, 'single bin is rejected')
assert(!validateSortingContent([
  { question: 'a', answer: 'A' },
  { question: 'b', answer: 'B' },
  { question: 'c', answer: 'C' },
  { question: 'd', answer: 'D' },
  { question: 'e', answer: 'E' },
]).ok, 'five bins are rejected')
const good = validateSortingContent([
  { question: 'a', answer: 'A' },
  { question: 'b', answer: 'B' },
  { question: 'c', answer: 'A' },
  { question: 'd', answer: 'B' },
])
assert(good.ok && good.bins.length === 2 && good.items.length === 4, 'valid 2-bin content passes')

/* ── seed content: every sorting game must be playable ───────── */

const sortingSeeds = GAMES_SEED.filter((g) => g.type === 'sorting_factory')
assert(sortingSeeds.length >= 3, 'at least 3 sorting_factory games in the seed')
for (const game of sortingSeeds) {
  const result = validateSortingContent(game.questions)
  assert(result.ok, `${game.id}: content validates (${result.reason || ''})`)
  assert(result.items.length >= 10, `${game.id}: has at least 10 items`)
  for (const item of result.items) {
    assert(result.bins.some((b) => matchesBin(item, b)), `${game.id}: "${item.question}" matches a bin`)
  }
  assert(game.subject && game.grade && game.points, `${game.id}: has subject/grade/points`)
}

console.log(`sorting-factory core + seeds: ${passed} assertions passed ✓`)
