/**
 * ZedExams Library Architecture — single source of truth for the academic
 * taxonomy used to organise every generated artifact.
 *
 *   Library
 *   ├── Schemes of Work
 *   ├── Weekly Forecasts
 *   ├── Records of Work
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
  RECORDS_OF_WORK:  'records_of_work',
  SYLLABI:          'syllabi',
  LESSON_PLANS:     'lesson_plans',
  NOTES:            'notes',
  ASSESSMENTS:      'assessments',
  SBA_TASKS:        'sba_tasks',
  SBA_MARK_SHEETS:  'sba_mark_sheets',
  SBA_PLANS:        'sba_plans',
  MARK_SCHEDULES:   'mark_schedules',
  CLASS_TIMETABLES: 'class_timetables',
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
    id:        LIBRARY_TYPES.RECORDS_OF_WORK,
    label:     'Records of Work',
    folder:    'Records of Work',
    icon:      '🦒',
    accent:    '#f3dede',
    hasTerm:   true,
    hasAssessmentType: false,
    createTo:  '/teacher/generate/record-of-work',
    emptyHint: 'Log what you actually taught each week — checked against your scheme.',
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
    emptyHint: 'Official OBC / CBC syllabi — view-only, no subscription required.',
  },
  {
    id:        LIBRARY_TYPES.LESSON_PLANS,
    label:     'Lesson Plans',
    folder:    'Lesson Plans',
    icon:      '🦊',
    accent:    '#fde2c4',
    hasTerm:   true,
    hasAssessmentType: false,
    createTo:  '/teacher/lesson-plans/new',
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
    label:     'Assessment Papers',
    // `folder` feeds the persisted `path` breadcrumb on saved docs — keep it
    // as 'Assessments' so papers saved before the Test Paper Studio / Exam
    // Studio merge into one Assessment Paper Studio group together with new
    // ones (the library keys off libraryType, not the path string, so this
    // is the stable choice).
    folder:    'Assessments',
    icon:      '🦅',
    accent:    '#e8d8f0',
    hasTerm:   true,
    hasAssessmentType: true,    // extra leaf level: Topic / Weekly / Mid / End / Mock / Examination
    createTo:  '/teacher/assessment-papers/new',
    emptyHint: 'Create a topic test, end-of-term test, or examination paper.',
  },
  {
    id:        LIBRARY_TYPES.SBA_TASKS,
    label:     'SBA Tasks',
    folder:    'SBA Tasks',
    icon:      '🏫',
    accent:    '#d8e6f0',
    hasTerm:   true,
    hasAssessmentType: false,
    createTo:  '/teacher/generate/sba',
    emptyHint: 'Create an ECZ School Based Assessment task (Grades 5–7) with its marking scheme.',
  },
  {
    id:        LIBRARY_TYPES.SBA_MARK_SHEETS,
    label:     'SBA Mark Sheets',
    folder:    'SBA Mark Sheets',
    icon:      '🧮',
    accent:    '#dcefe2',
    hasTerm:   false,           // an SBA grade spans the whole year
    hasAssessmentType: false,
    createTo:  '/teacher/generate/sba-tracker',
    emptyHint: 'Track SBA task marks — the converted 10%-per-grade mark, OMES-ready.',
  },
  {
    id:        LIBRARY_TYPES.SBA_PLANS,
    label:     'SBA Plans',
    folder:    'SBA Plans',
    icon:      '🗂️',
    accent:    '#dbe7f4',
    hasTerm:   false,           // an SBA plan covers the whole grade-year
    hasAssessmentType: false,
    createTo:  '/teacher/generate/sba-planner',
    emptyHint: 'Track which ECZ tasks are planned, administered and marked across the year.',
  },
  {
    id:        LIBRARY_TYPES.MARK_SCHEDULES,
    label:     'Mark Schedules',
    folder:    'Mark Schedules',
    icon:      '🦓',
    accent:    '#dcefe2',
    hasTerm:   true,
    hasAssessmentType: false,
    createTo:  '/teacher/generate/mark-schedule',
    emptyHint: 'Enter marks once — totals, positions and report comments are calculated for you.',
  },
  {
    id:        LIBRARY_TYPES.CLASS_TIMETABLES,
    label:     'Class Timetables',
    folder:    'Class Timetables',
    icon:      '🗓️',
    accent:    '#e3dcf5',
    hasTerm:   true,
    hasAssessmentType: false,
    createTo:  '/teacher/generate/class-timetable',
    emptyHint: 'Build a weekly class timetable from the curriculum subjects.',
  },
]

export const LIBRARY_SECTION_BY_ID = Object.fromEntries(
  LIBRARY_SECTIONS.map((s) => [s.id, s]),
)

/* ── Syllabus types ──────────────────────────────────────────── */
//
// CBC      — Competence-Based Curriculum, the new framework. Mirrors the
//            studio grade picker (see LessonDetailsForm): Grades 1–6
//            (lower + upper primary) then Forms 1–4 (secondary). There is
//            NO Grade 7 under CBC — primary ends at Grade 6 and the Forms
//            begin. Grade 7 belongs to the old OBC curriculum below.
// OBC      — Outcome-Based Curriculum, the old syllabus being phased out
//            Still in use: G3, G5, G6, G7, G10, G11, G12
//
// NOTE: there is no separate "Secondary" syllabus root any more — secondary
// lives inside CBC as Forms 1–4. SYLLABUS_TYPES.SECONDARY is kept only so
// any legacy doc whose saved path begins "…/Secondary/…" still resolves a
// constant; it is no longer offered as a selectable folder.

