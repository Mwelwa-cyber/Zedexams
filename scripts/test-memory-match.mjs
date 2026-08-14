/**
 * Tests for the Memory Match game core (src/features/games/lib/memoryMatchCore.js).
 *
 * Run: node scripts/test-memory-match.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  buildDeck,
  canFlip,
  doneSummary,
  formatTime,
  gridCols,
  isMatch,
  isWin,
  playablePairs,
  pointsPerMatch,
  scoreWin,
  starsForEfficiency,
} from '../src/features/games/lib/memoryMatchCore.js'

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

/* ── pointsPerMatch: base points with the default ────────────── */

assert(pointsPerMatch({ points: 25 }) === 25, 'explicit points win')
assert(pointsPerMatch({ points: '15' }) === 15, 'string points are coerced')
assert(pointsPerMatch({}) === 10, 'missing points default to 10')
assert(pointsPerMatch({ points: 0 }) === 10, 'zero points fall back to 10')
assert(pointsPerMatch(null) === 10, 'no game doc still yields the default')

/* ── playablePairs: only pairs with an answer ────────────────── */

const rawQuestions = [
  { question: 'Lusaka', answer: 'Capital of Zambia' },
  { question: 'No answer here', answer: '' },
  { question: 'Kwacha', answer: 'Currency' },
  { question: 'Missing answer' },
]
const pairs = playablePairs(rawQuestions)
assert(pairs.length === 2, 'pairs without an answer are dropped')
assert(pairs[0].question === 'Lusaka' && pairs[1].question === 'Kwacha', 'kept pairs preserve order')
assert(playablePairs(undefined).length === 0, 'missing questions yield an empty list')
assert(playablePairs([]).length === 0, 'empty questions yield an empty list')

/* ── buildDeck: two cards per pair, a true permutation ───────── */

function validateDeck(deck, srcPairs, label) {
  assert(deck.length === srcPairs.length * 2, `${label}: ${srcPairs.length * 2} cards`)
  for (let i = 0; i < srcPairs.length; i++) {
    const q = deck.find((c) => c.pairId === i && c.side === 'Q')
    const a = deck.find((c) => c.pairId === i && c.side === 'A')
    assert(q && q.label === srcPairs[i].question, `${label}: pair ${i} has its question card`)
    assert(a && a.label === srcPairs[i].answer, `${label}: pair ${i} has its answer card`)
  }
  const perPair = {}
  for (const c of deck) perPair[c.pairId] = (perPair[c.pairId] || 0) + 1
  for (let i = 0; i < srcPairs.length; i++) {
    assert(perPair[i] === 2, `${label}: pair ${i} appears exactly twice`)
  }
}

const fourPairs = [
  { question: 'Q1', answer: 'A1' },
  { question: 'Q2', answer: 'A2' },
  { question: 'Q3', answer: 'A3' },
  { question: 'Q4', answer: 'A4' },
]
validateDeck(buildDeck(fourPairs, mulberry32(1)), fourPairs, 'seeded deck')
validateDeck(buildDeck(fourPairs), fourPairs, 'Math.random deck')
validateDeck(buildDeck(fourPairs, () => 0), fourPairs, 'degenerate rng deck')
validateDeck(buildDeck([], mulberry32(1)), [], 'empty deck')

const deckA = buildDeck(fourPairs, mulberry32(7))
const deckB = buildDeck(fourPairs, mulberry32(7))
assert(JSON.stringify(deckA) === JSON.stringify(deckB), 'same seed builds the same deck')

const shuffled = buildDeck(fourPairs, mulberry32(3))
const unshuffled = fourPairs.flatMap((p, i) => [
  { pairId: i, label: p.question, side: 'Q' },
  { pairId: i, label: p.answer, side: 'A' },
])
assert(JSON.stringify(shuffled) !== JSON.stringify(unshuffled), 'the deck is actually shuffled')

const before = fourPairs.map((p) => ({ ...p }))
buildDeck(fourPairs, mulberry32(9))
assert(JSON.stringify(fourPairs) === JSON.stringify(before), 'input pairs are not mutated')

/* ── canFlip: the flip guard ─────────────────────────────────── */

assert(canFlip(0, [], []) === true, 'a fresh card can flip')
assert(canFlip(0, [0], []) === false, 'an already face-up card cannot re-flip')
assert(canFlip(1, [], [1, 4]) === false, 'a matched card cannot flip')
assert(canFlip(2, [0, 1], []) === false, 'no third card while two are face-up')
assert(canFlip(2, [0], [4, 5]) === true, 'second flip is allowed with one card up')

/* ── isMatch: same pair, opposite sides ──────────────────────── */

const q0 = { pairId: 0, label: 'Q', side: 'Q' }
const a0 = { pairId: 0, label: 'A', side: 'A' }
const q1 = { pairId: 1, label: 'Q', side: 'Q' }
assert(isMatch(q0, a0) === true, 'question + answer of the same pair match')
assert(isMatch(a0, q0) === true, 'match is symmetric')
assert(isMatch(q0, q1) === false, 'different pairs never match')
assert(isMatch(q0, { ...q0 }) === false, 'two cards on the SAME side never match')

/* ── isWin ───────────────────────────────────────────────────── */

assert(isWin(8, 8) === true, 'all cards matched wins')
assert(isWin(6, 8) === false, 'cards remaining is not a win')

/* ── scoreWin: bonus scales with efficiency ──────────────────── */

const perfect = scoreWin({ totalPairs: 5, movesTaken: 5, points: 10 })
assert(perfect.movesUsed === 5, 'perfect game uses the minimum moves')
assert(perfect.efficiency === 1, 'perfect efficiency is 1')
assert(perfect.bonus === 50, 'perfect bonus is points × pairs')
assert(perfect.finalScore === 100, 'perfect score = base + full bonus')
assert(perfect.accuracy === 100, 'perfect accuracy is 100')

