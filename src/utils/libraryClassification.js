/**
 * Library classification helpers.
 *
 * The studios save artifacts using the *internal* shorthand from
 * `src/utils/teacherTools.js` — grade like 'G4', subject like 'mathematics'.
 * The library architecture (see `src/config/library.js`) uses the canonical
 * academic names — 'Grade 4', 'Mathematics'. These helpers translate
 * between the two so we can attach a `library` map to every saved doc
 * without forcing every studio form to switch its underlying value type.
 */

import {
  LIBRARY_TYPES,
  SYLLABUS_TYPES,
  buildLibraryCoords,
  getSubjectsForGradeForm,
} from '../config/library.js'

/* ── Grade / Form translation ────────────────────────────────── */

// Which syllabus an internal 'G#' code belongs to when the caller gives no
// explicit hint. Grade 7 has no CBC equivalent (CBC primary ends at Grade 6),
// so it defaults to the old OBC curriculum; everything else defaults to CBC —
// the internal secondary codes ('G8'…'G12') map onto CBC Forms 1–4 to preserve
// the long-standing library convention. An explicit `syllabusHint` always wins.
function defaultSyllabusForGradeNumber(n) {
  return n === 7 ? SYLLABUS_TYPES.OBC : SYLLABUS_TYPES.CBC
}

// Every spelling of an early-childhood year → its library folder. The folder
// labels are the `value`s in GRADE_FORMS[CBC] (src/config/library.js); the
// spellings are what the studios actually send. Lower-cased keys.
const ECE_SPELLINGS = {
  nursery: 'Nursery',
  ece_n: 'Nursery',
  'nursery class': 'Nursery',
  // Pre-dates the Nursery/Reception split and spans both years; folds onto the
  // younger one so content is pitched down rather than up.
  ece: 'Nursery',
  reception: 'Reception',
  ece_r: 'Reception',
  'reception class': 'Reception',
}

// Which syllabus an *academic* 'Grade N' label belongs to with no hint. CBC
// never labels its upper grades "Grade 7"…"Grade 12" — it uses Forms 1–4 — so
// an academic "Grade 7" or higher can only be OBC (which numbers grades 1–12).
// Grades 1–6 exist in both, so they default to CBC (the current curriculum).
function defaultSyllabusForAcademicGrade(n) {
  return n >= 7 ? SYLLABUS_TYPES.OBC : SYLLABUS_TYPES.CBC
}

// A grade *number* + its resolved syllabus → the academic grade/form label.
//
//   • OBC keeps its literal grade number all the way up (Grade 7 … Grade 12).
//   • CBC primary stays Grades 1–6; Grades 8–12 are the secondary Forms 1–4
//     (secondary now lives inside CBC — the standalone Secondary root was
//     removed). Grade 7 has no CBC slot, so it stays a literal 'Grade 7'.
//
// This is the crux of the CBC-vs-OBC fix: the same internal id ('G10') resolves
// to 'Grade 10' under OBC but 'Form 3' under CBC — so a plan the teacher built
// for OBC no longer lands in a CBC folder.
const CBC_SECONDARY_FORM = { 8: 'Form 1', 9: 'Form 2', 10: 'Form 3', 11: 'Form 4', 12: 'Form 4' }

function gradeFormForNumber(n, syllabus) {
  if (syllabus === SYLLABUS_TYPES.OBC) return `Grade ${n}`
  if (n <= 7) return `Grade ${n}`
  return CBC_SECONDARY_FORM[n] || `Grade ${n}`
}

/**
 * Resolve a `{ syllabus, gradeForm }` pair from any incoming grade hint.
 *
 * Accepts the internal shorthand ('G4', 'F1', 'ECE_N') as well as the academic
 * form ('Grade 4', 'Form 1'). When the caller passes a `syllabusHint` (the
 * curriculum the teacher actually chose in the studio) it is authoritative —
 * both for the returned `syllabus` AND for how a grade number maps to its
 * academic label, because OBC and CBC number their upper grades differently.
 */
