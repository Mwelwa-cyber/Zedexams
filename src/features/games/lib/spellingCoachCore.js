/**
 * The "break it up" coach — what a learner sees after missing a word.
 *
 * Ported from docs/learner/zedexams-spelling-coach.html, and the whole reason
 * it is a module rather than a component is its one automatable rule:
 *
 *   `chunks.join('') === word`. A cut that does not rebuild the word teaches a
 *   child a word that does not exist. Everything ELSE about a cut needs a
 *   human — where to break "separate" is a teaching decision, not a string
 *   operation — so this file checks the one thing a machine can check and
 *   refuses to guess the rest.
 *
 *   THERE IS NO FALLBACK SPLIT, DELIBERATELY. A word whose pack gives no
 *   chunks gets NO coach, rather than an invented syllable break. English
 *   syllabification by rule gets "necessary" wrong, and a confident wrong
 *   break after a miss is worse than no help at all — the learner has just
 *   been told they are wrong, and would now be told a lie about why.
 */

export const STRATEGIES = ['syllables', 'root+affix', 'trap', 'sound-out', 'family']

export const STRATEGY_LABEL = {
  syllables: 'Syllables · long words',
  'root+affix': 'Root + ending · suffix rules',
  trap: 'Just the trap · one hard bit',
  'sound-out': 'Sound it out · regular words',
  family: 'Word family · learn five at once',
}

export const STRATEGY_BLURB = {
  syllables: 'Break it where you would say it. The tricky bit is marked.',
  'root+affix': 'Teaches the rule, not just the word.',
  trap: 'Only one bit is hard — the rest you already know.',
  'sound-out': 'Nothing irregular here. Say each sound and write what you hear.',
  family: 'The same awkward pattern, so learning one carries the rest.',
}

/**
 * The one check that can be automated: the chunks must rebuild the word,
 * ignoring case. Returns `{ ok, reason }` so a caller can say WHY.
 */
export function validateChunks(word, chunks) {
  if (!word) return { ok: false, reason: 'no-word' }
  if (!Array.isArray(chunks) || !chunks.length) return { ok: false, reason: 'no-chunks' }
  if (chunks.some((chunk) => typeof chunk !== 'string' || !chunk.length)) {
    return { ok: false, reason: 'empty-chunk' }
  }
  const rebuilt = chunks.join('')
  if (rebuilt.toUpperCase() !== String(word).toUpperCase()) {
    return { ok: false, reason: 'does-not-rebuild', rebuilt }
  }
  return { ok: true, reason: 'ok' }
}

/**
 * The coach for a word, or null when the pack has not broken it up.
 *
 * `question` is the pack's entry: `{ answer, chunks?, strategy?, trap?, why? }`
 * where `trap` is the INDEX of the chunk that catches people.
 */
export function coachFor(question) {
  const word = String(question?.answer || '').toUpperCase()
  const chunks = question?.chunks
  const valid = validateChunks(word, chunks)
  if (!valid.ok) return null

  const strategy = STRATEGIES.includes(question?.strategy) ? question.strategy : 'syllables'
  const trap = Number.isInteger(question?.trap) && question.trap >= 0 && question.trap < chunks.length
    ? question.trap
    : null

  return {
    word,
    chunks: chunks.map((chunk) => chunk.toUpperCase()),
    strategy,
    label: STRATEGY_LABEL[strategy],
    blurb: STRATEGY_BLURB[strategy],
    trap,
    why: question?.why || null,
  }
}

/**
 * The rebuild step: the learner taps the chunks back in order.
 *
 * An out-of-order tap is REFUSED rather than punished — nothing is taken away
 * and nothing is marked wrong, because the coach is the help after a miss, not
 * a second test. Returns the next state and whether the word is complete.
 */
export function tapChunk(placed, index, chunkCount) {
  const expected = placed.length
  if (index !== expected) return { placed, accepted: false, done: false }
  const next = [...placed, index]
  return { placed: next, accepted: true, done: next.length >= chunkCount }
}
