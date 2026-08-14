/**
 * Pure logic for the `word_builder` game engine.
 *
 * Plain .js module (no React, no DOM) so it can be unit-tested from plain
 * Node scripts — same pattern as numberTargetCore.js / sentenceScrambleCore.js.
 * The React engine in WordBuilderGame.jsx consumes these helpers.
 *
 * Content shape: `game.questions` is an array of { question, answer } where
 *   question = the clue (e.g. "🦁 King of the jungle.")
 *   answer   = the word to spell (upper or lower case — we normalise)
 */

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function defaultRandom() {
  return Math.random()
}

/** Only items with an answer are playable. */
export function playableWords(questions) {
  return (questions || []).filter((q) => q.answer)
}

/** Points per solved word; defaults to 10 when unset or not a number. */
export function pointsForGame(game) {
  return Number(game?.points) || 10
}

/** The word to spell, uppercased; empty string when there is no answer. */
export function normalizeTarget(answer) {
  return String(answer || '').toUpperCase()
}

/** Short words get decoy letters so the answer is not just "use every tile". */
export function decoyCountFor(wordLength) {
  return wordLength <= 4 ? 2 : wordLength <= 6 ? 1 : 0
}

/**
 * Build the shuffled letter-tile pool for a word: its own letters plus
 * decoys drawn (without repeats) from letters NOT in the word.
 * `rand` is injectable for deterministic tests; defaults to Math.random.
 */
export function makeTiles(word, rand = defaultRandom) {
  const letters = Array.from(word)
  const decoyPool = ALPHABET.split('').filter((l) => !word.includes(l))
  const decoyCount = decoyCountFor(word.length)
  for (let i = 0; i < decoyCount; i++) {
    const idx = Math.floor(rand() * decoyPool.length)
    letters.push(decoyPool.splice(idx, 1)[0])
  }
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[letters[i], letters[j]] = [letters[j], letters[i]]
  }
  return letters.map((letter) => ({ letter, placed: false }))
}

/** First open slot, or -1 when the word is fully filled. */
export function emptySlotIndex(slots) {
  return slots.findIndex((v) => v === null)
}

export function allSlotsFilled(slots) {
  return slots.every((v) => v !== null)
}

/** Read the player's word off the slots (each slot holds a tile index). */
export function buildGuess(slots, tiles) {
  return slots.map((idx) => tiles[idx].letter).join('')
}

/** Exact match only — target is already uppercased by normalizeTarget. */
export function isCorrectGuess(guess, target) {
  return guess === target
}

/** Is `pos` the final word of the round? */
export function isLastWord(pos, totalWords) {
  return pos + 1 >= totalWords
}

/** Whole-number percentage; safe when the round somehow had zero words. */
export function computeAccuracy(solvedCount, totalWords) {
  return Math.round((solvedCount / Math.max(totalWords, 1)) * 100)
}

/**
 * Round score: base points per solved word plus a no-mistakes bonus that
 * shrinks by 2 per wrong attempt (never below zero).
 */
export function computeScore(solvedCount, points, mistakes) {
  return solvedCount * points + Math.max(0, solvedCount * points - mistakes * 2)
}

/** Clues may start with a decorative emoji — the UI renders it elsewhere. */
export function stripLeadingEmoji(s) {
  if (!s) return ''
  return String(s).replace(/^\s*\p{Extended_Pictographic}+\s*/u, '').trim()
}
