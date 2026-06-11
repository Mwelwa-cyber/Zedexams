/**
 * Pure logic for the `sentence_scramble` game engine.
 *
 * Plain .js module (no React) so it can be unit-tested from plain Node
 * scripts — same pattern as numberTargetCore.js / sortingFactoryCore.js.
 *
 * Content shape: `game.questions` is an array of { question, answer } where
 *   answer   = the thing to rebuild, in correct order:
 *              - a sentence ("The goat eats grass.") → tiles are words
 *              - a sequence with '|' separators
 *                ("Evaporation|Condensation|Rainfall|Collection")
 *                → tiles are the ordered steps
 *   question = optional clue shown above the tiles (e.g. "Put the stages
 *              of the water cycle in order."). Blank is fine for plain
 *              sentence rounds.
 */

/** Split an answer into ordered tiles: '|' steps if present, else words. */
export function tokenizeAnswer(answer) {
  const raw = String(answer || '').trim()
  if (!raw) return []
  const parts = raw.includes('|') ? raw.split('|') : raw.split(/\s+/)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Trim items and drop any whose answer yields fewer than 2 tiles. */
export function normalizeItems(questions) {
  return (questions || [])
    .map((q) => ({
      question: String(q?.question || '').trim(),
      answer: String(q?.answer || '').trim(),
      tokens: tokenizeAnswer(q?.answer),
    }))
    .filter((q) => q.tokens.length >= 2)
}

function defaultRandom() {
  return Math.random()
}

/**
 * Shuffle the tokens for play. Retries so the scrambled order differs from
 * the correct order whenever the tokens make that possible (e.g. not
 * "go go go").
 */
export function scrambleTokens(tokens, rand = defaultRandom) {
  const out = tokens.slice()
  for (let attempt = 0; attempt < 10; attempt++) {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    if (out.some((word, i) => word !== tokens[i])) return out
  }
  return out
}

/** Does the player's tile order rebuild the answer exactly? */
export function isCorrectOrder(placed, tokens) {
  if (placed.length !== tokens.length) return false
  return placed.every((word, i) => word === tokens[i])
}

/**
 * Sanity-check a scramble game's content: at least 4 playable items, and
 * no item longer than 10 tiles (more does not fit a phone screen).
 */
export function validateScrambleContent(questions) {
  const items = normalizeItems(questions)
  if (items.length < 4) return { ok: false, reason: 'Needs at least 4 sentences or sequences.' }
  const tooLong = items.find((q) => q.tokens.length > 10)
  if (tooLong) return { ok: false, reason: `"${tooLong.answer}" has more than 10 tiles — split it up.` }
  return { ok: true, items }
}
