/**
 * ZedExams Library Architecture — single source of truth for the academic
 * taxonomy used to organise every generated artifact.
 *
 *   Library
 *   ├── Schemes of Work
 *   ├── Weekly Forecasts
 *   ├── Syllabi              (no Term — covers the whole year)
 *   ├── Lesson Plans
 *   ├── Notes
 *   └── Assessments          (Subject → Assessment Type)
 *
 *   Each section (except Syllabi) drills down:
 *     Syllabus Type → Grade/Form → Term → Subject → [Assessment Type]
 *   Syllabi drill down:
 *     Syllabus Type → Grade/Form → Subject
 *
 * This file is consumed by:
 *   - `src/utils/libraryClassification.js`     (path computation)
 *   - `src/components/teacher/library/LibraryBrowser.jsx`  (navigation)
 *   - Studios that save artifacts (Scheme of Work, Notes, Assessment, Lesson Plan)
 *
 * Add new grades / forms / subjects HERE, never inline in components.
 */

/* ── Library sections ────────────────────────────────────────── */

export const LIBRARY_TYPES = {
  SCHEMES_OF_WORK:  'schemes_of_work',
  WEEKLY_FORECASTS: 'weekly_forecasts',
  SYLLABI:          'syllabi',
  LESSON_PLANS:     'lesson_plans',
  NOTES:            'notes',
  ASSESSMENTS:      'assessments',
}

export const LIBRARY_SECTIONS = [
  {
    id:        LIBRARY_TYPES.SCHEMES_OF_WORK,
    label:     'Schemes of Work',
    folder:    'Schemes of Work',
    icon:      '🦁',
    accent:    '#faecb8',
    hasTerm:   true,
    hasAssessmentType: false,
    createTo:  '/teacher/generate/scheme-of-work',
    emptyHint: 'Plan a whole term with a scheme of work.',
  },
  {
    id:        LIBRARY_TYPES.WEEKLY_FORECASTS,
    label:     'Weekly Forecasts',
    folder:    'Weekly Forecasts',
    icon:      '🐢',
    accent:    '#d8ecd0',
    hasTerm:   true,
    hasAssessmentType: false,
    createTo:  '/teacher/generate/weekly-forecast',
    emptyHint: 'Forecast the week ahead — topics, materials and timings.',
  },
  {
    id:        LIBRARY_TYPES.SYLLABI,
    label:     'Syllabi',
    folder:    'Syllabi',
    icon:      '🐘',
    accent:    '#fcd9c4',
    hasTerm:   false,           // syllabi span the whole year
    hasAssessmentType: false,
    createTo:  null,
    emptyHint: 'Official CDC / CBC syllabi — view-only, no subscription required.',
  },
  {
    id:        LIBRARY_TYPES.LESSON_PLANS,
    label:     'Lesson Plans',
    folder:    'Lesson Plans',
    icon:      '🦊',
    accent:    '#fde2c4',
    hasTerm:   true,
    hasAssessmentType: false,
    createTo:  '/teacher/generate/lesson-plan',
    emptyHint: 'Generate your first lesson plan to see it here.',
  },
  {
    id:        LIBRARY_TYPES.NOTES,
    label:     'Notes',
    folder:    'Notes',
    icon:      '🦉',
    accent:    '#dbe7f4',
    hasTerm:   true,
    hasAssessmentType: false,
    createTo:  '/teacher/generate/notes',
    emptyHint: 'Teacher delivery notes — hooks, examples and questions.',
  },
  {
    id:        LIBRARY_TYPES.ASSESSMENTS,
    label:     'Assessments',
    folder:    'Assessments',
    icon:      '🦅',
    accent:    '#e8d8f0',
    hasTerm:   true,
    hasAssessmentType: true,    // extra leaf level: Topic / Monthly / Mid / End
    createTo:  '/teacher/assessments/new',
    emptyHint: 'Create a topic, monthly, midterm or end-of-term assessment.',
  },
]

export const LIBRARY_SECTION_BY_ID = Object.fromEntries(
  LIBRARY_SECTIONS.map((s) => [s.id, s]),
)

/* ── Syllabus types ──────────────────────────────────────────── */
//
// CBC      — new 2023 framework (Grades 1–12)
// CDC      — old 2013 syllabus (still in use at Grades 5–7 in some schools)
// Secondary — Form 1–4 only (subject lists differ; secondary teachers
//             often use the "Form" naming so we keep a separate root)

export const SYLLABUS_TYPES = {
  CBC:       'CBC',
  CDC:       'CDC',
  SECONDARY: 'Secondary',
}

