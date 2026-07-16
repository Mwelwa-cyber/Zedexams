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

// ── Per-curriculum grade/form structures ─────────────────────────────────────
// Each curriculum has its OWN stage layout — they are deliberately NOT a shared
// generic Grade 1–12 list:
//   • CBC (2023, 3-6-4 restructure): ECE bands, primary Grades 1–6 (Grade 7 was
//     abolished), secondary Forms 1–4 (stored as G8–G11 — the same Form N →
//     G(N+7) fold paperTaxonomy + the syllabus KB use). No Grade 12.
//   • Previous (2013): Grades 1–7 primary, Grades 8–12 secondary (dual-named
//     with the Form the teachers know). No ECE bands — the 2013 catalog has none.
// Stage objects are headings ONLY (rendered as <optgroup> labels) — they are
// never selectable values. Grades carry the canonical G-code / ECE band VALUE
// the backend and the Teaching Profile store.
export const CURRICULUM_GRADE_STRUCTURES = {
  cbc: {
    id: 'cbc',
    label: 'New Curriculum (CBC)',
    stages: [
      {
        id: 'pre-primary',
        label: 'Pre-Primary (ECE)',
        grades: [
          { value: 'ECE_N', label: 'Nursery (3–4 yrs)' },
          { value: 'ECE_R', label: 'Reception (4–5 yrs)' },
        ],
      },
      {
        id: 'lower-primary',
        label: 'Lower Primary (Grades 1–3)',
        grades: [
          { value: 'G1', label: 'Grade 1' },
          { value: 'G2', label: 'Grade 2' },
          { value: 'G3', label: 'Grade 3' },
        ],
      },
      {
        id: 'upper-primary',
        label: 'Upper Primary (Grades 4–6)',
        grades: [
          { value: 'G4', label: 'Grade 4' },
          { value: 'G5', label: 'Grade 5' },
          { value: 'G6', label: 'Grade 6' },
        ],
      },
      {
        id: 'secondary',
        label: 'Secondary (Forms 1–4)',
        grades: [
          { value: 'G8', label: 'Form 1' },
          { value: 'G9', label: 'Form 2' },
          { value: 'G10', label: 'Form 3' },
          { value: 'G11', label: 'Form 4' },
        ],
      },
    ],
  },
  previous: {
    id: 'previous',
    label: 'Old Curriculum (OBC)',
    stages: [
      {
        id: 'lower-primary',
        label: 'Lower Primary (Grades 1–4)',
        grades: [
          { value: 'G1', label: 'Grade 1' },
          { value: 'G2', label: 'Grade 2' },
          { value: 'G3', label: 'Grade 3' },
          { value: 'G4', label: 'Grade 4' },
        ],
      },
      {
        id: 'upper-primary',
        label: 'Upper Primary (Grades 5–7)',
        grades: [
          { value: 'G5', label: 'Grade 5' },
          { value: 'G6', label: 'Grade 6' },
          { value: 'G7', label: 'Grade 7' },
        ],
      },
      {
        id: 'junior-secondary',
        label: 'Junior Secondary (Grades 8–9)',
        grades: [
          { value: 'G8', label: 'Grade 8 / Form 1' },
          { value: 'G9', label: 'Grade 9 / Form 2' },
        ],
      },
      {
        id: 'senior-secondary',
        label: 'Senior Secondary (Grades 10–12)',
        grades: [
          { value: 'G10', label: 'Grade 10 / Form 3' },
          { value: 'G11', label: 'Grade 11 / Form 4' },
          { value: 'G12', label: 'Grade 12 / Form 5' },
        ],
      },
    ],
  },
}

/** The stage structure for a curriculum ('cbc' | 'previous', any spelling). */
export function gradeStructureFor(curriculum) {
  const mode = normalizeCurriculum(curriculum)
  return CURRICULUM_GRADE_STRUCTURES[mode || 'cbc']
}

/**
 * Flat option list for a curriculum's grades in the shared
 * `{group}` / `{value,label}` shape FieldSelect + the settings selects render
 * (group entries become non-selectable <optgroup> headings).
 */
export function gradeOptionsForCurriculum(curriculum) {
  const out = []
  for (const stage of gradeStructureFor(curriculum).stages) {
    out.push({ group: stage.label })
    out.push(...stage.grades)
  }
  return out
}