export function resolveGradeForm(grade, syllabusHint) {
  if (!grade) return { syllabus: syllabusHint || null, gradeForm: null }
  const raw = String(grade).trim()

  // ECE. Both spellings the app produces resolve to the same folder: the
  // studio's dropdown value ('Nursery' / 'Reception', see CBC_GRADES in
  // LessonDetailsForm.jsx) and the stored ladder code ('ECE_N' / 'ECE_R', see
  // storedValueForRung in src/config/educationLevels.js). Neither used to:
  // 'Nursery' matched none of the patterns below and fell through to
  // gradeForm: null — the Unsorted pile — while 'ECE_N' resolved to 'Grade 1',
  // filing early-childhood work into a primary folder where it looked
  // correctly sorted. A bare 'ECE' predates the Nursery/Reception split and
  // folds onto Nursery, matching LEGACY_LEVEL_ALIASES in canonicalEducation.js.
  // ECE exists in CBC only, so an OBC hint cannot pull these into an OBC
  // folder — there is no such folder to pull them into.
  const ece = ECE_SPELLINGS[raw.toLowerCase()]
  if (ece) return { syllabus: SYLLABUS_TYPES.CBC, gradeForm: ece }

  // Already-academic labels are kept verbatim — the caller has already chosen
  // the exact label, so we never re-map 'Grade 10' into a Form here.
  const acadForm = raw.match(/^Form\s+(\d+)$/i)
  if (acadForm) {
    return { syllabus: syllabusHint || SYLLABUS_TYPES.CBC, gradeForm: `Form ${acadForm[1]}` }
  }
  const acadGrade = raw.match(/^Grade\s+(\d+)$/i)
  if (acadGrade) {
    const n = Number(acadGrade[1])
    return { syllabus: syllabusHint || defaultSyllabusForAcademicGrade(n), gradeForm: `Grade ${n}` }
  }

  // Internal 'F1' code → CBC Form.
  const codeForm = raw.match(/^F(\d+)$/i)
  if (codeForm) {
    return { syllabus: syllabusHint || SYLLABUS_TYPES.CBC, gradeForm: `Form ${codeForm[1]}` }
  }
  // Internal 'G4' code → syllabus-aware number mapping (the CBC/OBC crux).
  const codeGrade = raw.match(/^G(\d+)$/i)
  if (codeGrade) {
    const n = Number(codeGrade[1])
    const syllabus = syllabusHint || defaultSyllabusForGradeNumber(n)
    return { syllabus, gradeForm: gradeFormForNumber(n, syllabus) }
  }

  return { syllabus: syllabusHint || null, gradeForm: null }
}

/* ── Subject translation ─────────────────────────────────────── */

// Internal subject id → preferred academic label (matches the canonical
// strings in `src/config/library.js`). We then verify the label against
// the subject list for the resolved (syllabus, gradeForm) and snap it to
// a member of that list when available — that way Grade-3 mathematics
// becomes 'Mathematics and Science' (the combined lower-primary subject)
// instead of staying 'Mathematics'.
const SUBJECT_LABEL_MAP = {
  english:                          'English Language',
  literacy:                         'Literacy and Language',
  cinyanja:                         'Zambian Language',
  zambian_language:                 'Zambian Language',
  mathematics:                      'Mathematics',
  numeracy:                         'Mathematics and Science',
  integrated_science:               'Integrated Science',
  environmental_science:            'Integrated Science',
  biology:                          'Integrated Science',
  chemistry:                        'Chemistry',
  physics:                          'Physics',
  social_studies:                   'Social Studies',
  history:                          'History',
  geography:                        'Geography',
  civic_education:                  'Social Studies',
  religious_education:              'Religious Education',
  religious_education_2044:         'Religious Education',
  religious_education_2046:         'Religious Education',
  technology_studies:               'Technology Studies',
  creative_and_technology_studies:  'Creative and Technology Studies',
  home_economics:                   'Home Economics',
  expressive_arts:                  'Expressive Arts',
  physical_education:               'Expressive Arts',
}

