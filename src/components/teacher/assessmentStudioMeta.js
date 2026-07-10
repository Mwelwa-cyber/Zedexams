// Shared Assessment Studio paper-metadata constants. Split out of
// AssessmentStudio.jsx so the AI modals (CreatePaperModal etc.) can offer
// the same grade/subject choices without a circular import. Values are
// the studio's display values ('4', 'English') — map to KB keys with
// studioGradeToKbGrade / studioSubjectToKey when calling generators.

// Canonical assessment-type labels. Single source of truth — imported by
// AssessmentStudio.jsx and AssessmentList.jsx so the two surfaces never drift.
// The list stays comprehensive: selectable types are a subset controlled by the
// studio variant (getStudioVariant), while legacy keys are retained so papers
// saved before the type list was trimmed still render a readable label.
export const ASSESSMENT_TYPE_LABELS = {
  topic: 'Topic Test',
  weekly: 'Weekly Test',
  mid_term: 'Mid-Term Test',
  end_of_term: 'End-of-Term Test',
  mock: 'Mock Exam',
  examination: 'Examination',
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