const half = scoreWin({ totalPairs: 5, movesTaken: 10, points: 10 })
assert(half.efficiency === 0.5, 'double the moves halves efficiency')
assert(half.bonus === 25, 'half efficiency halves the bonus')
assert(half.finalScore === 75, 'half-efficiency score = base + half bonus')
assert(half.accuracy === 50, 'accuracy is the rounded efficiency percent')

const clamped = scoreWin({ totalPairs: 5, movesTaken: 3, points: 10 })
assert(clamped.movesUsed === 5, 'movesTaken is clamped up to the perfect minimum')
assert(clamped.finalScore === 100, 'clamped moves cannot exceed the perfect score')

const rounded = scoreWin({ totalPairs: 3, movesTaken: 7, points: 10 })
assert(rounded.bonus === 13, 'bonus is rounded (3/7 × 30 → 13)')
assert(rounded.finalScore === 43, 'rounded bonus lands in the final score')
assert(rounded.accuracy === 43, 'accuracy is rounded to a whole percent')

/* ── doneSummary: the exact numbers the done card shows ──────── */

const doPerfect = doneSummary({ totalPairs: 5, moves: 5, points: 10 })
assert(doPerfect.efficiency === 100, 'done card: perfect efficiency is 100%')
assert(doPerfect.finalScore === 100, 'done card: perfect score')

const doHalf = doneSummary({ totalPairs: 5, moves: 10, points: 10 })
assert(doHalf.efficiency === 50, 'done card: double moves → 50%')
assert(doHalf.finalScore === 75, 'done card: 50% → base + half bonus')

const doClamped = doneSummary({ totalPairs: 5, moves: 0, points: 10 })
assert(doClamped.efficiency === 100, 'done card: moves clamp to the pair count')

// The percent is rounded BEFORE the score is derived from it.
const doRounded = doneSummary({ totalPairs: 3, moves: 7, points: 10 })
assert(doRounded.efficiency === 43, 'done card: 3/7 rounds to 43%')
assert(doRounded.finalScore === Math.round(30 + 0.43 * 30), 'done card: score uses the rounded percent')

/* ── starsForEfficiency: band edges ──────────────────────────── */

assert(starsForEfficiency(100) === 5, '100% → 5 stars')
assert(starsForEfficiency(90) === 5, '90% → 5 stars')
assert(starsForEfficiency(89) === 4, '89% → 4 stars')
assert(starsForEfficiency(75) === 4, '75% → 4 stars')
assert(starsForEfficiency(74) === 3, '74% → 3 stars')
assert(starsForEfficiency(55) === 3, '55% → 3 stars')
assert(starsForEfficiency(54) === 2, '54% → 2 stars')
assert(starsForEfficiency(0) === 2, 'a win never shows fewer than 2 stars')

/* ── gridCols + formatTime ───────────────────────────────────── */

assert(gridCols(8) === 4, '8 cards → 4 columns')
assert(gridCols(12) === 4, '12 cards → 4 columns')
assert(gridCols(16) === 4, '16 cards → 4 columns')
assert(gridCols(17) === 6, '17 cards → 6 columns')
assert(gridCols(24) === 6, '24 cards → 6 columns')

assert(formatTime(0) === '0s', '0 seconds')
assert(formatTime(42) === '42s', 'under a minute stays in seconds')
assert(formatTime(60) === '1:00', 'exactly one minute')
assert(formatTime(65) === '1:05', 'seconds are zero-padded')
assert(formatTime(605) === '10:05', 'ten minutes and beyond')

/* ── full round simulation: flip guard → match → win → score ── */

function playPerfectRound(srcPairs, seed) {
  const deck = buildDeck(srcPairs, mulberry32(seed))
  let flipped = []
  let matched = []
  let moves = 0
  for (let pairId = 0; pairId < srcPairs.length; pairId++) {
    const a = deck.findIndex((c) => c.pairId === pairId && c.side === 'Q')
    const b = deck.findIndex((c) => c.pairId === pairId && c.side === 'A')
    assert(canFlip(a, flipped, matched), `sim: card ${a} is flippable`)
    flipped = [...flipped, a]
    assert(canFlip(b, flipped, matched), `sim: card ${b} is flippable`)
    flipped = [...flipped, b]
    moves++
    assert(isMatch(deck[a], deck[b]), `sim: pair ${pairId} matches`)
    matched = [...matched, a, b]
    flipped = []
  }
  assert(isWin(matched.length, deck.length), 'sim: matching every pair wins')
  return moves
}

const simMoves = playPerfectRound(fourPairs, 11)
const simScore = scoreWin({ totalPairs: fourPairs.length, movesTaken: simMoves, points: 10 })
assert(simScore.finalScore === 80, 'sim: perfect play earns base + full bonus (4 × 10 × 2)')
assert(simScore.accuracy === 100, 'sim: perfect play is 100% accurate')

// A mismatch flip: two face-up cards from different pairs never match and
// the guard refuses a third flip until they are put back down.
const mmDeck = buildDeck(fourPairs, mulberry32(2))
const mmA = mmDeck.findIndex((c) => c.pairId === 0 && c.side === 'Q')
const mmB = mmDeck.findIndex((c) => c.pairId === 1 && c.side === 'A')
assert(!isMatch(mmDeck[mmA], mmDeck[mmB]), 'sim: cross-pair flip is a mismatch')
assert(canFlip(2 === mmA || 2 === mmB ? 3 : 2, [mmA, mmB], []) === false, 'sim: board locks while two are up')

console.log(`memory-match core: ${passed} assertions passed ✓`)
