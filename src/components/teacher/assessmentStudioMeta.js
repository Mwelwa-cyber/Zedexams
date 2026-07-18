// Shared Assessment Studio paper-metadata constants. Split out of
// AssessmentStudio.jsx so the AI modals (CreatePaperModal etc.) can offer
// the same grade/subject choices without a circular import. Values are
// the studio's display values ('4', 'English') — map to KB keys with
// studioGradeToKbGrade / studioSubjectToKey when calling generators.

import { ASSESSMENT_TYPES } from './paperTaxonomy.js'

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

export const STUDIO_SUBJECTS = [
  'English',
  'Integrated Science',
  'Mathematics',
  'Social Studies',
  'Expressive Art',
  'Technology Studies',
  'Cinyanja',
  'Home Economics',
]

export const STUDIO_GRADES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

// Option / column letters (A, B, C, …) — shared by the studio shell and the
// per-question-type editors (MCQ option labels, matching column headers).
export const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
