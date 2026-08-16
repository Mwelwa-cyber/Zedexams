/**
 * Pure logic for the `memory_match` engine — the prototype-v3 "Meaning
 * Match" tap-pair game (learner redesign step 4, the third rebuilt
 * mechanic; it replaces the card-flip Memory Match).
 *
 * The mechanic is the prototype's: one 60-second round over boards of
 * up to four pairs — words down the left, their meanings shuffled down
 * the right. Tap a word, tap a meaning: right pays 20 × combo and locks
 * the pair green, wrong shakes both red and resets the combo. Clearing
 * a board deals the next from a recycling shuffled pool.
 *
 * Content comes from the game doc's `questions` array, which for
 * memory_match games was ALREADY pair data ({ question: left side,
 * answer: right side } — fraction↔percent, country↔capital), so every
 * existing game plays unchanged; the prototype's word–meaning list is
 * the fallback. No React, no DOM; draws take an injectable `rng` so
 * scripts/test-meaning-match.mjs can drive it deterministically.
 */

export const ROUND_SECONDS = 60
export const BOARD_PAIRS = 4

/** The prototype's pair list — the fallback when a game doc has none. */
export const FALLBACK_PAIRS = [
  { word: 'postponed', meaning: 'moved to a later time' },
  { word: 'embarrassed', meaning: 'feeling silly in front of others' },
  { word: 'intelligent', meaning: 'clever and quick to understand' },
  { word: 'honorary', meaning: 'given as an honour' },
  { word: 'audience', meaning: 'people watching a show' },
  { word: 'campaign', meaning: 'activities to win support' },
  { word: 'suspended', meaning: 'stopped for a time' },
  { word: 'prefers', meaning: 'likes better' },
  { word: 'favourite', meaning: 'liked the best' },
  { word: 'homage', meaning: 'honour and respect' },
]

function shuffled(list, rng = Math.random) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * The playable pairs of a game doc: both sides non-empty after
 * trimming. Sides stay verbatim — "1/2" and "50%" are as valid as a
 * word and its meaning.
 */
export function playablePairs(questions) {
  return (questions || [])
    .map((q) => ({
      word: String(q?.question || '').trim(),
      meaning: String(q?.answer || '').trim(),
    }))
    .filter((p) => p.word && p.meaning)
}

/** A fresh shuffled pool — the game's own pairs, or the fallback list. */
export function pairPool(questions, rng = Math.random) {
  const pairs = playablePairs(questions)
  return shuffled(pairs.length ? pairs : FALLBACK_PAIRS, rng)
}

/**
 * Deal the next board off the pool: up to four pairs, refilling the
 * pool from the full pair list when it runs short (the prototype's
 * recycle). Returns { board, pool } — the remaining pool rides back.
 */
export function dealBoard(pool, allPairs, rng = Math.random) {
  const size = Math.min(BOARD_PAIRS, allPairs.length) || BOARD_PAIRS
  let next = pool
  if (next.length < size) next = shuffled(allPairs.length ? allPairs : FALLBACK_PAIRS, rng)
  return { board: next.slice(0, size), pool: next.slice(size) }
}

/**
 * The right column's order: board indices shuffled, re-dealt until the
 * column is not the identity order (a board whose meanings sit exactly
 * beside their words plays itself — only possible to avoid with 2+
 * pairs).
 */
export function meaningOrder(boardSize, rng = Math.random) {
  const identity = Array.from({ length: boardSize }, (_, i) => i)
  if (boardSize < 2) return identity
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const order = shuffled(identity, rng)
    if (order.some((v, i) => v !== i)) return order
  }
  // rng pathologically constant — rotate rather than loop forever.
  return identity.map((v) => (v + 1) % boardSize)
}

/** Points for a matched pair — 20 × the current combo multiplier. */
export function matchGain(combo) {
  return 20 * Math.max(1, Math.floor(Number(combo) || 1))
}

/** Stars for a finished round — the prototype's word-game thresholds. */
export function starsForScore(score) {
  const s = Number(score) || 0
  return s >= 140 ? 3 : s >= 60 ? 2 : 1
}

/**
 * Map a finished round onto the shared `useGameFinish` result shape —
 * matched pairs count as correct answers, wrong taps as wrong ones,
 * and the peak combo is the round's best streak.
 */
export function roundResult({ game, score, solved, misses, peakCombo }) {
  const correct = Math.max(0, Math.floor(Number(solved) || 0))
  const wrong = Math.max(0, Math.floor(Number(misses) || 0))
  const attempts = correct + wrong
  return {
    game,
    score: Math.max(0, Math.floor(Number(score) || 0)),
    correct,
    wrong,
    accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
    bestStreak: Math.max(0, Math.floor(Number(peakCombo) || 0)),
    timeSpent: ROUND_SECONDS,
  }
}
