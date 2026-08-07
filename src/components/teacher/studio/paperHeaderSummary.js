// The one-line summary the Paper Header collapses to once it is filled in.
//
// The builder is supposed to be about QUESTIONS. The header form is thirteen
// controls — school, class, grade, type, term, year, curriculum, subject, paper
// name, duration, date, learner-info toggles, MCQ options, page setup — and it
// sits above every question on the paper, so a teacher scrolls past the whole
// of it every time they come back to a paper they already set up. Once the
// required fields are answered there is nothing left to decide, so the form
// collapses to a sentence that STATES those answers, with one Edit affordance
// back into the full form.
//
// Two rules keep the collapse honest:
//
//   • it only collapses when the header is genuinely complete
//     (headerIsComplete) — a summary that reads "· · 2026 · 60 min" would be
//     hiding the fields that still need answering, which is the opposite of
//     what it is for;
//   • every fact in the summary is read from the form, never defaulted. A
//     field the paper does not state is left OUT of the sentence rather than
//     printed with a guess.
//
// Pure module: no React, no Firebase, no DOM. Tested under plain `node`
// (scripts/test-paper-header-summary.mjs).

import { paperGradeLabel } from '../paperTaxonomy.js'
import { PAGE_SIZES, normalizePageSize, normalizeOrientation } from '../../../config/paperLayoutTokens.js'
import { CHOICE_COUNT_OPTIONS, resolveChoiceCount } from '../../../utils/mcqChoices.js'
import { typeForms } from './docTitleParts.js'

/**
 * The fields a paper cannot print without. Deliberately the same two the form
 * marks with a `*` (school name, subject) plus the grade the title opens with —
 * not "every field", because most of the header has a working default and
 * blocking the collapse on those would mean it never collapsed.
 */
export function missingHeaderFields(form = {}) {
  const missing = []
  if (!String(form?.schoolName ?? '').trim()) missing.push('School name')
  if (!String(form?.subject ?? '').trim()) missing.push('Subject')
  if (!String(form?.grade ?? '').trim()) missing.push('Grade / level')
  return missing
}

/** True when the header states everything the summary would have to show. */
export function headerIsComplete(form = {}) {
  return missingHeaderFields(form).length === 0
}

/** "A4 portrait" — omitted entirely when the form states no page size. */
export function pageSetupPhrase(form = {}) {
  if (!form?.pageSize && !form?.orientation) return ''
  const size = PAGE_SIZES[normalizePageSize(form?.pageSize)]
  return `${size.label} ${normalizeOrientation(form?.orientation)}`
}

/** "MCQ A–D vertical" — the two decisions that change every MCQ on the paper. */
export function mcqPhrase(form = {}) {
  const count = resolveChoiceCount({ paper: form })
  const option = CHOICE_COUNT_OPTIONS.find((o) => o.value === count)
  if (!option) return ''
  const layout = form?.mcqOptionLayout === 'horizontal' ? 'horizontal' : 'vertical'
  return `MCQ ${option.label} ${layout}`
}

/**
 * The summary sentence:
 *
 *   "Jemareen Academy · Grade 4 · Integrated Science · End of Term 1 · 2026 ·
 *    60 min · A4 portrait · MCQ A–D vertical"
 *
 * @returns {string[]} the segments, so the caller can render them as separate
 *   nodes (and so a test can assert on facts rather than on punctuation).
 */
export function headerSummarySegments(form = {}) {
  const duration = Number(form?.duration)
  return [
    String(form?.schoolName ?? '').trim(),
    String(form?.className ?? '').trim() ? `Class ${String(form.className).trim()}` : '',
    form?.grade ? paperGradeLabel(form.grade) : '',
    String(form?.subject ?? '').trim(),
    // The type form already folds in the term where the type takes one ("End
    // of Term 1", "Term 2 Topic Test"), so there is never a separate Term
    // segment: it would either repeat the term, or hand one to an examination,
    // which covers the whole syllabus and does not have one.
    typeForms(form).medium,
    String(form?.paperName ?? '').trim(),
    form?.year ? String(form.year) : '',
    Number.isFinite(duration) && duration > 0 ? `${duration} min` : '',
    pageSetupPhrase(form),
    mcqPhrase(form),
  ].filter(Boolean)
}

/** The same summary as one string. */
export function headerSummaryLine(form = {}) {
  return headerSummarySegments(form).join(' · ')
}
