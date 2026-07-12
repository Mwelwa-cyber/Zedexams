/**
 * Pure grade/subject taxonomy for the teacher tools.
 *
 * These lists are the single source of truth for the studio dropdowns *and*
 * for resolving human-readable labels (e.g. download filenames). They live in
 * their own side-effect-free module so plain `node` test scripts can import
 * the labels without pulling in firebase/config (which reads import.meta.env
 * and would throw outside the Vite bundle).
 *
 * teacherTools.js re-exports both so existing
 * `import { TEACHER_GRADES } from '../utils/teacherTools'` callers keep working.
 */

// Grades grouped by Zambia CBC phase. Values use the canonical G-prefix the
// backend's ALLOWED_GRADES accepts (ECE, G1–G12). Labels show the
// "Grade 8 / Form 1" dual naming so secondary teachers still recognise them.
//
// Items with `group` (no `value`) render as <optgroup> labels in FieldSelect.
export const TEACHER_GRADES = [
  { group: 'Pre-Primary (ECE)' },
  // ECE is split by age band to match the curriculum reference (the Syllabi
  // Studio carries separate "3-4 Years" and "4-5 Years" sheets). Picking a
  // band scopes the topic/sub-topic suggestions to that band's syllabus.
  // Legacy 'ECE' is still accepted by the backend for older data, but it's
  // no longer offered here — authors choose Nursery or Reception instead.
  { value: 'ECE_N', label: 'Nursery (3–4 yrs)' },
  { value: 'ECE_R', label: 'Reception (4–5 yrs)' },
  { group: 'Lower Primary (Grades 1–4)' },
  { value: 'G1', label: 'Grade 1' },
  { value: 'G2', label: 'Grade 2' },
  { value: 'G3', label: 'Grade 3' },
  { value: 'G4', label: 'Grade 4' },
  { group: 'Upper Primary (Grades 5–7)' },
  { value: 'G5', label: 'Grade 5' },
  { value: 'G6', label: 'Grade 6' },
  { value: 'G7', label: 'Grade 7' },
  { group: 'Junior Secondary (Grades 8–9)' },
  { value: 'G8', label: 'Grade 8 / Form 1' },
  { value: 'G9', label: 'Grade 9 / Form 2' },
  { group: 'Senior Secondary (Grades 10–12)' },
  { value: 'G10', label: 'Grade 10 / Form 3' },
  { value: 'G11', label: 'Grade 11 / Form 4' },
  { value: 'G12', label: 'Grade 12 / Form 5' },
]

// Subjects grouped by curriculum area across all CBC phases.
export const TEACHER_SUBJECTS = [
  { group: 'Languages' },
  { value: 'english',          label: 'English' },
  { value: 'literacy',         label: 'Literacy' },
  { value: 'cinyanja',         label: 'Cinyanja' },
  { value: 'zambian_language', label: 'Zambian Language (other)' },
  { group: 'STEM' },
  { value: 'mathematics',          label: 'Mathematics' },
  // Lower Primary (Grades 1–3) carries one combined "Maths & Science" syllabus
  // sheet, stored under the `numeracy` slug. Teachers expect the real learning-
  // area name, "Mathematics and Science" — "Numeracy" isn't a 2023-curriculum
  // subject and confused authors picking it from the studio dropdowns. The ECE
  // bands keep their own "Pre-Maths & Science" label via ECE_SUBJECTS below.
  { value: 'numeracy',             label: 'Mathematics and Science' },
  { value: 'integrated_science',   label: 'Integrated Science' },
  { value: 'environmental_science',label: 'Environmental Science' },
  { value: 'biology',              label: 'Biology' },
  { value: 'chemistry',            label: 'Chemistry' },
  { value: 'physics',              label: 'Physics' },
  { group: 'Humanities' },
  { value: 'social_studies',   label: 'Social Studies' },
  { value: 'history',          label: 'History' },
  { value: 'geography',        label: 'Geography' },
  { value: 'civic_education',  label: 'Civic Education' },
  { value: 'religious_education', label: 'Religious Education' },
  { group: 'Business' },
  { value: 'accounts',         label: 'Principles of Accounts' },
  { value: 'commerce_and_principles_of_accounts', label: 'Commerce & Principles of Accounts' },
  { group: 'Technical & Creative' },
  { value: 'technology_studies',              label: 'Technology Studies' },
  { value: 'creative_and_technology_studies', label: 'Creative & Technology Studies' },
  { value: 'design_and_technology_studies',   label: 'Design & Technology Studies' },
  { value: 'art_and_design',   label: 'Art & Design' },
  { value: 'music_and_creative_arts', label: 'Music & Creative Arts' },
  { value: 'home_economics',   label: 'Home Economics' },
  { value: 'expressive_arts',  label: 'Expressive Arts' },
  { value: 'physical_education', label: 'Physical Education' },
]

