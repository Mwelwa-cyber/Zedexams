/**
 * Pure logic for the `word_builder` engine — the prototype-v3 spelling
 * sprint (learner redesign step 4, the second rebuilt mechanic).
 *
 * The mechanic is the prototype's, minus its clock: a round is a FIXED
 * SET of `ROUND_WORDS` words off a shuffled queue. Each word shows its
 * clue (or, when text-to-speech is available, sometimes only says the
 * word aloud), its letters shuffled into tap tiles — the word's OWN
 * letters, no decoys — and auto-checks when every slot is filled:
 * correct pays 20 × combo and advances, wrong shakes, resets the combo
 * and clears the slots for another try. The round ends on the last word.
 *
 * The prototype ran this on a 60-second countdown. PROMPT 7b deleted it,
 * and this engine is the clearest case for why: spelling is accuracy,
 * never speed, and a clock on a spelling sprint punishes the slower
 * speller who is the entire reason the game exists. Nothing counts down.
 *
 * Content comes from the game doc's `questions` array
 * ({ question: clue, answer: word }), the same shape the old engine
 * read, with the prototype's word list as the fallback for a doc with
 * no usable words. No React, no DOM; every draw takes an injectable
 * `rng` so scripts/test-word-builder.mjs can drive it deterministically.
 */

/** Words in one round — the fixed set that replaced the countdown. */
export const ROUND_WORDS = 8

/** The prototype's word list — the fallback when a game doc has none. */
export const FALLBACK_WORDS = [
  { word: 'MARKET', clue: 'A place where people buy and sell things.' },
  { word: 'AUDIENCE', clue: 'The people watching or listening to a show.' },
  { word: 'HONORARY', clue: 'Given as an honour, without the usual duties.' },
  { word: 'EMPEROR', clue: 'A male ruler of an empire.' },
  { word: 'CAMPAIGN', clue: 'Activities to win an election or support.' },
  { word: 'INTELLIGENT', clue: 'Clever and quick to understand.' },
  { word: 'EMBARRASSED', clue: 'Feeling shy or silly in front of others.' },
  { word: 'POSTPONED', clue: 'Moved to a later time.' },
  { word: 'FAVOURITE', clue: 'The one you like best.' },
  { word: 'APARTMENT', clue: 'A set of rooms to live in; a flat.' },
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
 * The playable words of a game doc: uppercased, letters only (spaces and
 * punctuation cannot become tap tiles), clue from `question`.
 */
export function playableWords(questions) {
  return (questions || [])
    .map((q) => ({
      word: String(q?.answer || '').toUpperCase().trim(),
      clue: String(q?.question || '').trim(),
    }))
    .filter((it) => it.word.length >= 2 && /^[A-Z]+$/.test(it.word))
}

/** A fresh shuffled queue — the game's own words, or the fallback list. */
export function wordQueue(questions, rng = Math.random) {
  const words = playableWords(questions)
  return shuffled(words.length ? words : FALLBACK_WORDS, rng)
}

/** The word's own letters as shuffled tap tiles (prototype: no decoys). */
export function tilesFor(word, rng = Math.random) {
  return shuffled(String(word).split(''), rng).map((letter) => ({ letter, used: false }))
}

/** The guess read off the placed tile indices. */
export function guessFrom(placed, tiles) {
  return placed.map((i) => tiles[i]?.letter || '').join('')
}

/** Points for a solved word — 20 × the current combo multiplier. */
export function solveGain(combo) {
  return 20 * Math.max(1, Math.floor(Number(combo) || 1))
}

/** Stars for a finished round — the prototype's word-game thresholds. */
export function starsForWordScore(score) {
  const s = Number(score) || 0
  return s >= 140 ? 3 : s >= 60 ? 2 : 1
}

/**
 * Whether this word plays in listen mode (the clue is replaced by
 * "tap what you hear" + the word spoken aloud). Only when speech is
 * available, and then half the time — the prototype's coin flip.
 */
export function pickListenMode(ttsAvailable, rng = Math.random) {
  return Boolean(ttsAvailable) && rng() < 0.5
}

/**
 * Map a finished round onto the shared `useGameFinish` result shape —
 * solved words count as correct answers, failed checks as wrong ones,
 * and the peak combo is the round's best streak. `timeSpent` is the
 * learner's actual elapsed seconds — a record, never a score.
 */
export function roundResult({ game, score, solved, misses, peakCombo, timeSpent }) {
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
    // MEASURED, not the old fixed round length. Still recorded (My Progress
    // and the weekly report read it) — it is simply never scored or ranked.
    timeSpent: Math.max(0, Math.floor(Number(timeSpent) || 0)),
  }
}
