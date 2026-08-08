/**
 * How a past paper NAMES ITSELF on screen — composed from its structured
 * fields, shortened by dropping whole low-priority words.
 *
 * THE BUG THIS FIXES is the same class the assessment studio's `DocTitle`
 * already hit (`src/components/teacher/paperNaming.js`): one pre-built string
 * with a CSS ellipsis. In the subject card list that produced
 * "Grade 7 Integrated Sci…", which throws away the year, the paper number and
 * — since identity moved into structured fields — the SOURCE. An ellipsis
 * cannot know that "ECZ" is worth more than "Integrated". So the title is
 * composed at three widths and degrades by a declared priority instead:
 *
 *     subject → paper number → source label → year → grade
 *
 * Most important first. Whatever the width, the facts that survive are taken
 * from the front of that list, and a fact is dropped WHOLE — never cut.
 *
 * The mechanism (measure the container, pick a width tier, join with the same
 * separators) is shared with the studio through `src/utils/responsiveTitle.js`
 * rather than written twice. What is NOT shared is the priority order: an
 * assessment paper's distinguishing facts are its term and type, a past
 * paper's are its source and year, and folding those into one ordering would
 * make both wrong.
 *
 * Pure module — no React, no Firebase, no DOM — so the plain-node suite
 * imports it directly and the component is a thin renderer over it.
 */

import {
  isOfficialSource,
  normalizePaperNumberToken,
  normalizeSourceId,
  paperNumberLabel,
  paperSourceDescriptor,
  paperSourceLabel,
} from '../config/paperSources.js'
import { PAPER_SUBJECTS } from '../config/curriculum.js'
import { joinDot, pickWidthTier } from './responsiveTitle.js'
import { normalizeGrade, normalizeSubjectId, normalizeYear } from './pastPaperNormalize.js'
import { derivePaperQuizStatus, QUIZ_PENDING_COPY, QUIZ_STATUSES } from './pastPaperQuizStatus.js'

/**
 * Container-width thresholds, in CSS pixels, for the composed row title.
 * These are CONTAINER widths, not viewport widths: the row's subject tile,
 * quiz button and bookmark button take room the viewport says nothing about,
 * so a 360px phone leaves the title roughly 210px.
 */
export const PAPER_TITLE_WIDE = 340
export const PAPER_TITLE_MEDIUM = 240

/** Everything the names are built from, derived once. */
export function paperTitleFacts(paper = {}) {
  const grade = normalizeGrade(paper?.grade)
  const subjectId = normalizeSubjectId(paper?.subject)
  const entry = PAPER_SUBJECTS.find((s) => s.id === subjectId)
  const source = normalizeSourceId(paper?.source)
  const numberToken = normalizePaperNumberToken(paper?.paperNumber)
  const quizStatus = derivePaperQuizStatus(paper)
  return {
    grade: grade ? `Grade ${grade}` : '',
    subject: entry?.label || subjectId || '',
    // The short subject form is what survives at the narrowest width — the
    // curriculum's own abbreviation, never a machine truncation.
    subjectShort: entry?.shortLabel || entry?.label || subjectId || '',
    number: paperNumberLabel(numberToken) || '',
    source,
    sourceLabel: paperSourceLabel(source) || '',
    descriptor: paperSourceDescriptor(source) || '',
    isOfficial: isOfficialSource(source),
    year: normalizeYear(paper?.year) || '',
    // `session` names WHICH sitting ('october', 'mock', 'trial'). It stands in
    // for the year on line 2 when a paper states one, because "October 2025"
    // tells two same-year papers apart and a bare year does not.
    session: readSession(paper?.session),
    quizStatus,
    quizLabel: quizStatus === QUIZ_STATUSES.ATTACHED
      ? 'Quiz ready'
      : QUIZ_PENDING_COPY.learnerHeading,
  }
}

function readSession(value) {
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  if (!raw) return ''
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}

/**
 * The full, uncut name — the viewer header, exports, and the stored `title`.
 *
 * Deliberately identical in shape to `derivedPaperTitle` in
 * `pastPaperNormalize.js` (which the write path uses, and which must not
 * import display code): `paperTitleCore.test.js` fails if the two drift, so
 * the name on the card and the name in the document stay one name.
 */
export function fullPaperTitle(paper = {}) {
  const f = paperTitleFacts(paper)
  const head = [f.grade, f.subject].filter(Boolean).join(' ')
  const tail = joinDot([f.number, f.sourceLabel, f.year])
  const composed = [head, tail].filter(Boolean).join(' — ')
  return composed || String(paper?.title ?? '').trim() || 'Untitled past paper'
}

/**
 * The composed title for a given available width.
 *
 * Returns `{ mode, line1, line2, facts }`:
 *   • wide   — "Integrated Science · Paper 1 · ECZ · 2025"
 *   • medium — "Integrated Science · Paper 1 · ECZ"      (year moves to line 2)
 *   • narrow — line1 "Integrated Sci."                    (the curriculum's own
 *              short form, not a truncation)
 *              line2 "Paper 1 · ECZ"
 *
 * Grade is the first fact dropped and the last to return: every row in the
 * archive sits under a grade the page already states in its heading, so
 * repeating it costs the one fact that is not repeated anywhere.
 */
export function composePaperTitle(paper = {}, { width = PAPER_TITLE_WIDE } = {}) {
  const f = paperTitleFacts(paper)
  const mode = pickWidthTier(width, {
    wide: PAPER_TITLE_WIDE,
    medium: PAPER_TITLE_MEDIUM,
  })

  if (mode === 'wide') {
    return { mode, line1: joinDot([f.subject, f.number, f.sourceLabel, f.year]), line2: '', facts: f }
  }
  if (mode === 'medium') {
    return { mode, line1: joinDot([f.subject, f.number, f.sourceLabel]), line2: '', facts: f }
  }
  return {
    mode,
    line1: f.subjectShort || f.subject || 'Past paper',
    line2: joinDot([f.number, f.sourceLabel]),
    facts: f,
  }
}

/**
 * The row variant's two lines, as the card list renders them.
 *
 * Line 1 is the badge + the paper number: the two facts a learner scans a
 * subject card for. Line 2 is the secondary context — what kind of paper this
 * is, which sitting, and whether its quiz is ready. The badge itself is
 * rendered by the component (it is a chip, not a word), so this returns the
 * pieces rather than a sentence.
 */
export function composePaperRow(paper = {}) {
  const f = paperTitleFacts(paper)
  return {
    badge: {
      label: f.sourceLabel || 'Unlabelled',
      isOfficial: f.isOfficial,
      source: f.source,
    },
    // A paper with no number is not given a fake one; the badge carries the
    // whole of line 1 in that case.
    numberLabel: f.number,
    secondary: joinDot([f.descriptor, f.session || f.year, f.quizLabel]),
    facts: f,
  }
}