export const SYLLABUS_OPTIONS = [
  { value: SYLLABUS_TYPES.CBC,       label: 'CBC (New Syllabus)' },
  { value: SYLLABUS_TYPES.CDC,       label: 'CDC (Old Syllabus)' },
  { value: SYLLABUS_TYPES.SECONDARY, label: 'Secondary (Form 1–4)' },
]

/* ── Grades / Forms per syllabus ─────────────────────────────── */
//
// `active` flips on as we roll a grade/form out. Inactive entries still
// render in admin views but are hidden from teacher-facing dropdowns.
// Future-proofing: Grades 8–12 and Forms 2–4 are listed but disabled.

export const GRADE_FORMS = {
  [SYLLABUS_TYPES.CBC]: [
    { value: 'Grade 1',  label: 'Grade 1',  band: 'lower_primary',  active: true  },
    { value: 'Grade 2',  label: 'Grade 2',  band: 'lower_primary',  active: true  },
    { value: 'Grade 3',  label: 'Grade 3',  band: 'lower_primary',  active: true  },
    { value: 'Grade 4',  label: 'Grade 4',  band: 'upper_primary',  active: true  },
    { value: 'Grade 5',  label: 'Grade 5',  band: 'upper_primary',  active: true  },
    { value: 'Grade 6',  label: 'Grade 6',  band: 'upper_primary',  active: true  },
    { value: 'Grade 7',  label: 'Grade 7',  band: 'upper_primary',  active: true  },
    { value: 'Grade 8',  label: 'Grade 8',  band: 'junior_secondary', active: false },
    { value: 'Grade 9',  label: 'Grade 9',  band: 'junior_secondary', active: false },
    { value: 'Grade 10', label: 'Grade 10', band: 'senior_secondary', active: false },
    { value: 'Grade 11', label: 'Grade 11', band: 'senior_secondary', active: false },
    { value: 'Grade 12', label: 'Grade 12', band: 'senior_secondary', active: false },
  ],
  [SYLLABUS_TYPES.CDC]: [
    { value: 'Grade 5', label: 'Grade 5', band: 'upper_primary', active: true },
    { value: 'Grade 6', label: 'Grade 6', band: 'upper_primary', active: true },
    { value: 'Grade 7', label: 'Grade 7', band: 'upper_primary', active: true },
    { value: 'Grade 8', label: 'Grade 8', band: 'junior_secondary', active: false },
  ],
  [SYLLABUS_TYPES.SECONDARY]: [
    { value: 'Form 1', label: 'Form 1', band: 'junior_secondary', active: true  },
    { value: 'Form 2', label: 'Form 2', band: 'junior_secondary', active: false },
    { value: 'Form 3', label: 'Form 3', band: 'senior_secondary', active: false },
    { value: 'Form 4', label: 'Form 4', band: 'senior_secondary', active: false },
  ],
}

/* ── Terms ───────────────────────────────────────────────────── */

export const TERMS = [
  { value: 'Term 1', label: 'Term 1' },
  { value: 'Term 2', label: 'Term 2' },
  { value: 'Term 3', label: 'Term 3' },
]

/* ── Subjects per syllabus + grade/form ──────────────────────── */
//
// CBC Grades 1–3:  combined subjects (Mathematics & Science is ONE subject)
// CBC Grades 4–7:  fully separated subjects
// CDC Grades 5–7:  same list as CBC 4–7 (matches the Zambian CDC
//                  upper-primary syllabus that those schools still teach)
// Secondary Form 1: single-discipline subjects + accounting + ICT
//
// IMPORTANT: do NOT separate "Mathematics and Science" in Grades 1–3.

const CBC_LOWER_PRIMARY_SUBJECTS = [
  'English Language',
  'Mathematics and Science',
  'Creative and Technology Studies',
  'Literacy and Language',
  'Zambian Language',
]

const CBC_UPPER_PRIMARY_SUBJECTS = [
  'Mathematics',
  'English Language',
  'Integrated Science',
  'Social Studies',
  'Technology Studies',
  'Home Economics',
  'Expressive Arts',
  'Zambian Language',
]

// CDC Grades 5–7 mirror the CBC upper-primary list — same subjects.
const CDC_UPPER_PRIMARY_SUBJECTS = CBC_UPPER_PRIMARY_SUBJECTS

const SECONDARY_FORM_1_SUBJECTS = [
  'Physics',
  'Chemistry',
  'Mathematics',
  'English Language',
  'Geography',
  'History',
  'Religious Education',
  'Principles of Accounting',
  'Information and Communication Technology (ICT)',
]

/**
 * Returns the canonical subject list for a (syllabus, gradeForm) pair.
 * Falls back to an empty array if the combination is unknown.
 */