// Valid grade codes per curriculum. Legacy band code 'ECE' predates the
// Nursery/Reception split and is still stored on old CBC assignments — accept
// it for validation (it is never OFFERED by gradeOptionsForCurriculum).
const CURRICULUM_GRADE_VALUES = {
  cbc: new Set([
    ...CURRICULUM_GRADE_STRUCTURES.cbc.stages.flatMap((s) => s.grades.map((g) => g.value)),
    'ECE',
  ]),
  previous: new Set(
    CURRICULUM_GRADE_STRUCTURES.previous.stages.flatMap((s) => s.grades.map((g) => g.value)),
  ),
}

/**
 * True when `grade` exists in the given curriculum's structure. With no (or an
 * unknown) curriculum the check is the union of both — curriculum-agnostic
 * callers keep working.
 */
export function isGradeInCurriculum(grade, curriculum) {
  const g = String(grade || '').toUpperCase()
  if (!g) return false
  const mode = normalizeCurriculum(curriculum)
  if (mode) return CURRICULUM_GRADE_VALUES[mode].has(g)
  return CURRICULUM_GRADE_VALUES.cbc.has(g) || CURRICULUM_GRADE_VALUES.previous.has(g)
}

// Subjects grouped by curriculum area across all CBC phases.
export const TEACHER_SUBJECTS = [
  { group: 'Languages' },
  { value: 'english',          label: 'English' },
  { value: 'literature_in_english', label: 'Literature in English' },
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
  { value: 'agricultural_science', label: 'Agricultural Science' },
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
  { value: 'home_management',  label: 'Home Management' },
  { value: 'food_nutrition',   label: 'Food & Nutrition' },
  { value: 'fashion_fabrics',  label: 'Fashion & Fabrics' },
  { value: 'hospitality_management', label: 'Hospitality Management' },
  { value: 'travel_tourism',   label: 'Travel & Tourism' },
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
// Zambian curriculum. Used by getSubjectsForGrade() to filter the dropdown so
// teachers only see pedagogically valid combinations (no Biology for
// Grade 1, no Literacy for Grade 12). ECE bands are handled separately by
// ECE_SUBJECTS above and bypass this map.
//
// A value is EITHER a flat grade array (the subject is taught the same way in
// both the 2013 (OBC) and 2023 (CBC) curricula) OR a `{ cbc, previous }` object
// when the two curricula genuinely differ — a subject one curriculum carries and
// the other doesn't, or carries at a different grade band. gradesForSubject()
// resolves the object against the requested curriculum; with no curriculum it
// returns the UNION so a curriculum-agnostic caller still sees every subject.
// The differences below are grounded in the digitised syllabi on file
// (functions/data/curriculum-data.json for CBC, public/syllabi/
// curriculum-data-2013.json for the 2013/OBC set).
const SUBJECT_GRADE_MAP = {
  // Languages — English & Zambian Language span everything; Literacy is
  // the lower-primary reading-and-writing strand that gives way to English.
  english:           ['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
  // Literature in English: a CBC Forms 1-4 subject (on the digitised CBC
  // secondary syllabi) and a 2013 senior-secondary option.
  literature_in_english: {
    cbc:      ['G8','G9','G10','G11'],
    previous: ['G10','G11','G12'],
  },
  literacy:          ['ECE_N','ECE_R','G1','G2','G3','G4'],
  cinyanja:          ['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
  zambian_language:  ['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],

  // STEM — the CBC (2023) folds early-grade Mathematics into the combined
  // "Mathematics and Science" learning area (the `numeracy` slug, Grades 1-4),
  // so standalone Mathematics only appears from G3 upward; the 2013 (OBC)
  // curriculum taught Mathematics as its own subject from Grade 1 and had no
  // combined lower-primary learning area. Integrated Science covers all primary
  // + junior secondary, then splits into Bio/Chem/Phys at senior secondary.
  mathematics: {
    cbc:      ['G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
    previous: ['G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
  },
  numeracy: {
    cbc:      ['ECE_N','ECE_R','G1','G2','G3','G4'],
    previous: [], // no combined "Mathematics and Science" area in the OBC.
  },
  integrated_science:['G1','G2','G3','G4','G5','G6','G7','G8','G9'],
  environmental_science: ['G1','G2','G3','G4'],
  biology:           ['G8','G9','G10','G11','G12'],
  agricultural_science: ['G8','G9','G10','G11','G12'],
  chemistry:         ['G10','G11','G12'],
  physics:           ['G10','G11','G12'],

  // Humanities — Social Studies covers ECE through junior secondary; in
  // senior secondary it splits into History/Geography/Civic Education.
  social_studies:    ['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9'],
  history:           ['G8','G9','G10','G11','G12'],
  geography:         ['G8','G9','G10','G11','G12'],
  civic_education:   ['G5','G6','G7','G8','G9','G10','G11','G12'],
  religious_education:['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],

  // Business — the 2013 (OBC) taught standalone Principles of Accounts at senior
  // secondary; the CBC (2023) replaced it with the combined Commerce &
  // Principles of Accounts across Forms 1-4 (G8-G11). Each exists in exactly one
  // curriculum, so switching the Curriculum selector swaps one for the other.
  accounts: {
    cbc:      [],
    previous: ['G10','G11','G12'],
  },
  commerce_and_principles_of_accounts: {
    cbc:      ['G8','G9','G10','G11'],
    previous: [],
  },

  // Technical & creative — Creative & Technology Studies is the primary-
  // level integrated subject; Technology Studies and Home Economics take
  // over from upper primary onwards. Expressive Arts runs ECE–junior.
  // Design & Technology Studies and Music & Creative Arts are CBC (2023)
  // Forms 1-4 electives with no 2013 equivalent, so they show only under the
  // CBC. Art & Design exists in both (a CBC Forms 1-4 subject and a 2013
  // Grades 10-12 syllabus), so it stays a flat array spanning G8-G12.
  // Technology Studies: the CBC carries it from upper primary (the digitised
  // "(Grades 4-6)" sheets) through Forms 1-4; the 2013 set runs G5-G12.
  technology_studies: {
    cbc:      ['G4','G5','G6','G8','G9','G10','G11'],
    previous: ['G5','G6','G7','G8','G9','G10','G11','G12'],
  },
  creative_and_technology_studies: ['G1','G2','G3','G4','G5','G6','G7'],
  design_and_technology_studies: {
    cbc:      ['G8','G9','G10','G11'],
    previous: [],
  },
  art_and_design:    ['G8','G9','G10','G11','G12'],
  music_and_creative_arts: {
    cbc:      ['G8','G9','G10','G11'],
    previous: [],
  },
  // Home Economics: the CBC upper-primary "(Grades 4-6)" sheets carry it from
  // Grade 4 (secondary CBC splits it into Food & Nutrition / Fashion & Fabrics /
  // Hospitality below); the 2013 set runs Grade 5 through senior secondary.
  home_economics: {
    cbc:      ['G4','G5','G6'],
    previous: ['G5','G6','G7','G8','G9','G10','G11','G12'],
  },
  // 2013 senior-secondary home-economics strands; the CBC replaces Home
  // Management with the vocational subjects below.
  home_management: {
    cbc:      [],
    previous: ['G10','G11','G12'],
  },
  food_nutrition: {
    cbc:      ['G8','G9','G10','G11'],
    previous: ['G10','G11','G12'],
  },
  fashion_fabrics: {
    cbc:      ['G8','G9','G10','G11'],
    previous: ['G10','G11','G12'],
  },
  // CBC Forms 1-4 vocational pathways with no 2013 equivalent.
  hospitality_management: {
    cbc:      ['G8','G9','G10','G11'],
    previous: [],
  },
  travel_tourism: {
    cbc:      ['G8','G9','G10','G11'],
    previous: [],
  },
  expressive_arts:   ['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9'],
  physical_education:['ECE_N','ECE_R','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
}

// Fold any spelling of the two curricula into 'cbc' | 'previous', or '' when the
// caller passed nothing (→ curriculum-agnostic: union of both). Kept local to
// this pure module so it stays firebase-free; teachingProfileCore exports the
// canonical normalizeCurriculumType for the rest of the app.
function normalizeCurriculum(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (['previous', 'obc', 'old', '2013'].includes(s)) return 'previous'
  if (['cbc', 'new', '2023'].includes(s)) return 'cbc'
  return ''
}

/**
 * Resolve the grade list a subject is taught at for a curriculum. Flat-array
 * entries apply to both curricula. Object entries return the requested
 * curriculum's list, or the UNION of both when no curriculum is given (so a
 * curriculum-agnostic caller still sees every subject). Returns null for an
 * unmapped subject (no grade restriction — forward-compatible).
 */
function gradesForSubject(subject, curriculum) {
  const spec = SUBJECT_GRADE_MAP[subject]
  if (spec === undefined) return null
  if (Array.isArray(spec)) return spec
  const cbc = spec.cbc || []
  const previous = spec.previous || []
  const mode = normalizeCurriculum(curriculum)
  if (mode === 'cbc') return cbc
  if (mode === 'previous') return previous
  return Array.from(new Set([...cbc, ...previous]))
}

/**
 * Returns the subject list for a grade, optionally scoped to a curriculum.
 * ECE bands (Nursery / Reception) get the dedicated four-area ECE syllabus
 * menu; every other grade gets TEACHER_SUBJECTS filtered by SUBJECT_GRADE_MAP.
 *
 * When `curriculum` ('cbc' | 'previous') is given the filter is STRICT:
 *   • subjects that belong only to the other curriculum are dropped (e.g.
 *     Principles of Accounts vs Commerce & Principles of Accounts),
 *   • a grade the curriculum doesn't offer (Grade 7 / Grade 12 under the CBC,
 *     the ECE bands under the 2013 set) returns [] — never a generic
 *     every-subject fallback, so a missing mapping shows up as an explicit
 *     empty state instead of silently mixing curricula.
 *
 * With no curriculum the legacy union-of-both behaviour is preserved for
 * curriculum-agnostic callers (admin filters, label resolution), including the
 * full-list fallback for an unknown grade (e.g. a legacy URL deeplink).
 * Group headers are kept only if at least one subject in that group survives
 * the filter.
 */
export function getSubjectsForGrade(grade, curriculum) {
  const mode = normalizeCurriculum(curriculum)
  if (!grade) return mode ? [] : TEACHER_SUBJECTS
  if (mode && !isGradeInCurriculum(grade, mode)) return []
  // ECE (Nursery / Reception) follows its own four-area syllabus, not the
  // Grade-1+ subject menu (CBC-only — the grade gate above keeps it out of
  // the 2013 set).
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
    const grades = gradesForSubject(opt.value, curriculum)
    const allowed = !grades || grades.includes(grade)
    if (!allowed) continue
    if (pendingGroup && !groupHasItems) {
      filtered.push(pendingGroup)
      groupHasItems = true
    }
    filtered.push(opt)
  }
  // Curriculum-agnostic legacy callers keep the defensive full-list fallback;
  // a curriculum-scoped call must NOT silently return every subject.
  return filtered.length > 0 ? filtered : (mode ? [] : TEACHER_SUBJECTS)
}

/**
 * True when the subject exists AT ALL in the given curriculum (at any grade).
 * False means it belongs exclusively to the other curriculum (e.g. Principles
 * of Accounts under the CBC, the combined Mathematics and Science area under
 * the 2013 set). Unmapped subjects default to true (forward-compatible).
 */
export function subjectExistsInCurriculum(subject, curriculum) {
  const grades = gradesForSubject(subject, curriculum)
  return !grades || grades.length > 0
}

/**
 * Picks a sensible default subject for a grade (and optional curriculum) — used
 * when the grade or curriculum changes and the previously-selected subject no
 * longer applies. Returns the first non-group option from getSubjectsForGrade().
 */
export function defaultSubjectForGrade(grade, curriculum) {
  const opts = getSubjectsForGrade(grade, curriculum)
  const firstSubject = opts.find((o) => o.value !== undefined)
  return firstSubject?.value || 'mathematics'
}

/**
 * True if `subject` is taught at `grade` (in `curriculum`, when given). ECE
 * bands are validated against the ECE_SUBJECTS set; all other grades against
 * SUBJECT_GRADE_MAP (subjects with no mapping entry default to true,
 * forward-compatible). Passing a curriculum rejects a subject that belongs only
 * to the other curriculum.
 */
export function isSubjectValidForGrade(subject, grade, curriculum) {
  if (isEceGrade(grade)) return ECE_SUBJECT_VALUES.has(subject)
  const grades = gradesForSubject(subject, curriculum)
  if (!grades) return true
  return grades.includes(grade)
}