const LOWER_PRIMARY_FALLBACK = {
  Mathematics:           'Mathematics and Science',
  'Integrated Science':  'Mathematics and Science',
  'Technology Studies':  'Creative and Technology Studies',
  'Expressive Arts':     'Creative and Technology Studies',
  'Home Economics':      'Creative and Technology Studies',
  'Social Studies':      'Literacy and Language',
}

/**
 * Resolve an academic subject string from any incoming subject hint.
 * Falls back to title-casing the raw value when no mapping exists.
 */
export function resolveSubject(subject, syllabus, gradeForm) {
  if (!subject) return null
  const raw = String(subject).trim()

  // Already an academic label?
  const allowed = getSubjectsForGradeForm(syllabus, gradeForm)
  if (allowed.includes(raw)) return raw

  // Map from internal id.
  const mapped = SUBJECT_LABEL_MAP[raw.toLowerCase()] || raw.replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  if (allowed.includes(mapped)) return mapped

  // Lower-primary subjects collapse — try the fallback.
  if (gradeForm && ['Grade 1', 'Grade 2', 'Grade 3'].includes(gradeForm)) {
    const collapsed = LOWER_PRIMARY_FALLBACK[mapped]
    if (collapsed && allowed.includes(collapsed)) return collapsed
  }

  return mapped
}

/* ── Term translation ────────────────────────────────────────── */

export function resolveTerm(term) {
  if (term === null || term === undefined || term === '') return null
  const raw = String(term).trim()
  if (/^\d$/.test(raw)) return `Term ${raw}`
  if (/^Term\s+\d$/i.test(raw)) return raw.replace(/term/i, 'Term').replace(/\s+/g, ' ')
  return raw
}

/* ── Public API: classify a generation / assessment ──────────── */

/**
 * Maps a raw studio payload (grade='G4', subject='mathematics', term=2)
 * to canonical library coords {libraryType, syllabus, gradeForm, term,
 * subject, assessmentType, path}. Returns null if `libraryType` is missing.
 */
export function classifyForLibrary({
  libraryType,
  syllabusHint,
  grade,
  term,
  subject,
  assessmentType,
}) {
  if (!libraryType) return null
  const { syllabus, gradeForm } = resolveGradeForm(grade, syllabusHint)
  const academicSubject = resolveSubject(subject, syllabus, gradeForm)
  const academicTerm = resolveTerm(term)
  return buildLibraryCoords({
    libraryType,
    syllabus,
    gradeForm,
    term: academicTerm,
    subject: academicSubject,
    assessmentType: assessmentType || null,
  })
}

/* ── Tool → library type lookup ──────────────────────────────── */
//
// Used by the library list view to bucket existing aiGenerations whose
// `library` field hasn't been backfilled yet (legacy rows).

export const TOOL_TO_LIBRARY_TYPE = {
  lesson_plan:       LIBRARY_TYPES.LESSON_PLANS,
  'lesson-plan':     LIBRARY_TYPES.LESSON_PLANS,
  scheme_of_work:    LIBRARY_TYPES.SCHEMES_OF_WORK,
  weekly_forecast:   LIBRARY_TYPES.WEEKLY_FORECASTS,
  record_of_work:    LIBRARY_TYPES.RECORDS_OF_WORK,
  mark_schedule:     LIBRARY_TYPES.MARK_SCHEDULES,
  class_timetable:   LIBRARY_TYPES.CLASS_TIMETABLES,
  notes:             LIBRARY_TYPES.NOTES,
  worksheet:         LIBRARY_TYPES.ASSESSMENTS, // worksheets read as assessments
  rubric:            LIBRARY_TYPES.ASSESSMENTS,
  homework:          LIBRARY_TYPES.ASSESSMENTS, // matches HomeworkStudio's attach
  full_lesson:       LIBRARY_TYPES.LESSON_PLANS, // retired studio; historical lessons file here
  sba_task:          LIBRARY_TYPES.SBA_TASKS,
  sba_mark_sheet:    LIBRARY_TYPES.SBA_MARK_SHEETS,
  sba_plan:          LIBRARY_TYPES.SBA_PLANS,
  flashcards:        LIBRARY_TYPES.NOTES,
}