export function getSubjectsForGradeForm(syllabus, gradeForm) {
  if (!syllabus || !gradeForm) return []

  if (syllabus === SYLLABUS_TYPES.CBC) {
    if (['Grade 1', 'Grade 2', 'Grade 3'].includes(gradeForm)) {
      return CBC_LOWER_PRIMARY_SUBJECTS
    }
    if (['Grade 4', 'Grade 5', 'Grade 6', 'Grade 7'].includes(gradeForm)) {
      return CBC_UPPER_PRIMARY_SUBJECTS
    }
    // Grades 8–12 to be added when secondary CBC rolls out.
    return []
  }

  if (syllabus === SYLLABUS_TYPES.CDC) {
    if (['Grade 5', 'Grade 6', 'Grade 7'].includes(gradeForm)) {
      return CDC_UPPER_PRIMARY_SUBJECTS
    }
    return []
  }

  if (syllabus === SYLLABUS_TYPES.SECONDARY) {
    if (gradeForm === 'Form 1') return SECONDARY_FORM_1_SUBJECTS
    // Forms 2–4 — populated as those subject lists are confirmed.
    return []
  }

  return []
}

/* ── Assessment types per grade/form ─────────────────────────── */
//
// Grades 1–3:  Topic, Monthly, Midterm, End of Term Test
// Grades 4–8:  Topic, Monthly, End of Term Test
// Form 1:      Topic, Monthly, End of Term Test

const ASSESSMENT_TYPES_LOWER_PRIMARY = [
  { value: 'topic',       label: 'Topic Test'        },
  { value: 'monthly',     label: 'Monthly Test'      },
  { value: 'midterm',     label: 'Midterm Test'      },
  { value: 'end_of_term', label: 'End of Term Test'  },
]

const ASSESSMENT_TYPES_STANDARD = [
  { value: 'topic',       label: 'Topic Test'        },
  { value: 'monthly',     label: 'Monthly Test'      },
  { value: 'end_of_term', label: 'End of Term Test'  },
]

export function getAssessmentTypesForGradeForm(syllabus, gradeForm) {
  if (!gradeForm) return ASSESSMENT_TYPES_STANDARD
  if (syllabus === SYLLABUS_TYPES.CBC && ['Grade 1', 'Grade 2', 'Grade 3'].includes(gradeForm)) {
    return ASSESSMENT_TYPES_LOWER_PRIMARY
  }
  return ASSESSMENT_TYPES_STANDARD
}

/* ── Helpers ─────────────────────────────────────────────────── */

/**
 * Returns the active grade/form options for a syllabus type, suitable for
 * rendering in a <select> (no inactive entries — those are future-proofed
 * but hidden from teachers).
 */
export function getActiveGradeForms(syllabus) {
  return (GRADE_FORMS[syllabus] || []).filter((g) => g.active)
}

/** All grade/form values across all syllabi (used by the Library Browser). */
export function getAllGradeForms(syllabus) {
  return GRADE_FORMS[syllabus] || []
}

/**
 * Builds the canonical library folder path for a saved artifact, e.g.
 *   buildLibraryPath({ libraryType: 'schemes_of_work', syllabus: 'CBC',
 *                      gradeForm: 'Grade 4', term: 'Term 2',
 *                      subject: 'Mathematics' })
 *   → 'Schemes of Work/CBC/Grade 4/Term 2/Mathematics'
 *
 * For Syllabi the term level is omitted.
 * For Assessments the assessmentType becomes the deepest folder.
 */
export function buildLibraryPath({
  libraryType,
  syllabus,
  gradeForm,
  term,
  subject,
  assessmentType,
}) {
  const section = LIBRARY_SECTION_BY_ID[libraryType]
  if (!section) return ''
  const parts = [section.folder]
  if (syllabus)  parts.push(syllabus)
  if (gradeForm) parts.push(gradeForm)
  if (section.hasTerm && term) parts.push(term)
  if (subject)  parts.push(subject)
  if (section.hasAssessmentType && assessmentType) {
    const meta = getAssessmentTypesForGradeForm(syllabus, gradeForm)
      .find((t) => t.value === assessmentType)
    parts.push(meta?.label || assessmentType)
  }
  return parts.join('/')
}

/**
 * Normalised library coordinates ready for persistence on a Firestore doc.
 * Used by the studios on save.
 */
export function buildLibraryCoords(coords) {
  const path = buildLibraryPath(coords)
  return {
    libraryType:    coords.libraryType || null,
    syllabus:       coords.syllabus || null,
    gradeForm:      coords.gradeForm || null,
    term:           coords.term || null,
    subject:        coords.subject || null,
    assessmentType: coords.assessmentType || null,
    path,
  }
}
