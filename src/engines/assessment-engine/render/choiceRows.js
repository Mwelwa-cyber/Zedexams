/**
 * The rows a choice question draws — computed, so the layout has nothing to
 * decide.
 *
 * Pure and node-tested. Everything a reviewer would want to check about a
 * choice question's presentation — which letter each option carries, which row
 * is selected, which rows show a verdict and when — is decided here, where it
 * can be asserted without a browser. The component maps rows to elements and
 * makes no decisions of its own.
 *
 * ## The letters come from the shared package, and that is the point
 *
 * `optionLabel` lives in `functions/shared/assessment/answerChoicesCore.js`
 * because how many choices a question offers, and what they are called, is a
 * RULE the export gate enforces on papers. A learner reading "C" on screen and
 * a marking key printing "C" for the same option is not a coincidence to
 * maintain — it is one function, called twice. Re-deriving letters here with
 * `String.fromCharCode(65 + i)` would work perfectly until the day the shared
 * rule changed.
 *
 * ## Verdicts are not shown until they are revealed
 *
 * `revealed` gates every correctness signal. Practice mode reveals after an
 * answer; exam mode never does. A row cannot carry `correct` or `wrong` while
 * unrevealed — asserted, because leaking the key into the DOM of an exam is
 * not a visual bug, it is the assessment being wrong.
 */
import { optionLabel } from '../../../../functions/shared/assessment/answerChoicesCore.js'

/**
 * @typedef {object} ChoiceRow
 * @property {number} index
 * @property {string} letter          'A', 'B', … via the shared rule
 * @property {object} content         the option's RichContent envelope
 * @property {boolean} selected       the learner picked this one
 * @property {boolean} revealed       verdicts are being shown at all
 * @property {boolean} correct        revealed AND this is the answer
 * @property {boolean} wrong          revealed AND the learner picked this one AND it is not
 */

/**
 * Build the rows for one choice question.
 *
 * @param {object} args
 * @param {object} args.question      a canonical question
 * @param {number|null} args.answer   the index the learner picked, or null
 * @param {boolean} [args.revealed]   show verdicts (practice after answering)
 * @returns {ChoiceRow[]}
 */
export function buildChoiceRows({ question, answer, revealed = false }) {
  const options = question?.options ?? []
  const correctIndex = question?.correctIndex
  return options.map((content, index) => {
    const selected = answer === index
    // `correctIndex` is null on a corrupt document — a stored index pointing
    // past the end of the options, which `fromQuiz` refuses to pass through.
    // Nothing is then marked correct, which is honest: the paper does not say
    // which answer is right, and painting one green would invent an answer.
    const isKey = correctIndex !== null && correctIndex !== undefined && correctIndex === index
    return {
      index,
      letter: optionLabel(index),
      content,
      selected,
      revealed,
      correct: revealed && isKey,
      wrong: revealed && selected && !isKey,
    }
  })
}

/**
 * Is this question answerable as drawn?
 *
 * A choice question with no options renders as a prompt with nothing under it —
 * visually a paragraph, functionally a question the learner cannot answer. The
 * renderer reports it rather than drawing it, for the same reason the
 * dispatcher refuses an unsupported type.
 */
export function isAnswerable(question) {
  return (question?.options?.length ?? 0) > 0
}
