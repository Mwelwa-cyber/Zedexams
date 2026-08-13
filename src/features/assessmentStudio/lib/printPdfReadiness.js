/**
 * Whether this paper may be PRINTED, which is a stricter question than whether
 * it may be exported.
 *
 * ## Why there are two layers
 *
 * `buildAssessmentExportReadiness` answers "is this paper finished" — unfinished
 * questions, missing paper details, a diagram the catalogue cannot draw. Those
 * are properties of the paper and they block every route out of the studio.
 *
 * Pagination answers a different question: "does this paper come out of a
 * browser correctly". A blank trailing sheet, a question split across a page
 * turn, a diagram that prints away from its stem, a table clipped at the right
 * edge — every one of those is a real defect a teacher would meet at the
 * photocopier, and none of them is visible to the base gate.
 *
 * ## Why Word is deliberately NOT covered
 *
 * Word paginates with its own engine, its own font metrics and its own widow and
 * orphan rules. A page count measured in Chromium says nothing about it, so
 * blocking the `.docx` export on a Chromium-measured layout would refuse a file
 * that is very likely fine. `printPdfReadiness` is consulted by the Print and
 * PDF routes only; the Word route reads the base readiness and nothing else.
 * There is a test for that, because it is the kind of thing a later refactor
 * "tidies up" into one gate.
 *
 * ## Why "not yet measured" blocks rather than allows
 *
 * A paper whose layout has not been verified is a paper we know nothing about.
 * Letting it through on the grounds that no problem has been REPORTED is the
 * same reasoning as treating a failed check as a pass. It blocks with a message
 * that says what is happening, and clears on its own within a second.
 */

import { PAGINATION_STATES, PAGINATION_ISSUES } from '../../../utils/paperPaginationCore.js'

/**
 * Layout defects that stop a print.
 *
 * Every one of them is a printability failure a learner or a teacher would
 * physically encounter. There is deliberately no "advisory" tier here: a
 * pagination issue that did not block would be a warning nobody reads, and the
 * paper would go to the photocopier anyway.
 */
export const BLOCKING_PAGINATION_ISSUES = Object.freeze([
  PAGINATION_ISSUES.BLANK_PAGE,
  PAGINATION_ISSUES.FOOTER_ONLY_PAGE,
  PAGINATION_ISSUES.BODY_IN_FOOTER,
  PAGINATION_ISSUES.HORIZONTAL_OVERFLOW,
  PAGINATION_ISSUES.MISSING_BLOCK,
  PAGINATION_ISSUES.QUESTION_SPLIT,
  PAGINATION_ISSUES.DIAGRAM_SEPARATED,
  PAGINATION_ISSUES.CLIPPED_CONTENT,
  PAGINATION_ISSUES.OVERSIZED_BLOCK,
  // §7. A redundant manual break and an orphaned section heading are both
  // defects the teacher only sees on paper: the first prints a blank sheet for
  // every learner in the class, the second tells them a section started on the
  // page they have already turned away from. Blocking is consistent with the
  // rest of this list — every entry here is something the browser will print
  // wrongly, and the alternative to blocking is a warning nobody reads at the
  // photocopier.
  PAGINATION_ISSUES.REDUNDANT_BREAK,
  PAGINATION_ISSUES.ORPHANED_HEADING,
])

const CHECKING_MESSAGE = 'Checking the page layout…'
const FAILED_MESSAGE = 'The paper layout could not be verified. Try again before exporting.'

/** The blocking subset of a pagination result's issues. */
export function blockingLayoutIssues(pagination) {
  const issues = Array.isArray(pagination?.issues) ? pagination.issues : []
  return issues.filter((i) => BLOCKING_PAGINATION_ISSUES.includes(i?.code))
}

/**
 * The Print/PDF verdict.
 *
 * @param {object} input
 * @param {object} input.baseReadiness `buildAssessmentExportReadiness(...)`'s result
 * @param {object} input.pagination    `usePaperPagination(...)`'s result
 * @returns {{blocked, reason, message, numbers, layoutIssues}}
 */
export function buildPrintPdfReadiness({ baseReadiness = null, pagination = null } = {}) {
  const gate = baseReadiness?.gate || baseReadiness || {}

  // The paper's own problems come first. "Finish question 3" is a more useful
  // instruction than "the layout has a blank page" about a paper that is still
  // being written — and the layout of an unfinished paper is not worth
  // reporting, because finishing it will change it.
  if (gate.blocked) {
    return {
      blocked: true,
      reason: gate.reason,
      message: gate.message,
      numbers: gate.numbers || [],
      layoutIssues: [],
    }
  }

  const status = pagination?.status ?? PAGINATION_STATES.IDLE

  if (status === PAGINATION_STATES.FAILED) {
    return {
      blocked: true, reason: 'layout-unverified', message: FAILED_MESSAGE,
      numbers: [], layoutIssues: [],
    }
  }
  if (status !== PAGINATION_STATES.READY) {
    // idle, measuring, stale — all of them mean "we do not know yet".
    return {
      blocked: true, reason: 'layout-checking', message: CHECKING_MESSAGE,
      numbers: [], layoutIssues: [],
    }
  }

  const layoutIssues = blockingLayoutIssues(pagination)
  if (layoutIssues.length === 0) {
    return { blocked: false, reason: 'ready', message: '', numbers: [], layoutIssues: [] }
  }

  // One instruction, not a list: a teacher fixes one thing and looks again, and
  // a wall of layout complaints about a paper they have not touched yet reads
  // as "this is broken" rather than "do this next".
  const first = layoutIssues[0]
  const more = layoutIssues.length - 1
  return {
    blocked: true,
    reason: first.code,
    message: more > 0
      ? `${first.message} There ${more === 1 ? 'is 1 other layout problem' : `are ${more} other layout problems`} to fix before printing.`
      : first.message,
    numbers: first.pageNumbers || (first.pageNumber ? [first.pageNumber] : []),
    layoutIssues,
  }
}

/**
 * Word's verdict: the base readiness, and nothing from pagination.
 *
 * Exists as a named function rather than as "just use baseReadiness" so the
 * separation is visible at the call site and a test can assert it. The
 * temptation this resists is real — the two buttons sit next to each other, and
 * one gate for both looks tidier right up until Word refuses a file it would
 * have written perfectly.
 */
export function buildWordReadiness({ baseReadiness = null } = {}) {
  const gate = baseReadiness?.gate || baseReadiness || {}
  return {
    blocked: Boolean(gate.blocked),
    reason: gate.reason || 'ready',
    message: gate.message || '',
    numbers: gate.numbers || [],
    layoutIssues: [],
  }
}
