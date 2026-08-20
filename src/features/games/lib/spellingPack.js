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

/**
 * The pack id for a grade.
 *
 * NAMED BY GRADE, not hard-coded to one, so opening Grade 6 is a bank file
 * plus an entry in `WORD_PACKS` rather than a change to the engine. It returns
 * an id whether or not this build has that pack — `isKnownPack` is the thing
 * that answers whether it can be loaded, and the caller falls back to the
 * game document's own questions when it cannot.
 */
export function packForGrade(grade) {
  const n = Number(grade)
  return Number.isInteger(n) && n > 0 ? `grade${n}-spelling` : ''
}

/** The grade a pack serves, or null for an id that names no grade. */
export function gradeForPack(packId) {
  const match = /^grade(\d+)-spelling$/.exec(String(packId || ''))
  return match ? Number(match[1]) : null
}

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
        // The HOOK and the TRANSFER words used to be dropped here, which meant
        // the two most valuable fields the content carries — the memory hook
        // and the two or three words the same cut solves — were authored,
        // tested, and then never shown to anybody. The coach's third phase
        // exists to turn one word into a rule and it needs these to do it.
        question.hook = cut.hook || ''
        question.hookNote = cut.hookNote || ''
        question.related = Array.isArray(cut.transfer || cut.relatedWords)
          ? (cut.transfer || cut.relatedWords).map((w) => String(w).toUpperCase())
          : []
      }
      return question
    })
}

/**
 * Fold approved Firestore words into the bundled bank.
 *
 * A MERGE, NOT A REPLACEMENT, and deliberately so. The bundled bank is 879
 * hand-authored, reviewed Grade 7 words that cost no read and work offline —
 * an admin adding twelve words must not replace it with twelve. A Firestore
 * record for a word the bank already has WINS, because it is the edited
 * version and the reason somebody edited it was that the bundled one was
 * wrong.
 *
 * Pure, so the node test can drive it without Firestore.
 */
export function mergeIntoPack(packRows = [], approvedWords = []) {
  if (!approvedWords.length) return packRows
  const byWord = new Map(packRows.map((row) => [String(row.answer || '').toUpperCase(), row]))
  for (const record of approvedWords) {
    const answer = String(record.word || '').toUpperCase()
    if (!answer) continue
    const row = {
      question: record.contextSentence || '',
      options: [],
      answer,
      band: record.band || null,
    }
    if (Array.isArray(record.chunks) && record.chunks.length) {
      row.chunks = record.chunks.map((chunk) => String(chunk).toUpperCase())
      row.strategy = record.strategy
      row.trap = Number.isInteger(record.trap) ? record.trap : null
      row.why = record.why || ''
      row.hook = record.hook || ''
      row.hookNote = record.hookNote || ''
      row.related = (record.relatedWords || []).map((w) => String(w).toUpperCase())
    }
    byWord.set(answer, row)
  }
  return [...byWord.values()]
}

/**
 * Load a named pack. Returns [] for an unknown pack or a failed load, which
 * the caller reads as "use the document's own questions" — a spelling game
 * whose pack fails to arrive still plays on its seeded ten rather than
 * showing a child an error.
 *
 * `fetchApproved` is injected so this stays testable under plain node and so
 * the Firestore client is never pulled into the bundle of a build that has no
 * spelling game on screen. A FAILED fetch is an empty list and the bundled
 * bank stands — the learner never sees an error and never sees a short bank.
 */
export async function loadWordPack(packId, { fetchApproved = null } = {}) {
  if (!isKnownPack(packId)) return []
  try {
    const [bank, coach] = await Promise.all([
      import('../../../data/spellingBank.js'),
      import('../../../data/spellingCoach.js'),
    ])
    const rows = toPackQuestions(bank.SPELLING_BANK, coach.SPELLING_COACH)
    if (!fetchApproved) return rows
    try {
      const approved = await fetchApproved(gradeForPack(packId) ?? bank.SPELLING_GRADE)
      return mergeIntoPack(rows, Array.isArray(approved) ? approved : [])
    } catch {
      return rows
    }
  } catch (err) {
    console.warn('word pack failed to load', packId, err?.message)
    return []
  }
}
