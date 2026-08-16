/**
 * Tests for the Word Builder game core (src/features/games/lib/wordBuilderCore.js)
 * — the prototype-v3 60-second spelling sprint that replaced the
 * decoy-tile engine in learner redesign step 4.
 *
 * Run: node scripts/test-word-builder.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  FALLBACK_WORDS,
  ROUND_SECONDS,
  guessFrom,
  pickListenMode,
  playableWords,
  roundResult,
  solveGain,
  starsForWordScore,
  tilesFor,
  wordQueue,
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

/* ── Content normalisation ─────────────────────────────────────── */
{
  const words = playableWords([
    { question: '🦁 King of the jungle.', answer: 'lion' },
    { question: 'No answer here', answer: '' },
    { question: 'Two words', answer: 'ice cream' },
    { question: 'Hyphenated', answer: 'well-known' },
    { question: 'Single letter', answer: 'a' },
    { question: '', answer: 'ZEBRA' },
  ])
  assert(words.length === 2, 'only letter-only words of 2+ letters are playable')
  assert(words[0].word === 'LION' && words[0].clue === '🦁 King of the jungle.', 'words uppercase, clues ride along')
  assert(words[1].word === 'ZEBRA' && words[1].clue === '', 'a clueless word is still playable (listen/spell)')
}
{
  const rng = mulberry32(1)
  const queue = wordQueue([{ question: 'c', answer: 'CAT' }, { question: 'd', answer: 'DOG' }], rng)
  assert(queue.length === 2 && queue.every((it) => ['CAT', 'DOG'].includes(it.word)), 'queue holds the game words')
  const fallback = wordQueue([], mulberry32(2))
  assert(fallback.length === FALLBACK_WORDS.length, 'no usable words → the prototype fallback list')
  assert(FALLBACK_WORDS.every((it) => /^[A-Z]+$/.test(it.word) && it.clue), 'fallback words are all letters with clues')
}

/* ── Tiles ─────────────────────────────────────────────────────── */
{
  const tiles = tilesFor('GIRAFFE', mulberry32(3))
  assert(tiles.length === 7, 'one tile per letter, no decoys')
  const sorted = tiles.map((t) => t.letter).sort().join('')
  assert(sorted === 'AEFFGIR', 'tiles are exactly the word letters')
  assert(tiles.every((t) => t.used === false), 'tiles start unused')
  // Shuffle actually shuffles for some seed (not a fixed identity).
  let moved = false
  for (let seed = 0; seed < 10 && !moved; seed++) {
    const t = tilesFor('GIRAFFE', mulberry32(seed))
    if (t.map((x) => x.letter).join('') !== 'GIRAFFE') moved = true
  }
  assert(moved, 'the tile order is shuffled')
}
{
  const tiles = [{ letter: 'C' }, { letter: 'A' }, { letter: 'T' }]
  assert(guessFrom([0, 1, 2], tiles) === 'CAT', 'guess reads placed tiles in order')
  assert(guessFrom([2, 1, 0], tiles) === 'TAC', 'order matters')
  assert(guessFrom([], tiles) === '', 'nothing placed → empty guess')
}

/* ── Scoring ───────────────────────────────────────────────────── */
assert(solveGain(1) === 20 && solveGain(4) === 80, 'a solve pays 20 × combo')
assert(solveGain(0) === 20, 'combo floors at ×1')
assert(starsForWordScore(140) === 3 && starsForWordScore(200) === 3, '140+ earns three stars')
assert(starsForWordScore(60) === 2 && starsForWordScore(20) === 1, 'word-game star thresholds match the prototype')
assert(ROUND_SECONDS === 60, 'the round is the prototype 60 seconds')

/* ── Listen mode ───────────────────────────────────────────────── */
{
  assert(pickListenMode(false, () => 0) === false, 'no TTS → never listen mode')
  assert(pickListenMode(true, () => 0.2) === true && pickListenMode(true, () => 0.8) === false, 'with TTS it is the prototype coin flip')
}

/* ── useGameFinish result mapping ──────────────────────────────── */
{
  const game = { id: 'english_word_builder_g3' }
  const result = roundResult({ game, score: 160, solved: 5, misses: 3, peakCombo: 4 })
  assert(result.game === game, 'the game doc rides through untouched')
  assert(result.score === 160 && result.correct === 5 && result.wrong === 3, 'solved/misses map to correct/wrong')
  assert(result.accuracy === 63, 'accuracy is solves over attempts, rounded')
  assert(result.bestStreak === 4 && result.timeSpent === 60, 'peak combo and round length carry over')
  const idle = roundResult({ game, score: 0, solved: 0, misses: 0, peakCombo: 1 })
  assert(idle.accuracy === 0, 'an idle round is 0% accuracy, not NaN')
}

console.log(`test-word-builder: ${passed} assertions passed`)
