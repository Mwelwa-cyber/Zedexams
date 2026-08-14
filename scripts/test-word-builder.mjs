/**
 * Tests for the Word Builder game core (src/features/games/lib/wordBuilderCore.js).
 *
 * Run: node scripts/test-word-builder.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  ALPHABET,
  allSlotsFilled,
  buildGuess,
  computeAccuracy,
  computeScore,
  decoyCountFor,
  emptySlotIndex,
  isCorrectGuess,
  isLastWord,
  makeTiles,
  normalizeTarget,
  playableWords,
  pointsForGame,
  stripLeadingEmoji,
} from '../src/features/games/lib/wordBuilderCore.js'

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

/* ── playableWords: only items with an answer are playable ───── */

assert(playableWords(null).length === 0, 'null questions → no words')
assert(playableWords(undefined).length === 0, 'undefined questions → no words')
assert(playableWords([]).length === 0, 'empty questions → no words')
{
  const words = playableWords([
    { question: 'Clue', answer: 'CAT' },
    { question: 'No answer', answer: '' },
    { question: 'Missing answer' },
    { question: '', answer: 'dog' },
  ])
  assert(words.length === 2, 'items without an answer are dropped')
  assert(words[0].answer === 'CAT' && words[1].answer === 'dog', 'kept items preserve order')
}

/* ── pointsForGame: defaults and coercion ────────────────────── */

assert(pointsForGame({ points: 25 }) === 25, 'numeric points pass through')
assert(pointsForGame({ points: '15' }) === 15, 'string points are coerced')
assert(pointsForGame({}) === 10, 'missing points default to 10')
assert(pointsForGame({ points: 0 }) === 10, 'zero points default to 10')
assert(pointsForGame({ points: 'lots' }) === 10, 'non-numeric points default to 10')
assert(pointsForGame(null) === 10, 'null game defaults to 10')

/* ── normalizeTarget ─────────────────────────────────────────── */

assert(normalizeTarget('lion') === 'LION', 'lowercase answers are uppercased')
assert(normalizeTarget('Zebra') === 'ZEBRA', 'mixed case is uppercased')
assert(normalizeTarget('') === '', 'empty answer → empty target')
assert(normalizeTarget(null) === '', 'null answer → empty target')
assert(normalizeTarget(undefined) === '', 'undefined answer → empty target')

/* ── decoyCountFor: short words get decoys ───────────────────── */

assert(decoyCountFor(3) === 2, '3-letter word gets 2 decoys')
assert(decoyCountFor(4) === 2, '4-letter word gets 2 decoys')
assert(decoyCountFor(5) === 1, '5-letter word gets 1 decoy')
assert(decoyCountFor(6) === 1, '6-letter word gets 1 decoy')
assert(decoyCountFor(7) === 0, '7-letter word gets no decoys')
assert(decoyCountFor(12) === 0, 'long words get no decoys')

/* ── makeTiles: letter-pool integrity ────────────────────────── */

function countLetters(letters) {
  const counts = {}
  for (const l of letters) counts[l] = (counts[l] || 0) + 1
  return counts
}

function validateTiles(word, tiles, label) {
  const expectedLen = word.length + decoyCountFor(word.length)
  assert(tiles.length === expectedLen, `${label}: ${expectedLen} tiles (got ${tiles.length})`)
  assert(tiles.every((t) => t.placed === false), `${label}: all tiles start unplaced`)
  assert(tiles.every((t) => ALPHABET.includes(t.letter) || word.includes(t.letter)),
    `${label}: every tile letter is from the word or the alphabet`)

  // The word's letters (as a multiset) must all be present.
  const tileCounts = countLetters(tiles.map((t) => t.letter))
  const wordCounts = countLetters(Array.from(word))
  for (const [letter, count] of Object.entries(wordCounts)) {
    assert((tileCounts[letter] || 0) >= count,
      `${label}: contains ${count}× "${letter}" from the word`)
  }

  // Decoys never duplicate a word letter, and never each other.
  const decoys = tiles.map((t) => t.letter).filter((l) => !word.includes(l))
  assert(decoys.length === decoyCountFor(word.length),
    `${label}: exactly ${decoyCountFor(word.length)} decoys (got ${decoys.length})`)
  assert(new Set(decoys).size === decoys.length, `${label}: decoys are distinct`)
}

const SAMPLE_WORDS = ['CAT', 'LION', 'ZEBRA', 'HIPPO', 'MONKEY', 'GIRAFFE', 'CROCODILE']
for (const word of SAMPLE_WORDS) {
  const rand = mulberry32(7)
  for (let i = 0; i < 50; i++) {
    validateTiles(word, makeTiles(word, rand), `${word} #${i}`)
  }
  // And with the default Math.random for good measure.
  for (let i = 0; i < 20; i++) {
    validateTiles(word, makeTiles(word), `${word} (Math.random) #${i}`)
  }
}

// Repeated letters in the word survive as repeated tiles.
{
  const tiles = makeTiles('HIPPO', mulberry32(3))
  const counts = countLetters(tiles.map((t) => t.letter))
  assert(counts.P === 2, 'HIPPO keeps both P tiles')
}

