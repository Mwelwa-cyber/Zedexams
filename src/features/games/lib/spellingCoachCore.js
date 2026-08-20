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
 *
 * THE COACH IS THREE PHASES, and the middle one is the one that teaches:
 *
 *   A. SHOW THE CUT — the chunks, the trap marked, why people get it wrong,
 *      and a memory hook when a true one exists (`hook` is empty for 78 of
 *      the 79 authored words, which is the correct ratio, not a gap).
 *   B. REBUILD IT — the same chunks SHUFFLED, tapped back into order. The
 *      reveal alone teaches almost nothing; scaffolded reconstruction while
 *      the shape is fresh is the part that sticks. `rebuildOptions` is what
 *      makes it a reconstruction rather than a left-to-right tap.
 *   C. TRANSFER — two or three words the SAME cut solves, which is what turns
 *      one word into a rule. Never invented: only what the pack authored.
 *
 * And then the word comes back later with NONE of it — see `spellingStagesCore`.
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
 * Younger learners get onset–rime, not linguistics. The vocabulary a child
 * meets is graded by band the same way the paper terminology is: an eight
 * year old is told "the first bit and the rest", never "the root and the
 * suffix". Below this grade the simpler wording is used for every strategy.
 */
export const SIMPLE_VOCAB_BELOW_GRADE = 6

export const SIMPLE_LABEL = {
  syllables: 'Say it in bits',
  'root+affix': 'The word inside the word',
  trap: 'The tricky bit',
  'sound-out': 'Sound it out',
  family: 'Words like this one',
}

export const SIMPLE_BLURB = {
  syllables: 'Break it where you would say it. The tricky bit is marked.',
  'root+affix': 'There is a smaller word hiding at the start.',
  trap: 'Only one bit is hard — the rest you already know.',
  'sound-out': 'Say each sound and write what you hear.',
  family: 'These words all end the same way, so one teaches the rest.',
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
 * `question` is the pack's entry:
 * `{ answer, chunks?, strategy?, trap?, why?, hook?, hookNote?, related? }`
 * where `trap` is the INDEX of the chunk that catches people.
 *
 * `grade` picks the vocabulary — see SIMPLE_VOCAB_BELOW_GRADE. It is the only
 * thing that changes with age: the cut itself is the same cut.
 */
export function coachFor(question, { grade = null } = {}) {
  const word = String(question?.answer || '').toUpperCase()
  const chunks = question?.chunks
  const valid = validateChunks(word, chunks)
  if (!valid.ok) return null

  const strategy = STRATEGIES.includes(question?.strategy) ? question.strategy : 'syllables'
  const trap = Number.isInteger(question?.trap) && question.trap >= 0 && question.trap < chunks.length
    ? question.trap
    : null
  // `null` is "grade unknown", NOT grade zero. `Number(null)` is 0, which is
  // finite and below the threshold — so testing finiteness alone gave every
  // caller that did not pass a grade the youngest learner's vocabulary.
  const simple = grade != null && grade !== '' && Number.isFinite(Number(grade))
    && Number(grade) < SIMPLE_VOCAB_BELOW_GRADE

  // A hook with no note is not shown at all. The note is what says what the
  // hook MEANS ("the middle is an a, not an e") — the hook alone is a pun.
  const hook = question?.hook && question?.hookNote ? String(question.hook) : ''

  return {
    word,
    chunks: chunks.map((chunk) => chunk.toUpperCase()),
    strategy,
    label: simple ? SIMPLE_LABEL[strategy] : STRATEGY_LABEL[strategy],
    blurb: simple ? SIMPLE_BLURB[strategy] : STRATEGY_BLURB[strategy],
    simple,
    trap,
    why: question?.why || null,
    hook,
    hookNote: hook ? String(question.hookNote) : '',
    // Transfer words are what turn one word into a rule. Never generated: an
    // invented "these all end the same way" is a linguistic claim, and a
    // wrong one teaches a pattern that does not exist.
    related: Array.isArray(question?.related)
      ? question.related.map((w) => String(w).toUpperCase()).filter((w) => w && w !== word)
      : [],
  }
}

/**
 * The rebuild step's OPTIONS: the chunks, shuffled.
 *
 * Shuffling is the whole exercise. Rendering the chunks in order turns
 * "put it back together" into tapping left to right, which is not a
 * reconstruction and teaches nothing about the word's shape.
 *
 * A single-chunk cut cannot be shuffled, and a two-chunk one lands back in
 * order half the time — both are fine and neither is worth special-casing.
 * `rng` is injectable so a test can pin the deal.
 */
export function rebuildOptions(chunks, rng = Math.random) {
  const options = (chunks || []).map((chunk, index) => ({ chunk, index }))
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[options[i], options[j]] = [options[j], options[i]]
  }
  return options
}

/**
 * The rebuild step: the learner taps the chunks back in order.
 *
 * An out-of-order tap is REFUSED rather than punished — nothing is taken away
 * and nothing is marked wrong, because the coach is the help after a miss, not
 * a second test. The rejected option STAYS AVAILABLE (the caller only shakes
 * it), so a wrong guess cannot make the word unbuildable.
 *
 * Returns the next state and whether the word is complete.
 */
export function tapChunk(placed, index, chunkCount) {
  const expected = placed.length
  if (index !== expected) return { placed, accepted: false, done: false }
  const next = [...placed, index]
  return { placed: next, accepted: true, done: next.length >= chunkCount }
}

/* ── the outcome ───────────────────────────────────────────────────── */

/** How a coaching episode ended. Both are legitimate; neither is a failure. */
export const COACH_OUTCOMES = Object.freeze(['completed', 'skipped', 'unavailable'])

/**
 * What the round does with a coaching episode.
 *
 * The word goes on the tricky list and comes back later WHATEVER happened
 * here — including when the learner skipped, and including when the word had
 * no authored cut to show. Coaching is help, not a test, so it can never
 * change whether the miss counted; `test:spelling-coach` pins that the three
 * outcomes agree on `returnsLater`.
 */
export function coachOutcome(kind) {
  const outcome = COACH_OUTCOMES.includes(kind) ? kind : 'unavailable'
  return {
    outcome,
    // Scaffolding is removed on the way out. When the word returns it is the
    // plain spelling interface — no chunks, no trap, no hook, no answer.
    scaffoldingRemoved: true,
    returnsLater: true,
    coached: outcome === 'completed',
  }
}