// ── Early Childhood Education (ECE) subject set ──────────────────────────
// Nursery (ECE_N, 3–4 yrs) and Reception (ECE_R, 4–5 yrs) don't use the
// general Grade-1+ subject menu. The 2023 Zambian ECE syllabus defines
// exactly FOUR learning areas — the four sheets carried in
// functions/data/curriculum-data.json under "Early Childhood Education
// Syllabi (3-5 Years)": "English Language", "Zambian Languages",
// "Pre-Maths & Science" and "Creative & Tech". The studios surface those,
// never Social Studies / Religious Education / Physical Education, which are
// only introduced from Grade 1 onwards.
//
// The `value`s deliberately reuse the canonical CBC KB subject codes the ECE
// syllabus rows are already stored under (see studioSubjectToKbSubject in
// src/utils/syllabusMapping.js — Maths & Science → `numeracy`, Creative &
// Tech → `expressive_arts`). Reusing them keeps topic/sub-topic suggestions,
// CBC grounding and the backend ALLOWED_SUBJECTS check all working with no
// extra mapping; only the learner-facing label changes for the ECE bands.
export const ECE_GRADE_CODES = ['ECE', 'ECE_N', 'ECE_R']

export const ECE_SUBJECTS = [
  { group: 'Early Childhood Education' },
  { value: 'english',          label: 'English Language' },
  { value: 'zambian_language', label: 'Zambian Languages' },
  { value: 'numeracy',         label: 'Pre-Maths & Science' },
  { value: 'expressive_arts',  label: 'Creative & Technology Studies' },
]

const ECE_SUBJECT_VALUES = new Set(
  ECE_SUBJECTS.filter((s) => s.value).map((s) => s.value),
)

/** True when `grade` is one of the ECE age-band codes (ECE / ECE_N / ECE_R). */
export function isEceGrade(grade) {
  return ECE_GRADE_CODES.includes(String(grade || '').toUpperCase())
}

