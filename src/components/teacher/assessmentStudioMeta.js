// Shared Assessment Studio paper-metadata constants. Split out of
// AssessmentStudio.jsx so the AI modals (CreatePaperModal etc.) can offer
// the same grade/subject choices without a circular import. Values are
// the studio's display values ('4', 'English') — map to KB keys with
// studioGradeToKbGrade / studioSubjectToKey when calling generators.

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
