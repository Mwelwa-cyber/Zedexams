/**
 * The review grid, the submit sheet's counts, and "go to the first blank one".
 *
 * All three read the same derivation, because they are three statements about
 * one thing. The submit sheet saying "3 questions are still blank" and the
 * grid showing four outlined cells is the kind of disagreement a child notices
 * and an adult explains away.
 *
 * Pure: node-tested.
 */

import { printedNumber } from './attemptMarking.js'

export const CELL = Object.freeze({
  ANSWERED: 'answered',
  BLANK: 'blank',
})

/**
 * One cell per question.
 *
 * @param {object} args
 * @param {Array} args.questions
 * @param {object} args.answers      questionId -> option index
 * @param {object} args.flags        questionId -> true
 * @param {number} args.currentIndex where the learner is
 */
export function buildGrid({ questions = [], answers = {}, flags = {}, currentIndex = 0 } = {}) {
  return (Array.isArray(questions) ? questions : []).map((q, i) => ({
    index: i,
    questionId: q?.id ?? String(i),
    // The number the grid PRINTS is the position in this run, not the number
    // on the paper: a learner counting cells to find "the fourth one" must
    // land on the fourth cell. The paper's own number is carried alongside so
    // the results list can still say "question 31".
    label: i + 1,
    printed: printedNumber(q, i),
    state: Number.isInteger(answers?.[q?.id]) ? CELL.ANSWERED : CELL.BLANK,
    flagged: flags?.[q?.id] === true,
    current: i === currentIndex,
  }))
}

/** What the submit sheet counts. */
export function gridSummary(cells = []) {
  const answered = cells.filter((c) => c.state === CELL.ANSWERED)
  const blank = cells.filter((c) => c.state === CELL.BLANK)
  const flagged = cells.filter((c) => c.flagged)
  return {
    total: cells.length,
    answered: answered.length,
    blank: blank.length,
    flagged: flagged.length,
    /** null when there is none — the sheet then omits the button entirely
     *  rather than offering one that goes nowhere. */
    firstBlankIndex: blank.length ? blank[0].index : null,
    firstFlaggedIndex: flagged.length ? flagged[0].index : null,
  }
}

/**
 * Where "Next" goes.
 *
 * `strictForward` (off by default — §1) removes the back step, and that is the
 * ONLY thing it removes. It never skips a question and never ends the paper
 * early; a learner who turned it on asked for a harsher rehearsal, not a
 * shorter one.
 */
export function nextIndex({ currentIndex, total, strictForward = false }) {
  void strictForward
  const i = Number(currentIndex)
  const n = Number(total)
  if (!Number.isFinite(i) || !Number.isFinite(n)) return 0
  return Math.min(n - 1, Math.max(0, i + 1))
}

export function prevIndex({ currentIndex, strictForward = false }) {
  if (strictForward) return null
  const i = Number(currentIndex)
  if (!Number.isFinite(i) || i <= 0) return null
  return i - 1
}

/** True when the footer should offer "Finish and submit" rather than "Next". */
export function isLastQuestion({ currentIndex, total }) {
  return Number(currentIndex) >= Number(total) - 1
}

/**
 * The submit sheet's copy, assembled from the counts.
 *
 * Written here rather than in the component because §2 pins what it must say:
 * it counts blanks and flags, states the time left, and tells the truth that
 * *a guess costs you nothing*. A sheet that quietly drops the guess line
 * because a paper had no blanks that render is a sheet that has stopped making
 * the one argument it exists to make.
 */
export function submitSheetLines(summary) {
  const lines = []
  if (summary.blank > 0) {
    lines.push({
      tone: 'warn',
      icon: 'warn',
      text: `${summary.blank} question${summary.blank > 1 ? 's are' : ' is'} still blank. Blank answers score nothing — a guess costs you nothing.`,
    })
  }
  if (summary.flagged > 0) {
    lines.push({
      tone: 'neutral',
      icon: 'flag',
      text: `You flagged ${summary.flagged} question${summary.flagged > 1 ? 's' : ''} to come back to.`,
    })
  }
  return lines
}
