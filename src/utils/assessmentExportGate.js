/**
 * Export readiness gate for the Assessment Studio.
 *
 * A paper could be downloaded, printed or turned into an answer sheet while it
 * still held unfinished questions. The only guard on the export path was
 * "questionCount === 0", and an unfinished question still counts — so a brand
 * new paper, whose single starter block is blank by construction, sailed
 * through and printed as
 *
 *     1. (no question text)                                        (1 mark)
 *        A. ____   B. ____   C. ____   D. ____
 *     TOTAL MARKS: ___ / 1
 *
 * Meanwhile the SAVE path was already gated properly, on the blocking issues
 * collectQuizIssues() reports — including "question text is empty". So the
 * check existed and simply was not wired to the four export buttons. This
 * module is that wiring, kept pure so it can be unit-tested and so both the
 * buttons' disabled state and the click handler read one decision rather than
 * re-deriving it.
 *
 * It deliberately owns no rules of its own: `issues` comes from
 * collectQuizIssues(), which stays the single definition of "this paper is not
 * finished". All this adds is (a) recognising the untouched starter block as
 * "no questions yet" rather than "one broken question", and (b) turning issue
 * ids into a sentence naming the question numbers a teacher must go and fix.
 *
 * ## Unresolved figures
 *
 * The same principle: the records come from `unresolvedFigures.js` and the
 * sentence is its, not this module's. What is decided here is the CLASSIFICATION
 * — a required figure the renderer cannot produce is a blocking correctness
 * error, ranked with the unfinished questions rather than with the printability
 * advisories, because a learner asked to label a diagram that is not on the page
 * cannot answer the question at all.
 *
 * It is ranked BELOW the unfinished-question check on purpose. A paper with both
 * is a paper still being written, and "finish question 3" is the more useful
 * first instruction; the figure is the last thing standing between a finished
 * paper and the photocopier.
 */

import {
  unresolvedFiguresMessage, affectedQuestionNumbers, listNumbers,
} from './unresolvedFigures.js'

// Re-exported so this module's public surface is unchanged. There is one
// implementation, next to the sentence that needs it — see unresolvedFigures.js.
export { listNumbers }

/** Issue ids that identify an unfinished QUESTION (as opposed to the paper). */
const QUESTION_ISSUE_PREFIXES = [
  'question-text-', 'question-uploading-', 'opt-', 'correct-', 'numeric-',
  'fill-blanks-', 'hotspot-', 'diagram-label-', 'matching-', 'sequence-',
  'passage-text-', 'passage-map-image-', 'passage-questions-', 'passage-uploading-',
]

/** The blocking (non-advisory) subset of a collectQuizIssues() result. */
export function blockingIssues(issues = []) {
  return (Array.isArray(issues) ? issues : []).filter((i) => i && i.severity !== 'warn')
}

function isQuestionIssue(issue) {
  return QUESTION_ISSUE_PREFIXES.some((p) => String(issue?.id || '').startsWith(p))
}

/**
 * Blocking issues grouped by the question they belong to, so the builder can
 * badge the offending card instead of making the teacher hunt for it.
 *
 * @param {Array<{id,label,severity,localId}>} issues
 * @returns {Map<string, string[]>} localId → the issue labels on that card
 */
export function blockingIssuesByLocalId(issues = []) {
  const out = new Map()
  for (const issue of blockingIssues(issues)) {
    if (!issue.localId) continue
    if (!out.has(issue.localId)) out.set(issue.localId, [])
    out.get(issue.localId).push(issue.label)
  }
  return out
}

/**
 * The display numbers of the unfinished questions, ascending and de-duplicated.
 * A question the studio has not numbered yet (a passage with no questions, say)
 * contributes nothing here and is reported by its label instead.
 */
export function incompleteQuestionNumbers(issues = [], questionNumbers = {}) {
  const numbers = new Set()
  for (const issue of blockingIssues(issues)) {
    if (!isQuestionIssue(issue) || !issue.localId) continue
    const n = Number(questionNumbers[issue.localId])
    if (Number.isFinite(n)) numbers.add(n)
  }
  return [...numbers].sort((a, b) => a - b)
}


/**
 * A required figure the renderer cannot produce, as a blocking decision.
 *
 * Returns null when there is nothing to say, so the caller can fall through to
 * `ready` — an empty list must never read as a block.
 */
function figureBlock(unresolvedFigures = []) {
  const list = (Array.isArray(unresolvedFigures) ? unresolvedFigures : []).filter(Boolean)
  if (list.length === 0) return null
  // The badged numbers and the sentence come from the same call, which is the
  // only way they cannot disagree — they did, and a paper badging questions 2
  // and 9 carried a message that opened "Question 9 requires a diagram".
  return {
    blocked: true,
    numbers: affectedQuestionNumbers(list),
    reason: 'unresolved-figure',
    message: unresolvedFiguresMessage(list),
  }
}

/**
 * Decide whether the paper may be exported, and say why not in words a teacher
 * can act on.
 *
 * @param {object} input
 * @param {Array} input.issues            collectQuizIssues().issues
 * @param {object} input.questionNumbers  localId → display number
 * @param {number} input.questionCount    questions currently on the paper
 * @param {boolean} input.emptyStarter    the paper is still just its untouched
 *                                        starter block (hasOnlyEmptyStarterSection)
 * @param {Array} input.unresolvedFigures records from unresolvedRequiredFigures()
 * @returns {{blocked: boolean, message: string, numbers: number[], reason: string}}
 *   reason is 'ready' | 'empty' | 'incomplete-questions' | 'paper-details'
 *   | 'unresolved-figure'
 */
export function describeExportBlock({
  issues = [], questionNumbers = {}, questionCount = 0, emptyStarter = false,
  unresolvedFigures = [],
} = {}) {
  const ready = { blocked: false, message: '', numbers: [], reason: 'ready' }

  // An untouched new paper reads as one question to countQuizQuestions, but to
  // a teacher it is an empty page — say so, rather than "question 1 is
  // unfinished" about a block they have never typed in.
  if (questionCount === 0 || emptyStarter) {
    return {
      blocked: true,
      numbers: [],
      reason: 'empty',
      message: 'Add at least one question before you download or print this paper.',
    }
  }

  const blocking = blockingIssues(issues)
  if (blocking.length === 0) return figureBlock(unresolvedFigures) || ready

  const numbers = incompleteQuestionNumbers(issues, questionNumbers)
  if (numbers.length > 0) {
    const many = numbers.length > 1
    return {
      blocked: true,
      numbers,
      reason: 'incomplete-questions',
      message:
        `${many ? 'Questions' : 'Question'} ${listNumbers(numbers)} ${many ? 'are' : 'is'} ` +
        `not finished yet — ${many ? 'they' : 'it'} would print blank. ` +
        `Finish ${many ? 'them' : 'it'} in the builder, then download.`,
    }
  }

  // Blockers that belong to the paper rather than to any one question (no
  // subject, an empty Part, a mis-grouped comprehension run).
  const first = blocking[0]
  return {
    blocked: true,
    numbers: [],
    reason: 'paper-details',
    message: blocking.length === 1
      ? `${first.label} Fix that, then download.`
      : `${first.label} There ${blocking.length === 2 ? 'is 1 other thing' : `are ${blocking.length - 1} other things`} to fix before this paper can be downloaded.`,
  }
}