export const SYLLABUS_TYPES = {
  CBC:       'CBC',
  OBC:       'OBC',
  SECONDARY: 'Secondary', // deprecated — legacy paths only, not selectable
}

export const SYLLABUS_OPTIONS = [
  { value: SYLLABUS_TYPES.CBC, label: 'CBC — Competence-Based Curriculum (New)' },
  { value: SYLLABUS_TYPES.OBC, label: 'OBC — Outcome-Based Curriculum (Old)' },
]

/* ── Grades / Forms per syllabus ─────────────────────────────── */
//
// `active` flips on as we roll a grade/form out. Inactive entries still
// render in admin views but are hidden from teacher-facing dropdowns.
// CBC matches the studio: Nursery, Reception, Grades 1–6 then Forms 1–4 (no
// Grade 7). The studio's own list is CBC_GRADES in
// src/features/lessonPlanStudio/components/sections/LessonDetailsForm.jsx —
// a grade offered there but missing here has no folder to land in, which is
// exactly how Nursery and Reception spent their first months filing into
// Unsorted. Keep the two in step.

export const GRADE_FORMS = {
  [SYLLABUS_TYPES.CBC]: [
    // ECE. The 2013 (OBC) syllabus declares no early-childhood years, which is
    // why these appear under CBC only — see levelsForFramework() in
    // src/config/educationLevels.js, the ladder these two mirror.
    { value: 'Nursery',   label: 'Nursery',   band: 'early_childhood', active: true },
    { value: 'Reception', label: 'Reception', band: 'early_childhood', active: true },
    { value: 'Grade 1', label: 'Grade 1', band: 'lower_primary',    active: true },
    { value: 'Grade 2', label: 'Grade 2', band: 'lower_primary',    active: true },
    { value: 'Grade 3', label: 'Grade 3', band: 'lower_primary',    active: true },
    { value: 'Grade 4', label: 'Grade 4', band: 'upper_primary',    active: true },
    { value: 'Grade 5', label: 'Grade 5', band: 'upper_primary',    active: true },
    { value: 'Grade 6', label: 'Grade 6', band: 'upper_primary',    active: true },
    { value: 'Form 1',  label: 'Form 1',  band: 'junior_secondary', active: true },
    { value: 'Form 2',  label: 'Form 2',  band: 'junior_secondary', active: true },
    { value: 'Form 3',  label: 'Form 3',  band: 'senior_secondary', active: true },
    { value: 'Form 4',  label: 'Form 4',  band: 'senior_secondary', active: true },
  ],
  // OBC numbers every year, Grade 1 → Grade 12, and keeps those numbers in the
  // library rather than renaming its upper years to Forms. That is deliberate
  // and load-bearing: thousands of saved documents are filed under 'Grade 10',
  // so this list does NOT follow src/config/educationLevels.js, which names the
  // same years Form 3/4/5. See the note on the CBC list above.
  //
  // Grades 1, 2, 4 and 8 were missing until 2026-08 — the studio offered them
  // (PREVIOUS_GRADES in features/lessonPlanStudio/lib/studioGrades.js) with no
  // folder here to receive them, so those plans landed on a grey orphan tile.
  // test:studio-grades now walks both lists and fails if they drift again.
  [SYLLABUS_TYPES.OBC]: [
    { value: 'Grade 1',  label: 'Grade 1',  band: 'lower_primary',   active: true },
    { value: 'Grade 2',  label: 'Grade 2',  band: 'lower_primary',   active: true },
    { value: 'Grade 3',  label: 'Grade 3',  band: 'lower_primary',   active: true },
    { value: 'Grade 4',  label: 'Grade 4',  band: 'lower_primary',   active: true },
    { value: 'Grade 5',  label: 'Grade 5',  band: 'upper_primary',   active: true },
    { value: 'Grade 6',  label: 'Grade 6',  band: 'upper_primary',   active: true },
    { value: 'Grade 7',  label: 'Grade 7',  band: 'upper_primary',   active: true },
    { value: 'Grade 8',  label: 'Grade 8',  band: 'junior_secondary', active: true },
    // Grade 9 is a real 2013 year with no sheet in curriculum-data-2013.json,
    // so the Lesson Plan Studio cannot offer it. The folder exists anyway —
    // this list describes the curriculum, not one studio's reach, and a
    // document arriving from anywhere else needs somewhere to land.
    { value: 'Grade 9',  label: 'Grade 9',  band: 'junior_secondary', active: true },
    { value: 'Grade 10', label: 'Grade 10', band: 'senior_secondary', active: true },
    { value: 'Grade 11', label: 'Grade 11', band: 'senior_secondary', active: true },
    { value: 'Grade 12', label: 'Grade 12', band: 'senior_secondary', active: true },
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
// CBC Grades 4–6:  fully separated subjects
// CBC Forms 1–2:   junior-secondary subjects
// CBC Forms 3–4:   senior-secondary subjects (sciences split out)
// OBC Grade 3:     same combined list as CBC Grades 1–3
// OBC Grades 5–7:  same list as CBC upper primary
// OBC Grades 10–12: senior secondary subjects
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

// CBC junior secondary (Forms 1–2) — broad, integrated offering.
const CBC_JUNIOR_SECONDARY_SUBJECTS = [
  'English Language',
  'Mathematics',
  'Integrated Science',
  'Social Studies',
  'Civic Education',
  'Geography',
  'History',
  'Religious Education',
  'Business Studies',
  'Computer Studies',
  'Home Economics',
  'Design and Technology',
  'Expressive Arts',
  'Agricultural Science',
  'Zambian Language',
]

// CBC senior secondary (Forms 3–4) — sciences split into separate
// disciplines and commercial subjects added.
const CBC_SENIOR_SECONDARY_SUBJECTS = [
  'English Language',
  'Mathematics',
  'Additional Mathematics',
  'Biology',
  'Chemistry',
  'Physics',
  'Science',
  'Geography',
  'History',
  'Civic Education',
  'Religious Education',
  'Commerce',
  'Principles of Accounts',
  'Business Studies',
  'Computer Studies',
  'Agricultural Science',
  'Food and Nutrition',
  'Home Management',
  'Art and Design',
  'Physical Education',
]

// OBC Grades 5–7 mirror the CBC upper-primary list — same subjects.
const OBC_UPPER_PRIMARY_SUBJECTS = CBC_UPPER_PRIMARY_SUBJECTS

const OBC_SENIOR_SECONDARY_SUBJECTS = [
  'Mathematics',
  'English Language',
  'Biology',
  'Chemistry',
  'Physics',
  'Integrated Science',
  'History',
  'Geography',
  'Civic Education',
  'Religious Education',
  'Physical Education',
  'Agricultural Science',
  'Art and Design',
  'Food and Nutrition',
  'Home Management',
  'Technology Studies',
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
    if (['Grade 4', 'Grade 5', 'Grade 6'].includes(gradeForm)) {
      return CBC_UPPER_PRIMARY_SUBJECTS
    }
    if (['Form 1', 'Form 2'].includes(gradeForm)) {
      return CBC_JUNIOR_SECONDARY_SUBJECTS
    }
    if (['Form 3', 'Form 4'].includes(gradeForm)) {
      return CBC_SENIOR_SECONDARY_SUBJECTS
    }
    return []
  }

  if (syllabus === SYLLABUS_TYPES.OBC) {
    if (gradeForm === 'Grade 3') return CBC_LOWER_PRIMARY_SUBJECTS
    if (['Grade 5', 'Grade 6', 'Grade 7'].includes(gradeForm)) return OBC_UPPER_PRIMARY_SUBJECTS
    if (['Grade 10', 'Grade 11', 'Grade 12'].includes(gradeForm)) return OBC_SENIOR_SECONDARY_SUBJECTS
    return []
  }

  return []
}

/* ── Assessment types per grade/form ─────────────────────────── */
//
// Grades 1–3:     Topic, Monthly, Midterm, End of Term Test
// Grades 4–6:     Topic, Monthly, End of Term Test
// Forms 1–4:      Topic, Monthly, End of Term Test

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
