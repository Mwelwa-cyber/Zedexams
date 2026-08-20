/**
 * Word packs — how a spelling game gets more words than a game document can
 * reasonably carry.
 *
 * `english_word_builder_g7` shipped with ten hand-authored words in
 * `gamesSeed.js`. That is enough to prove the mechanic and nowhere near enough
 * to run the ladder the mechanic was built for: a stage is eight words, and
 * with ten in the pack every stage after the first is the same ten reshuffled,
 * which is exactly the "same words again" complaint the stage design exists to
 * answer. The 879-word Grade 7 bank in `src/data/spellingBank.js` is what fixes
 * that, and this module is the join.
 *
 * WHY A PACK RATHER THAN QUESTIONS ON THE DOCUMENT. `gamesSeed.js` is imported
 * by the games hub, so it is in the bundle every learner downloads before they
 * have chosen anything. Putting 879 words there would put a spelling bank in
 * the path of a child opening a maths game. A pack is named by the document
 * (`wordPack: 'grade7-spelling'`) and FETCHED on demand — see `loadWordPack`,
 * which is the only place the bank is imported, and does it dynamically.
 *
 * THE CLUE IS THE SENTENCE. The seeded ten carry an emoji clue ("🌍 The layer
 * of gases…"); every word in the bank carries its own context sentence with a
 * `___` gap ("Draw a ___ line with your ruler"). The sentence is the better
 * clue and the one the design asks for — it gives the word's MEANING without
 * giving its spelling, which a definition beginning with the word would not.
 */

/** Packs a game document may name. A document naming anything else gets its own questions. */
export const WORD_PACKS = Object.freeze(['grade7-spelling'])

/** Is this a pack this build knows how to load? */
export function isKnownPack(packId) {
  return WORD_PACKS.includes(String(packId || ''))
}

/**
 * Adapt the bank into the question shape the engine already consumes, so
 * nothing downstream has to learn a second format.
 *
 * `playableWords` uppercases the answer and builds tap tiles from it, and the
 * coach DISPLAYS the chunks beside those tiles — so the chunks are uppercased
 * here too. Leaving them lowercase would show a learner "sep · a · rate" under
 * tiles reading S E P A R A T E, which reads as two different words.
 *
 * Pure: both arguments are passed in, so the node test can drive it without
 * loading the bank.
 *
 * @param {Array} bank   rows of `{ word, band, sentence }`
 * @param {object} coach word → `{ chunks, trap, strategy, why }`, may be empty
 * @returns {Array} question rows: `{ question, options, answer, band, … }`
 */
export function toPackQuestions(bank = [], coach = {}) {
  return bank
    .filter((row) => row && typeof row.word === 'string' && row.word.length >= 2)
    .map((row) => {
      const cut = coach[row.word] || null
      const question = {
        question: row.sentence || '',
        options: [],
        answer: row.word.toUpperCase(),
        band: row.band || null,
      }
      // A word with no authored cut carries none. `spellingCoachCore` gives no
      // coach rather than inventing a split, which is the rule that stops a
      // learner being told a confident lie about why they were wrong.
      if (cut && Array.isArray(cut.chunks) && cut.chunks.length) {
        question.chunks = cut.chunks.map((chunk) => String(chunk).toUpperCase())
        question.strategy = cut.strategy
        question.trap = Number.isInteger(cut.trap) ? cut.trap : null
        question.why = cut.why || ''
      }
      return question
    })
}

/**
 * Load a named pack. Returns [] for an unknown pack or a failed load, which
 * the caller reads as "use the document's own questions" — a spelling game
 * whose pack fails to arrive still plays on its seeded ten rather than
 * showing a child an error.
 */
export async function loadWordPack(packId) {
  if (!isKnownPack(packId)) return []
  try {
    const [bank, coach] = await Promise.all([
      import('../../../data/spellingBank.js'),
      import('../../../data/spellingCoach.js'),
    ])
    return toPackQuestions(bank.SPELLING_BANK, coach.SPELLING_COACH)
  } catch (err) {
    console.warn('word pack failed to load', packId, err?.message)
    return []
  }
}
