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
} from '../config/library'

/* ── Grade / Form translation ────────────────────────────────── */

// Internal teacherTools value → academic gradeForm + default syllabus.
// Multiple grades map to multiple academic levels; for ECE we treat it as
// CBC Grade 1 because the library has no separate ECE bucket yet.
const GRADE_FORM_MAP = {
  ECE: { syllabus: SYLLABUS_TYPES.CBC, gradeForm: 'Grade 1' },
  G1:  { syllabus: SYLLABUS_TYPES.CBC, gradeForm: 'Grade 1' },
  G2:  { syllabus: SYLLABUS_TYPES.CBC, gradeForm: 'Grade 2' },
  G3:  { syllabus: SYLLABUS_TYPES.CBC, gradeForm: 'Grade 3' },
  G4:  { syllabus: SYLLABUS_TYPES.CBC, gradeForm: 'Grade 4' },
  G5:  { syllabus: SYLLABUS_TYPES.CBC, gradeForm: 'Grade 5' },
  G6:  { syllabus: SYLLABUS_TYPES.CBC, gradeForm: 'Grade 6' },
  G7:  { syllabus: SYLLABUS_TYPES.CBC, gradeForm: 'Grade 7' },
  G8:  { syllabus: SYLLABUS_TYPES.SECONDARY, gradeForm: 'Form 1' },
  G9:  { syllabus: SYLLABUS_TYPES.SECONDARY, gradeForm: 'Form 2' },
  G10: { syllabus: SYLLABUS_TYPES.SECONDARY, gradeForm: 'Form 3' },
  G11: { syllabus: SYLLABUS_TYPES.SECONDARY, gradeForm: 'Form 4' },
  G12: { syllabus: SYLLABUS_TYPES.SECONDARY, gradeForm: 'Form 4' }, // best-effort mapping
}

/**
 * Resolve a `{ syllabus, gradeForm }` pair from any incoming grade hint.
 * Accepts the internal 'G4' form as well as the academic 'Grade 4' form.
 */
export function resolveGradeForm(grade, syllabusHint) {
  if (!grade) return { syllabus: syllabusHint || null, gradeForm: null }
  const raw = String(grade).trim()
  if (GRADE_FORM_MAP[raw]) {
    return {
      syllabus:  syllabusHint || GRADE_FORM_MAP[raw].syllabus,
      gradeForm: GRADE_FORM_MAP[raw].gradeForm,
    }
  }
  // Already in academic form? e.g. 'Grade 4' or 'Form 1'.
  if (/^Grade\s+\d+$/i.test(raw)) {
    return {
      syllabus:  syllabusHint || SYLLABUS_TYPES.CBC,
      gradeForm: raw.replace(/\s+/g, ' ').replace(/grade/i, 'Grade'),
    }
  }
  if (/^Form\s+\d+$/i.test(raw)) {
    return {
      syllabus:  syllabusHint || SYLLABUS_TYPES.SECONDARY,
      gradeForm: raw.replace(/\s+/g, ' ').replace(/form/i, 'Form'),
    }
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
  notes:             LIBRARY_TYPES.NOTES,
  worksheet:         LIBRARY_TYPES.ASSESSMENTS, // worksheets read as assessments
  rubric:            LIBRARY_TYPES.ASSESSMENTS,
  flashcards:        LIBRARY_TYPES.NOTES,
}
