// Shared Assessment Studio paper-metadata constants. Split out of
// AssessmentStudio.jsx so the AI modals (CreatePaperModal etc.) can offer
// the same grade/subject choices without a circular import. Values are
// the studio's display values ('4', 'English') — map to KB keys with
// studioGradeToKbGrade / studioSubjectToKey when calling generators.

import { ASSESSMENT_TYPES } from '../../../shared/utils/paperTaxonomy.js'
import { CANONICAL_SUBJECTS, CANONICAL_GRADES, subjectName } from '../../../config/canonicalEducation.js'

// Display labels for every selectable assessment type PLUS every legacy/
// route-scoped value a saved paper might still carry. The canonical 7 types
// (paperTaxonomy.js's ASSESSMENT_TYPES registry — the single source of truth
// used by the picker, generation and normalization) are spread in last so
// they always win; the entries above them are purely for rendering a
// readable label on old documents whose stored value predates the current
// type list (they're folded onto a canonical type by normalizeAssessmentType
// for anything besides display — filtering, generation, routing).
export const ASSESSMENT_TYPE_LABELS = {
  topic: 'Topic Test',
  weekly: 'Weekly Test',
  mock: 'Mock Exam',
  exam: 'Exam',
  monthly: 'Monthly test',
  diagnostic: 'Diagnostic / baseline',
  pre_test: 'Pre-test',
  post_test: 'Post-test',
  revision: 'Revision test',
  continuous: 'Continuous assessment',
  summative: 'Summative assessment',
  practical: 'Practical assessment',
  oral: 'Oral assessment',
  project: 'Project-based assessment',
  ...Object.fromEntries(Object.entries(ASSESSMENT_TYPES).map(([k, v]) => [k, v.label])),
}

/**
 * Every subject name a paper may carry, from the canonical model.
 *
 * This was a local list of eight labels — 'Integrated Science', 'Expressive
 * Art', 'Cinyanja', 'English' — that existed nowhere else in the product, so a
 * paper's subject could never be matched to a timetable slot, a scheme of work
 * or a syllabus without a per-pair alias table. The studio's live picker has
 * been syllabus-backed for a while (useStudioSubjectChoices); what remained
 * hardcoded here is the vocabulary the lesson-kit deep link speaks, which is
 * why a kit could hand the studio a subject the syllabus does not know.
 *
 * Names come from the canonical model, which takes them from the Syllabus
 * Studio — so 'Science' rather than 'Integrated Science' under the CBC.
 */
export const STUDIO_SUBJECTS = CANONICAL_SUBJECTS.map((s) => subjectName(s.id))

/**
 * The grade values the studio's header accepts, from the canonical ladder.
 *
 * Papers store bare numbers for primary and the G-code for secondary (see
 * educationLevels.js), which is the scheme reproduced here. The list previously
 * stopped at '12' and had no ECE bands at all, so a Nursery paper's grade was
 * not a value the studio recognised.
 */
export const STUDIO_GRADES = CANONICAL_GRADES.map((g) => (
  g.stage === 'ece' || g.formNumber != null ? g.code : String(g.gradeNumber)
))

// The terms a Zambian school year has. Declared HERE rather than in
// AssessmentStudio.jsx so the small shared pieces (the paper-details sheet, the
// header summary) can read it without importing the 3,700-line studio module
// back into themselves.
export const TERMS = ['1', '2', '3']

// Option / column letters (A, B, C, …) — shared by the studio shell and the
// per-question-type editors (MCQ option labels, matching column headers).
export const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
