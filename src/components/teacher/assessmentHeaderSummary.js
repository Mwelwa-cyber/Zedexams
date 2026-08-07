// When the Paper Header form collapses, and what the one line it collapses to
// says.
//
// The header form asks for eighteen things — school, class, grade, type, term,
// year, curriculum, subject, duration, date, four learner-info toggles, two MCQ
// settings, page size, orientation, margins, two label styles. All of them
// matter once. None of them matter on the tenth question. So once the paper's
// required details are filled AND the paper has been filed at least once, the
// form becomes a single line the teacher can read at a glance and reopen on
// demand — the builder page becomes about questions.
//
// The "filed at least once" half is deliberate and is the same decision
// assessmentAutosave.js makes about phantom papers: a brand-new paper lands
// with the form OPEN, because on a new paper those settings ARE the task. It
// collapses after the first valid save, not on the first keystroke that happens
// to complete the last required field.
//
// Pure module: no React. Tested under plain `node`
// (scripts/test-assessment-header-summary.mjs).

import { PAGE_SIZES } from '../../config/paperLayoutTokens.js'
import { paperDisplayFacts } from './paperNaming.js'

// The fields a paper cannot print correctly without. Kept short on purpose:
// this decides whether a form is allowed to get out of the teacher's way, so
// anything optional (class, date, motto) must not be able to hold it open.
export const REQUIRED_HEADER_FIELDS = ['schoolName', 'grade', 'subject', 'assessmentType', 'term', 'year', 'duration']

/** Which required header fields are still blank. `[]` means the header is complete. */
export function missingHeaderFields(form = {}) {
  return REQUIRED_HEADER_FIELDS.filter((key) => {
    const value = form?.[key]
    if (value == null) return true
    return String(value).trim() === ''
  })
}

/** Every required header field is filled in. */
export function headerIsComplete(form = {}) {
  return missingHeaderFields(form).length === 0
}

/**
 * Should the header render as the one-line summary?
 *
 * @param {object}  form           the studio's live form
 * @param {boolean} savedOnce      this paper exists in the library (a save has
 *                                 landed, or it was opened from the library)
 * @param {boolean|null} override  the teacher's explicit open/closed choice;
 *                                 `null` = they haven't said, so the rule decides
 * @param {boolean} cursorInside   focus is currently in the header form. The
 *                                 collapse is DEFERRED while it is, never
 *                                 cancelled — see below.
 *
 * `savedOnce` flips when the 2-second library autosave lands, which is a moment
 * the teacher does not choose and cannot see coming. If it lands while they are
 * typing in the header of a new paper, the form they are typing into is
 * replaced by a one-line summary mid-keystroke: the caret goes, the half-typed
 * school name goes with it, and the next character lands nowhere. So a collapse
 * that would fire under a cursor waits for it to leave. Nothing is cancelled —
 * the moment focus moves out, the rule is re-evaluated and the header collapses
 * as it would have.
 *
 * This is the only input that is about the DOM rather than the paper, and it
 * arrives as a plain boolean so this module stays pure and node-testable.
 */
export function shouldCollapsePaperHeader({
  form, savedOnce = false, override = null, cursorInside = false,
} = {}) {
  if (override === true) return false   // the teacher opened it
  if (override === false) return true   // the teacher closed it
  if (cursorInside) return false        // deferred, not cancelled
  return Boolean(savedOnce) && headerIsComplete(form)
}

/** "A4 portrait" — the sheet, in the words the page-setup fields use. */
export function pageSetupLabel(form = {}) {
  const size = PAGE_SIZES[form?.pageSize || 'a4'] || PAGE_SIZES.a4
  const orientation = form?.orientation === 'landscape' ? 'landscape' : 'portrait'
  return `${size?.label || 'A4'} ${orientation}`
}

/** "MCQ A–D vertical" — how every multiple-choice question on this paper prints. */
export function mcqSummaryLabel(form = {}) {
  const raw = Number(form?.mcqAnswerChoiceCount)
  const count = Number.isFinite(raw) && raw >= 2 && raw <= 26 ? raw : 4
  const last = String.fromCharCode(64 + count) // 4 → 'D'
  const layout = form?.mcqOptionLayout === 'horizontal' ? 'horizontal' : 'vertical'
  return `MCQ A–${last} ${layout}`
}

/**
 * The collapsed header, as one line:
 *
 *   "Jemareen Academy · Grade 4 · Integrated Science · End of Term 1 · 2026 ·
 *    60 min · A4 portrait · MCQ A–D vertical"
 *
 * Returned as an array of segments so the renderer can decide where to wrap
 * without parsing a string back apart.
 */
export function paperHeaderSummarySegments(form = {}) {
  const facts = paperDisplayFacts(form)
  const duration = String(form?.duration ?? '').trim()
  return [
    String(form?.schoolName ?? '').trim(),
    facts.level,
    facts.subject,
    facts.typeNoTest,
    facts.year,
    duration ? `${duration} min` : '',
    pageSetupLabel(form),
    mcqSummaryLabel(form),
  ].filter(Boolean)
}

/** The same line as a single string, for titles and tests. */
export function paperHeaderSummaryLine(form = {}) {
  return paperHeaderSummarySegments(form).join(' · ')
}