// Degenerate RNGs must still produce a valid pool (never hang, never NaN-index).
validateTiles('CAT', makeTiles('CAT', () => 0), 'CAT (rng always 0)')
validateTiles('ZEBRA', makeTiles('ZEBRA', () => 0.9999999), 'ZEBRA (rng near 1)')

// Same seed → same pool (determinism for tests).
{
  const a = makeTiles('MONKEY', mulberry32(99)).map((t) => t.letter).join('')
  const b = makeTiles('MONKEY', mulberry32(99)).map((t) => t.letter).join('')
  assert(a === b, 'seeded rng makes makeTiles deterministic')
}

/* ── slots: fill state + guess assembly ──────────────────────── */

assert(emptySlotIndex([null, null, null]) === 0, 'first empty slot of a fresh word is 0')
assert(emptySlotIndex([2, null, null]) === 1, 'fills left to right')
assert(emptySlotIndex([2, 0, 1]) === -1, 'full word has no empty slot')

assert(allSlotsFilled([2, 0, 1]) === true, 'full slots detected')
assert(allSlotsFilled([2, null, 1]) === false, 'gap detected')
assert(allSlotsFilled([null, null]) === false, 'fresh word is not filled')

{
  const tiles = [
    { letter: 'T', placed: true },
    { letter: 'A', placed: true },
    { letter: 'C', placed: true },
    { letter: 'X', placed: false },
  ]
  assert(buildGuess([2, 1, 0], tiles) === 'CAT', 'guess reads slot order, not tile order')
  assert(buildGuess([0, 1, 2], tiles) === 'TAC', 'a wrong arrangement reads back verbatim')
}

assert(isCorrectGuess('CAT', 'CAT') === true, 'exact match is correct')
assert(isCorrectGuess('TAC', 'CAT') === false, 'wrong order is incorrect')
assert(isCorrectGuess('cat', 'CAT') === false, 'comparison is case-sensitive (target pre-uppercased)')

// Round-trip: placing the target's letters in order always spells the target.
for (const word of SAMPLE_WORDS) {
  const tiles = makeTiles(word, mulberry32(11))
  const used = new Set()
  const slots = Array.from(word).map((letter) => {
    const idx = tiles.findIndex((t, i) => t.letter === letter && !used.has(i))
    used.add(idx)
    return idx
  })
  assert(slots.every((i) => i >= 0), `${word}: every target letter has a tile`)
  assert(isCorrectGuess(buildGuess(slots, tiles), word), `${word}: correct placement solves the word`)
}

/* ── round progression ───────────────────────────────────────── */

assert(isLastWord(0, 1) === true, 'single-word round finishes after word 1')
assert(isLastWord(0, 5) === false, 'word 1 of 5 continues')
assert(isLastWord(3, 5) === false, 'word 4 of 5 continues')
assert(isLastWord(4, 5) === true, 'word 5 of 5 finishes')
assert(isLastWord(0, 0) === true, 'empty round finishes immediately')

/* ── scoring ─────────────────────────────────────────────────── */

assert(computeAccuracy(5, 5) === 100, 'all solved → 100%')
assert(computeAccuracy(3, 4) === 75, '3 of 4 → 75%')
assert(computeAccuracy(1, 3) === 33, 'rounds to whole percent (down)')
assert(computeAccuracy(2, 3) === 67, 'rounds to whole percent (up)')
assert(computeAccuracy(0, 5) === 0, 'none solved → 0%')
assert(computeAccuracy(0, 0) === 0, 'zero words never divides by zero')

assert(computeScore(3, 10, 0) === 60, 'perfect round doubles the base points')
assert(computeScore(3, 10, 2) === 56, 'each mistake trims the bonus by 2')
assert(computeScore(3, 10, 15) === 30, 'bonus bottoms out at zero, base is untouched')
assert(computeScore(1, 10, 40) === 10, 'heavy mistakes never go below the base')
assert(computeScore(0, 10, 3) === 0, 'nothing solved scores zero')
assert(computeScore(4, 25, 1) === 198, 'custom points feed both base and bonus')

/* ── stripLeadingEmoji ───────────────────────────────────────── */

assert(stripLeadingEmoji('🦁 King of the jungle.') === 'King of the jungle.', 'leading emoji stripped')
assert(stripLeadingEmoji('🦁🐘 Big animals') === 'Big animals', 'multiple leading emoji stripped')
assert(stripLeadingEmoji('  🐍  Slithers') === 'Slithers', 'surrounding whitespace trimmed')
assert(stripLeadingEmoji('King of the jungle.') === 'King of the jungle.', 'plain text untouched')
assert(stripLeadingEmoji('Big 🐘 animal') === 'Big 🐘 animal', 'internal emoji kept')
assert(stripLeadingEmoji('') === '', 'empty clue → empty string')
assert(stripLeadingEmoji(null) === '', 'null clue → empty string')
assert(stripLeadingEmoji('🦁') === '', 'emoji-only clue → empty string')

console.log(`word-builder core: ${passed} assertions passed ✓`)