// Maps each subject value to the grades it's actually taught at in the
// Zambian CBC. Used by getSubjectsForGrade() to filter the dropdown so
// teachers only see pedagogically valid combinations (no Biology for
// Grade 1, no Literacy for Grade 12). ECE bands are handled separately by
// ECE_SUBJECTS above and bypass this map.
const SUBJECT_GRADE_MAP = {
  // Languages — English & Zambian Language span everything; Literacy is
  // the lower-primary reading-and-writing strand that gives way to English.
  english:           ['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
  literacy:          ['ECE_N','ECE_R','G1','G2','G3','G4'],
  cinyanja:          ['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
  zambian_language:  ['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],

  // STEM — Numeracy is the early-grade pre-Mathematics strand. Integrated
  // Science covers all primary + junior secondary, then splits into
  // Bio/Chem/Phys at senior secondary.
  mathematics:       ['G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
  numeracy:          ['ECE_N','ECE_R','G1','G2','G3','G4'],
  integrated_science:['G1','G2','G3','G4','G5','G6','G7','G8','G9'],
  environmental_science: ['G1','G2','G3','G4'],
  biology:           ['G10','G11','G12'],
  chemistry:         ['G10','G11','G12'],
  physics:           ['G10','G11','G12'],

  // Humanities — Social Studies covers ECE through junior secondary; in
  // senior secondary it splits into History/Geography/Civic Education.
  social_studies:    ['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9'],
  history:           ['G8','G9','G10','G11','G12'],
  geography:         ['G8','G9','G10','G11','G12'],
  civic_education:   ['G5','G6','G7','G8','G9','G10','G11','G12'],
  religious_education:['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],

  // Business — Principles of Accounts is the 2013 senior-secondary subject;
  // the CBC (2023) teaches the combined Commerce & Principles of Accounts
  // across Forms 1-4 (G8-G11).
  accounts:          ['G10','G11','G12'],
  commerce_and_principles_of_accounts: ['G8','G9','G10','G11'],

  // Technical & creative — Creative & Technology Studies is the primary-
  // level integrated subject; Technology Studies and Home Economics take
  // over from upper primary onwards. Expressive Arts runs ECE–junior.
  // Design & Technology Studies, Art & Design and Music & Creative Arts are
  // the CBC (2023) Forms 1-4 electives (Art & Design also exists as a 2013
  // Grades 10-12 syllabus, so it extends to G12).
  technology_studies:['G5','G6','G7','G8','G9','G10','G11','G12'],
  creative_and_technology_studies: ['G1','G2','G3','G4','G5','G6','G7'],
  design_and_technology_studies: ['G8','G9','G10','G11'],
  art_and_design:    ['G8','G9','G10','G11','G12'],
  music_and_creative_arts: ['G8','G9','G10','G11'],
  home_economics:    ['G5','G6','G7','G8','G9','G10','G11','G12'],
  expressive_arts:   ['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9'],
  physical_education:['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
}

/**
 * Returns the subject list for a grade. ECE bands (Nursery / Reception) get
 * the dedicated four-area ECE syllabus menu; every other grade gets
 * TEACHER_SUBJECTS filtered by SUBJECT_GRADE_MAP. Group headers are kept
 * only if at least one subject in that group survives the filter. Falls back
 * to the full list if grade is unknown (e.g. a legacy URL deeplink).
 */
export function getSubjectsForGrade(grade) {
  if (!grade) return TEACHER_SUBJECTS
  // ECE (Nursery / Reception) follows its own four-area syllabus, not the
  // Grade-1+ subject menu.
  if (isEceGrade(grade)) return ECE_SUBJECTS
  const filtered = []
  let pendingGroup = null
  let groupHasItems = false
  for (const opt of TEACHER_SUBJECTS) {
    if (opt.group !== undefined) {
      pendingGroup = opt
      groupHasItems = false
      continue
    }
    const grades = SUBJECT_GRADE_MAP[opt.value]
    const allowed = !grades || grades.includes(grade)
    if (!allowed) continue
    if (pendingGroup && !groupHasItems) {
      filtered.push(pendingGroup)
      groupHasItems = true
    }
    filtered.push(opt)
  }
  // Defensive: never return an empty list. If a future grade has no
  // subject mappings at all, fall back to the full list rather than
  // showing an empty dropdown.
  return filtered.length > 0 ? filtered : TEACHER_SUBJECTS
}

/**
 * Picks a sensible default subject for a grade — used when the grade
 * changes and the previously-selected subject no longer applies.
 * Returns the first non-group option from getSubjectsForGrade().
 */
export function defaultSubjectForGrade(grade) {
  const opts = getSubjectsForGrade(grade)
  const firstSubject = opts.find((o) => o.value !== undefined)
  return firstSubject?.value || 'mathematics'
}

/**
 * True if `subject` is taught at `grade`. ECE bands are validated against the
 * ECE_SUBJECTS set; all other grades against SUBJECT_GRADE_MAP (subjects with
 * no mapping entry default to true, forward-compatible).
 */
export function isSubjectValidForGrade(subject, grade) {
  if (isEceGrade(grade)) return ECE_SUBJECT_VALUES.has(subject)
  const grades = SUBJECT_GRADE_MAP[subject]
  if (!grades) return true
  return grades.includes(grade)
}
