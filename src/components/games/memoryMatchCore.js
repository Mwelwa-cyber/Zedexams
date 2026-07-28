/**
 * Pure logic for the `memory_match` game engine.
 *
 * Plain .js module (no React, no DOM) so it can be unit-tested from plain
 * Node scripts — same pattern as numberTargetCore.js / sortingFactoryCore.js.
 * The React engine in MemoryMatchGame.jsx consumes these helpers.
 *
 * Content shape: `game.questions` is an array of { question, answer } pairs.
 * Each pair becomes two cards — { pairId, label, side: 'Q' | 'A' } — and the
 * deck is the shuffled union of both sides.
 */

/** Base points per match: `game.points`, defaulting to 10. */
export function pointsPerMatch(game) {
  return Number(game?.points) || 10
}

/** Only pairs with an answer can be played; the rest are dropped. */
export function playablePairs(questions) {
  return (questions || []).filter((p) => p.answer)
}

/**
 * Build the shuffled deck for a set of pairs: two cards per pair (question
 * side + answer side). `rng` must return a float in [0, 1) and is injectable
 * (defaulting to Math.random) so tests can be deterministic.
 */
export function buildDeck(pairs, rng = Math.random) {
  const cards = []
  pairs.forEach((p, i) => {
    cards.push({ pairId: i, label: p.question, side: 'Q' })
    cards.push({ pairId: i, label: p.answer,   side: 'A' })
  })
  // Fisher–Yates over the freshly built cards — `pairs` is never mutated.
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}

/**
 * A card may flip only while fewer than two are face-up, and never a card
 * that is already face-up or matched.
 */
export function canFlip(i, flipped, matched) {
  if (flipped.includes(i) || matched.includes(i)) return false
  if (flipped.length >= 2) return false
  return true
}

/** Two cards match when they carry the same pair on OPPOSITE sides. */
export function isMatch(cardA, cardB) {
  return cardA.pairId === cardB.pairId && cardA.side !== cardB.side
}

/** The round is won when every card in the deck is matched. */
export function isWin(matchedCount, deckSize) {
  return matchedCount === deckSize
}

/**
 * Final score for a completed round. `movesTaken` is the total number of
 * two-card moves INCLUDING the move that sealed the win; it is clamped to
 * the perfect minimum (one move per pair) so efficiency never exceeds 1.
 * Bonus: up to `points × totalPairs` extra for perfect play.
 */
export function scoreWin({ totalPairs, movesTaken, points }) {
  const perfectMoves = totalPairs
  const movesUsed = Math.max(movesTaken, perfectMoves)
  const efficiency = perfectMoves / movesUsed // 0..1 (1 = perfect)
  const bonusMax = points * totalPairs
  const bonus = Math.round(efficiency * bonusMax)
  const finalScore = points * totalPairs + bonus
  const accuracy = Math.round(efficiency * 100)
  return { movesUsed, efficiency, bonus, finalScore, accuracy }
}

/**
 * The efficiency % and score shown on the done card. This is its own
 * computation (percent rounded FIRST, then the score derived from that
 * percent) so the numbers on screen stay exactly what they have always been.
 */
export function doneSummary({ totalPairs, moves, points }) {
  const movesUsed = Math.max(moves, totalPairs)
  const efficiency = Math.round((totalPairs / movesUsed) * 100)
  const finalScore = Math.round(points * totalPairs + (efficiency / 100) * points * totalPairs)
  return { efficiency, finalScore }
}

/** Star rating from efficiency percent — never below two stars for a win. */
export function starsForEfficiency(efficiency) {
  return efficiency >= 90 ? 5 : efficiency >= 75 ? 4 : efficiency >= 55 ? 3 : 2
}

/** Grid columns for a deck of n cards: 4-wide up to 16 cards, then 6. */
export function gridCols(n) {
  if (n <= 8) return 4
  if (n <= 12) return 4
  if (n <= 16) return 4
  return 6
}

/** Format elapsed seconds: "42s" under a minute, "m:ss" from one minute. */
export function formatTime(s) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`
}
