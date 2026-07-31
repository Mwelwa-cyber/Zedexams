/**
 * canonicalEducation — the ONE declaration of what a curriculum, a grade and a
 * subject ARE in ZedExams.
 *
 * Why this file exists
 * ────────────────────
 * Subjects, grades and curricula were declared independently in ~30 places, and
 * the lists disagreed. Five subject vocabularies were in production at once:
 * "Integrated Science" (Assessment Studio) vs "Science" (Timetable Studio,
 * Syllabi Studio); "English" vs "English Language"; "Expressive Art" vs
 * "Expressive Arts"; "Cinyanja" vs "Zambian Language". Four names named the two
 * real curricula. Three grade lists disagreed about which grades exist at all —
 * the New Class form offered Grades 4-7, the Assessment Studio offered Nursery
 * through Form 4 (no Grade 7), and the Curriculum Reference page advertised
 * Forms 1-6.
 *
 * The consequences were not cosmetic. A teacher could create a Grade 7 class and
 * then not write a Grade 7 paper. A scheme of work for "Integrated Science"
 * could never be matched to a timetable slot for "Science", because they were
 * different strings in different lists and nothing folded them together.
 *
 * What is canonical here
 * ──────────────────────
 * • SUBJECTS — the Syllabus Studio's subject list is the source of truth, and
 *   its names ARE the canonical names. They are read off the digitised syllabus
 *   documents in functions/data/curriculum-data.json (CBC) and
 *   curriculum-data-2013.json (OBC), which is why "Science" — not "Integrated
 *   Science" — is what CBC calls the Grades 4-6 subject.
 *
 * • GRADES — ONE ordered ladder, Nursery through Form 6, covering the full range
 *   the product claims to serve. Not one list per curriculum: the ladder is
 *   shared and each curriculum declares which rungs it defines and what it CALLS
 *   them (see `gradeNaming` below).
 *
 * • CURRICULA — two records, one display name each.
 *
 * Two conventions, one list
 * ─────────────────────────
 * The two curricula genuinely name the same things differently, and that is a
 * curriculum fact rather than a bug to normalise away:
 *
 *   • CBC calls G8 "Form 1"; OBC calls the same year "Grade 8 / Form 1".
 *   • CBC calls the Grades 4-6 science subject "Science"; OBC's Grades 1-7
 *     document is titled "Integrated Science".
 *
 * So a canonical record carries the naming CONVENTION per curriculum
 * (`CANONICAL_CURRICULA[].gradeNaming`) and per-curriculum name overrides
 * (`namesByCurriculum` on a subject), and the label is DERIVED. There is still
 * exactly one grade ladder and one subject list.
 *
 * Identity is the id, never the label
 * ───────────────────────────────────
 * Every record's `id` is the stable key to store and match on — the underscore
 * subject slug (`integrated_science`) and the G-code grade (`G8`) the app and
 * the Cloud Functions already speak. Display names may be corrected without a
 * data migration; ids may not change.
 *
 * Aliases here are MIGRATION-ONLY
 * ───────────────────────────────
 * The *_MIGRATION_ALIASES tables below exist so scripts/migrate-canonical-
 * education.mjs can rewrite stored values once. They are deliberately NOT wired
 * into any render path. Runtime folding of legacy spellings continues to live
 * where it already does (curriculumCatalog.normalizeSubjectId,
 * educationLevels.resolveLevel, teacherTaxonomy.canonicalSubjectValue) so that
 * this module stays a declaration of what is true rather than a repair kit.
 *
 * Pure — no React, no DOM, no Firebase — so the plain-node suite imports it
 * directly (scripts/test-canonical-education.mjs).
 */

import {
  MATHS_SCIENCE_LABEL, PRE_MATHS_SCIENCE_LABEL, MATHS_SCIENCE_SUBJECT_KEY,
  isMathsScienceName,
} from './mathsScienceArea.js'

/* ══════════════════════════════════════════════════════════════════════════
 * CURRICULA — two records, one display name each
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * How a curriculum names each stage of the ladder. This is what replaces the
 * "maintain two grade lists" approach: one list of rungs, and each curriculum
 * says what it calls a rung at each stage.
 *
 *   'proper'      the level has a name of its own      → "Nursery"
 *   'grade'       numbered as a Grade                  → "Grade 5"
 *   'form'        numbered as a Form                   → "Form 1"
 *   'grade-form'  dual-named, both conventions at once → "Grade 8 / Form 1"
 */
export const GRADE_NAMING_CONVENTIONS = Object.freeze({
  PROPER: 'proper',
  GRADE: 'grade',
  FORM: 'form',
  GRADE_FORM: 'grade-form',
})

export const CANONICAL_CURRICULA = Object.freeze([
  Object.freeze({
    id: 'cbc',
    name: 'Competency-Based Curriculum',
    shortName: 'CBC',
    /** The one display name. Use this, not a locally-invented variant. */
    displayName: 'Competency-Based Curriculum (CBC)',
    year: 2023,
    // CBC dropped the Grade numbering at secondary in the 3-6-4-2 restructure:
    // a secondary year is a Form and nothing else.
    gradeNaming: Object.freeze({
      ece: GRADE_NAMING_CONVENTIONS.PROPER,
      primary: GRADE_NAMING_CONVENTIONS.GRADE,
      secondary: GRADE_NAMING_CONVENTIONS.FORM,
      advanced: GRADE_NAMING_CONVENTIONS.FORM,
    }),
  }),
  Object.freeze({
    id: 'obc',
    name: 'Outcome-Based Curriculum',
    shortName: 'OBC',
    displayName: 'Outcome-Based Curriculum (OBC)',
    year: 2013,
    // The 2013 set numbers secondary years as Grades AND teachers call them
    // Forms, so both appear — this is the dual naming already on every OBC
    // picker in the app.
    gradeNaming: Object.freeze({
      ece: GRADE_NAMING_CONVENTIONS.PROPER,
      primary: GRADE_NAMING_CONVENTIONS.GRADE,
      secondary: GRADE_NAMING_CONVENTIONS.GRADE_FORM,
      advanced: GRADE_NAMING_CONVENTIONS.FORM,
    }),
  }),
])

const CURRICULUM_BY_ID = new Map(CANONICAL_CURRICULA.map((c) => [c.id, c]))
export const CANONICAL_CURRICULUM_IDS = Object.freeze(CANONICAL_CURRICULA.map((c) => c.id))

/**
 * Every spelling of a curriculum this repo has ever stored → its canonical id.
 * MIGRATION ONLY. Four names were in production for two curricula; these are
 * all of them, plus the internal taxonomy token 'previous'.
 */
export const CURRICULUM_MIGRATION_ALIASES = Object.freeze({
  cbc: 'cbc',
  new: 'cbc',
  2023: 'cbc',
  'cbc-2023': 'cbc',
  'cbc 2023': 'cbc',
  'competency-based': 'cbc',
  'competence-based': 'cbc',
  'competency-based curriculum': 'cbc',
  'competency-based curriculum (cbc)': 'cbc',
  'competence-based curriculum': 'cbc',
  'new curriculum': 'cbc',
  'new curriculum (cbc)': 'cbc',

  obc: 'obc',
  old: 'obc',
  previous: 'obc',
  2013: 'obc',
  'obc-2013': 'obc',
  'obc 2013': 'obc',
  'outcome-based': 'obc',
  'outcome-based curriculum': 'obc',
  'outcome-based curriculum (obc)': 'obc',
  'old curriculum': 'obc',
  'old curriculum (obc)': 'obc',
  'previous curriculum': 'obc',
})

/* ══════════════════════════════════════════════════════════════════════════
 * GRADES — one ordered ladder, Nursery → Form 6
 * ══════════════════════════════════════════════════════════════════════════ */

/** Coarse stages, in ladder order. Drives which naming convention applies. */
export const CANONICAL_STAGES = Object.freeze(['ece', 'primary', 'secondary', 'advanced'])

/**
 * The ladder. One entry per curriculum YEAR, never one per name — "Grade 8" and
 * "Form 1" are the same rung and appear once.
 *
 *   id            stable record id
 *   code          the canonical wire value / foreign key (what to store)
 *   gradeNumber   its number under the Grade convention (null for ECE)
 *   formNumber    its number under the Form convention (null below secondary)
 *   properName    its own name, where it has one (ECE only)
 *   stage         coarse stage; `stageByCurriculum` overrides where they differ
 *   curricula     which curricula define this rung
 *
 * Grade 7 is OBC-only (CBC abolished it in the restructure) and Forms 5-6 are
 * the CBC A-Level tier — but under OBC, "Form 5" is the FINAL O-Level year,
 * G12. Same rung, same code, different stage per curriculum. That is why
 * `stageByCurriculum` exists rather than a second ladder.
 */
const ECE_RUNGS = [
  {
    id: 'ece-nursery', code: 'ECE_N', order: 10, stage: 'ece',
    gradeNumber: null, formNumber: null, properName: 'Nursery',
    ageLabel: '3–4 yrs', curricula: ['cbc'],
  },
  {
    id: 'ece-reception', code: 'ECE_R', order: 20, stage: 'ece',
    gradeNumber: null, formNumber: null, properName: 'Reception',
    ageLabel: '4–5 yrs', curricula: ['cbc'],
  },
]

const PRIMARY_RUNGS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  id: `grade-${n}`,
  code: `G${n}`,
  order: 30 + n * 10,
  stage: 'primary',
  gradeNumber: n,
  formNumber: null,
  properName: null,
  // CBC abolished Grade 7 when primary became six years; the 2013 set keeps it.
  curricula: n === 7 ? ['obc'] : ['cbc', 'obc'],
}))

const SECONDARY_RUNGS = [1, 2, 3, 4, 5, 6].map((n) => {
  const gradeNumber = n + 7
  return {
    id: `form-${n}`,
    code: `G${gradeNumber}`,
    order: 100 + n * 10,
    // Under OBC, Form 5 (G12) is the last O-Level year. Under CBC it is the
    // first of the two A-Level years.
    stage: n >= 5 ? 'advanced' : 'secondary',
    stageByCurriculum: n === 5 ? { obc: 'secondary', cbc: 'advanced' } : null,
    gradeNumber,
    formNumber: n,
    properName: null,
    // Form 6 (G13) exists only in the CBC's A-Level tier; the 2013 set stops at
    // Grade 12 / Form 5.
    curricula: n === 6 ? ['cbc'] : ['cbc', 'obc'],
  }
})

export const CANONICAL_GRADES = Object.freeze(
  [...ECE_RUNGS, ...PRIMARY_RUNGS, ...SECONDARY_RUNGS]
    .sort((a, b) => a.order - b.order)
    .map((g) => Object.freeze({
      ...g,
      curricula: Object.freeze([...g.curricula]),
      stageByCurriculum: g.stageByCurriculum ? Object.freeze({ ...g.stageByCurriculum }) : null,
    })),
)

const GRADE_BY_CODE = new Map(CANONICAL_GRADES.map((g) => [g.code, g]))
const GRADE_BY_ID = new Map(CANONICAL_GRADES.map((g) => [g.id, g]))

export const CANONICAL_GRADE_CODES = Object.freeze(CANONICAL_GRADES.map((g) => g.code))

/**
 * Every stored grade spelling → its canonical code. MIGRATION ONLY.
 *
 * Built from the ladder itself so it cannot drift from it, plus the retired
 * spellings the repo has actually written: the pre-split ECE band names, the
 * bare-digit grades the learner surfaces store, and the hyphenated Form values
 * the class register stores.
 */
export const GRADE_MIGRATION_ALIASES = Object.freeze((() => {
  const map = {}
  const put = (key, code) => {
    const k = String(key).trim().toLowerCase().replace(/\s+/g, ' ')
    if (k && !(k in map)) map[k] = code
  }
  for (const g of CANONICAL_GRADES) {
    put(g.code, g.code)
    put(g.id, g.code)
    if (g.properName) put(g.properName, g.code)
    if (g.gradeNumber != null) {
      put(`grade ${g.gradeNumber}`, g.code)
      put(`g${g.gradeNumber}`, g.code)
      // A bare digit is how the learner surfaces and the class register store a
      // primary grade. Only unambiguous below secondary: a bare "8" could be
      // Grade 8 or (never) Form 8, and Grade 8 is the only reading, so it is
      // safe the whole way up.
      put(String(g.gradeNumber), g.code)
    }
    if (g.formNumber != null) {
      put(`form ${g.formNumber}`, g.code)
      put(`form-${g.formNumber}`, g.code)
      put(`f${g.formNumber}`, g.code)
    }
  }
  // Retired ECE spellings. "Baby Class" and "Middle Class" pre-date the
  // Nursery/Reception split and both fold onto Nursery — pitching content down
  // is harmless, pitching it up is not.
  put('ece', 'ECE_N')
  put('ece_b', 'ECE_N')
  put('baby', 'ECE_N')
  put('baby class', 'ECE_N')
  put('ece_m', 'ECE_N')
  put('middle', 'ECE_N')
  put('middle class', 'ECE_N')
  return map
})())

/* ══════════════════════════════════════════════════════════════════════════
 * SUBJECTS — the Syllabus Studio's list, its names
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The canonical subject list.
 *
 *   id      the stable underscore slug — the foreign key to store and match on.
 *           Already the vocabulary the Cloud Functions' ALLOWED_SUBJECTS, the
 *           syllabus KB and teacherTaxonomy speak, so adopting it as canonical
 *           costs no rewrite of the backend contract.
 *   name    the canonical display name, taken from the Syllabus Studio document
 *           that defines the subject.
 *   namesByCurriculum
 *           set ONLY where the two curricula genuinely title the subject
 *           differently. `subjectName(id, curriculumId)` derives the rest.
 *   syllabusDocuments
 *           the Syllabus Studio documents this subject's name is read from —
 *           the provenance for `name`, and what test:canonical-education checks
 *           the name against so a rename here cannot silently invent a subject
 *           the syllabi do not carry.
 */
const SUBJECT_RECORDS = [
  /* ── Languages ─────────────────────────────────────────────────────────── */
  {
    id: 'english', name: 'English Language', group: 'Languages',
    // "English Language Syllabus (Grades 4-6)" at primary, "English Syllabus
    // (Forms 1-4)" at secondary — one subject, the Ministry drops the qualifier
    // at secondary. The fuller name is canonical because it is unambiguous.
    syllabusDocuments: [
      'English Language Syllabus (Grades 4-6)',
      'English Syllabus (Forms 1-4)',
      'English Language Syllabus (Grades 2-7, 2013)',
    ],
  },
  {
    id: 'literature_in_english', name: 'Literature in English', group: 'Languages',
    syllabusDocuments: ['Literature in English Syllabus (Forms 1-4)'],
  },
  {
    id: 'literacy', name: 'Literacy', group: 'Languages',
    // The lower-primary reading-and-writing strand. It has no standalone
    // syllabus document — it is a strand inside "Lower Primary Syllabi
    // (Grades 1-3)" — so its name comes from the framework, not a document.
    syllabusDocuments: [],
  },
  {
    id: 'zambian_language', name: 'Zambian Languages', group: 'Languages',
    namesByCurriculum: { cbc: 'Zambian Languages', obc: 'Zambian Language' },
    syllabusDocuments: [
      'Zambian Languages Syllabus (Forms 1-4)',
      'Zambian Language Syllabus (Grades 5-7, 2013)',
    ],
    /**
     * The seven zoned languages this learning area is taught in. A learner sits
     * ONE of them; the syllabus is written once for the area. "Cinyanja" was a
     * subject in its own right on the learner dashboard, which is why it reads
     * as a fifth subject vocabulary — it is a zoned instance of this area, not a
     * separate learning area, and the migration folds it here.
     */
    zonedLanguages: ['Cinyanja', 'Bemba', 'Nyanja', 'Tonga', 'Lozi', 'Kaonde', 'Lunda', 'Luvale'],
  },

  /* ── STEM ──────────────────────────────────────────────────────────────── */
  {
    id: 'mathematics', name: 'Mathematics', group: 'STEM',
    syllabusDocuments: [
      'Mathematics Syllabus (Grades 4-6)', 'Mathematics Syllabus (Forms 1-4)',
      'Mathematics Syllabus (Grades 1-7, 2013)', 'Mathematics Syllabus (Grades 10-12, 2013)',
    ],
  },
  {
    id: 'mathematics_ii', name: 'Mathematics II', group: 'STEM',
    syllabusDocuments: ['Mathematics II Syllabus (Forms 1-4)'],
  },
  {
    // The combined lower-primary / ECE learning area. Its two names are declared
    // once in mathsScienceArea.js and imported here rather than retyped.
    //
    // Its documents are the two COMBINED syllabi, which carry a subject per
    // SHEET rather than in the title — so the name is read off the sheet, and
    // the sheet spellings are declared below. The canonical name expands the
    // sheet's abbreviation ("Maths & Science" → "Mathematics and Science"),
    // which is the name the Ministry's framework tables print.
    id: MATHS_SCIENCE_SUBJECT_KEY, name: MATHS_SCIENCE_LABEL, group: 'STEM',
    earlyChildhoodName: PRE_MATHS_SCIENCE_LABEL,
    syllabusDocuments: ['Lower Primary Syllabi (Grades 1-3)', 'Early Childhood Education Syllabi (3-5 Years)'],
    syllabusSheets: ['Maths & Science', 'Pre-Maths & Science'],
  },
  {
    // THE headline divergence: CBC titles the Grades 4-6 document "Science", the
    // 2013 set titles its Grades 1-7 document "Integrated Science". Both are
    // Syllabus Studio names; neither is wrong, so both are recorded and the
    // curriculum picks.
    id: 'integrated_science', name: 'Science', group: 'STEM',
    namesByCurriculum: { cbc: 'Science', obc: 'Integrated Science' },
    syllabusDocuments: [
      'Science Syllabus (Grades 4-6)',
      'Integrated Science Syllabus (Grades 1-7, 2013)',
    ],
  },
  {
    id: 'environmental_science', name: 'Environmental Science', group: 'STEM',
    syllabusDocuments: [],
  },
  { id: 'biology', name: 'Biology', group: 'STEM', syllabusDocuments: ['Biology Syllabus (Forms 1-4)', 'Biology Syllabus (Grades 10-12, 2013)'] },
  { id: 'agricultural_science', name: 'Agricultural Science', group: 'STEM', syllabusDocuments: ['Agricultural Science Syllabus (Forms 1-4)', 'Agricultural Science Syllabus (Grades 10-12, 2013)'] },
  { id: 'chemistry', name: 'Chemistry', group: 'STEM', syllabusDocuments: ['Chemistry Syllabus (Grades 10-12, 2013)'] },
  { id: 'physics', name: 'Physics', group: 'STEM', syllabusDocuments: ['Physics Syllabus (Forms 1-4)'] },

  /* ── Humanities ────────────────────────────────────────────────────────── */
  { id: 'social_studies', name: 'Social Studies', group: 'Humanities', syllabusDocuments: ['Social Studies Syllabus (Grades 4-6)', 'Social Studies Syllabus (Grades 1-7, 2013)'] },
  { id: 'history', name: 'History', group: 'Humanities', syllabusDocuments: ['History Syllabus (Forms 1-4)', 'History Syllabus (Senior Secondary, 2013)'] },
  { id: 'geography', name: 'Geography', group: 'Humanities', syllabusDocuments: ['Geography Syllabus (Forms 1-4)', 'Geography Syllabus (Grades 10-12, 2013)'] },
  { id: 'civic_education', name: 'Civic Education', group: 'Humanities', syllabusDocuments: ['Civic Education Syllabus (Grades 10-12, 2013)'] },
  { id: 'religious_education', name: 'Religious Education', group: 'Humanities', syllabusDocuments: ['Religious Education Syllabus (Forms 1-4)'] },
  { id: 'religious_education_2044', name: 'Religious Education 2044', group: 'Humanities', syllabusDocuments: ['Religious Education 2044 Syllabus (Grades 10-12, 2013)'] },
  { id: 'religious_education_2046', name: 'Religious Education 2046', group: 'Humanities', syllabusDocuments: ['Religious Education 2046 Syllabus (Grades 10-12, 2013)'] },

  /* ── Business ──────────────────────────────────────────────────────────── */
  {
    // One CDC workbook, two independently-numbered examinable syllabi. The
    // document name carries both; each subject's canonical name is its own half.
    id: 'commerce', name: 'Commerce', group: 'Business',
    syllabusDocuments: ['Commerce & Principles of Accounts Syllabus (Forms 1-4)'],
  },
  {
    id: 'principles_of_accounts', name: 'Principles of Accounts', group: 'Business',
    syllabusDocuments: ['Commerce & Principles of Accounts Syllabus (Forms 1-4)'],
  },

  /* ── Technical & Creative ──────────────────────────────────────────────── */
  { id: 'technology_studies', name: 'Technology Studies', group: 'Technical & Creative', syllabusDocuments: ['Technology Studies Syllabus (Grades 4-6)', 'ICT Syllabus (Forms 1-4)', 'Technology Studies Syllabus (Grades 5-7, 2013)'] },
  { id: 'creative_and_technology_studies', name: 'Creative & Technology Studies', group: 'Technical & Creative', syllabusDocuments: ['Creative & Technology Studies Syllabus (2013)'] },
  { id: 'design_and_technology_studies', name: 'Design & Technology Studies', group: 'Technical & Creative', syllabusDocuments: ['Design & Technology Studies Syllabus (Forms 1-4)'] },
  { id: 'art_and_design', name: 'Art & Design', group: 'Technical & Creative', syllabusDocuments: ['Art & Design Syllabus (Forms 1-4)', 'Art & Design Syllabus (Grades 10-12, 2013)'] },
  { id: 'music_and_creative_arts', name: 'Music & Creative Arts', group: 'Technical & Creative', syllabusDocuments: ['Music & Creative Arts Syllabus (Forms 1-4)'] },
  {
    id: 'home_economics', name: 'Home Economics', group: 'Technical & Creative',
    // CBC titles the Grades 4-6 document "Home Economics & Hospitality"; the
    // 2013 Grades 5-7 document is titled "Home Economics". The shorter name is
    // canonical because it is the subject at every grade it exists at, and the
    // hospitality strand is a CBC addition to the same subject rather than a
    // rename of it.
    syllabusDocuments: ['Home Economics & Hospitality Syllabus (Grades 4-6)', 'Home Economics Syllabus (Grades 5-7, 2013)'],
  },
  { id: 'home_management', name: 'Home Management', group: 'Technical & Creative', syllabusDocuments: ['Home Management Syllabus (Grades 10-12, 2013)'] },
  { id: 'food_and_nutrition', name: 'Food & Nutrition', group: 'Technical & Creative', syllabusDocuments: ['Food & Nutrition Syllabus (Forms 1-4)', 'Food & Nutrition Syllabus (Grades 10-12, 2013)'] },
  { id: 'fashion_and_fabrics', name: 'Fashion & Fabrics', group: 'Technical & Creative', syllabusDocuments: ['Fashion & Fabrics Syllabus (Forms 1-4)'] },
  { id: 'hospitality_management', name: 'Hospitality Management', group: 'Technical & Creative', syllabusDocuments: ['Hospitality Management Syllabus (Forms 1-4)'] },
  { id: 'travel_tourism', name: 'Travel & Tourism', group: 'Technical & Creative', syllabusDocuments: ['Travel & Tourism Syllabus (Forms 1-4)'] },
  { id: 'expressive_arts', name: 'Expressive Arts', group: 'Technical & Creative', syllabusDocuments: ['Expressive Arts Syllabus (Grades 5-7, 2013)'] },
  { id: 'physical_education', name: 'Physical Education', group: 'Technical & Creative', syllabusDocuments: ['Physical Education Syllabus (Forms 1-4)', 'Physical Education Syllabus (Grades 8-9, 2013)', 'Physical Education Syllabus (Grades 10-12, 2013)'] },
]

export const CANONICAL_SUBJECTS = Object.freeze(
  SUBJECT_RECORDS.map((s) => Object.freeze({
    ...s,
    namesByCurriculum: s.namesByCurriculum ? Object.freeze({ ...s.namesByCurriculum }) : null,
    syllabusDocuments: Object.freeze([...(s.syllabusDocuments || [])]),
    syllabusSheets: Object.freeze([...(s.syllabusSheets || [])]),
    zonedLanguages: s.zonedLanguages ? Object.freeze([...s.zonedLanguages]) : null,
  })),
)

const SUBJECT_BY_ID = new Map(CANONICAL_SUBJECTS.map((s) => [s.id, s]))
export const CANONICAL_SUBJECT_IDS = Object.freeze(CANONICAL_SUBJECTS.map((s) => s.id))

/**
 * Every stored subject spelling → its canonical id. MIGRATION ONLY.
 *
 * The five divergent vocabularies, folded. Entries are lower-cased and
 * whitespace-collapsed; `migrationSubjectId()` applies the same normalisation to
 * its input. Anything NOT here is deliberately unmapped so the migration fails
 * loudly on it rather than guessing.
 */
export const SUBJECT_MIGRATION_ALIASES = Object.freeze((() => {
  const map = {}
  const put = (key, id) => {
    const k = String(key).trim().toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ')
    if (k && !(k in map)) map[k] = id
  }
  // Identity + the canonical names themselves, so an already-migrated value is
  // recognised and the migration is idempotent.
  for (const s of CANONICAL_SUBJECTS) {
    put(s.id, s.id)
    put(s.id.replace(/_/g, ' '), s.id)
    put(s.id.replace(/_/g, '-'), s.id)
    put(s.name, s.id)
    if (s.namesByCurriculum) for (const n of Object.values(s.namesByCurriculum)) put(n, s.id)
    if (s.earlyChildhoodName) put(s.earlyChildhoodName, s.id)
  }
  // ── The divergences the audit found ──────────────────────────────────────
  // "Integrated Science" (Assessment Studio, learner dashboard) vs "Science"
  // (Timetable Studio, Syllabi Studio).
  put('integrated science', 'integrated_science')
  put('science', 'integrated_science')
  put('sci', 'integrated_science')
  put('science (incl. agricultural science)', 'integrated_science')
  // "English" vs "English Language".
  put('english', 'english')
  put('eng', 'english')
  // "Expressive Art" (singular — admin + learner lists) vs "Expressive Arts".
  put('expressive art', 'expressive_arts')
  put('expressive-arts', 'expressive_arts')
  // "Cinyanja" vs "Zambian Language". Cinyanja is a zoned instance of the
  // Zambian Languages learning area, not a separate area — see zonedLanguages
  // on that record. The migration reports every fold so the specific language
  // is recoverable from the report.
  put('cinyanja', 'zambian_language')
  put('chinyanja', 'zambian_language')
  put('zambian language', 'zambian_language')
  put('zambian language (other)', 'zambian_language')
  put('zambian lang', 'zambian_language')
  put('local language', 'zambian_language')
  // Other spellings already in stored data or in a studio list.
  put('maths', 'mathematics')
  put('math', 'mathematics')
  put('social', 'social_studies')
  put('ss', 'social_studies')
  put('social studies (incl. mining content)', 'social_studies')
  put('technology', 'technology_studies')
  put('tech studies', 'technology_studies')
  put('ict', 'technology_studies')
  put('computer studies', 'technology_studies')
  put('home ec', 'home_economics')
  put('home ec.', 'home_economics')
  put('home economics and hospitality', 'home_economics')
  put('cts', 'creative_and_technology_studies')
  put('c.t.s', 'creative_and_technology_studies')
  put('creative technology studies', 'creative_and_technology_studies')
  put('creative-technology-studies', 'creative_and_technology_studies')
  put('literature', 'literature_in_english')
  // Pre-split legacy keys already folded by teacherTaxonomy at runtime; repeated
  // here so the migration does not need to import it.
  put('accounts', 'principles_of_accounts')
  put('food nutrition', 'food_and_nutrition')
  put('fashion fabrics', 'fashion_and_fabrics')
  return map
})())

/**
 * Values that named TWO subjects at once. There is no correct fold, so the
 * migration REPORTS these rather than rewriting them — guessing would file a
 * record under a subject the teacher never picked.
 */
export const AMBIGUOUS_SUBJECT_VALUES = Object.freeze({
  commerce_and_principles_of_accounts: Object.freeze(['commerce', 'principles_of_accounts']),
  'commerce & principles of accounts': Object.freeze(['commerce', 'principles_of_accounts']),
})

/* ══════════════════════════════════════════════════════════════════════════
 * Lookups
 * ══════════════════════════════════════════════════════════════════════════ */

export function getCurriculum(curriculumId) {
  return CURRICULUM_BY_ID.get(String(curriculumId ?? '').trim().toLowerCase()) || null
}

export function getGrade(codeOrId) {
  const raw = String(codeOrId ?? '').trim()
  return GRADE_BY_CODE.get(raw.toUpperCase()) || GRADE_BY_ID.get(raw.toLowerCase()) || null
}

export function getSubject(subjectId) {
  return SUBJECT_BY_ID.get(String(subjectId ?? '').trim().toLowerCase()) || null
}

/** The coarse stage a rung sits in for a curriculum. */
export function gradeStage(codeOrId, curriculumId) {
  const g = getGrade(codeOrId)
  if (!g) return ''
  const cid = String(curriculumId ?? '').trim().toLowerCase()
  return (g.stageByCurriculum && g.stageByCurriculum[cid]) || g.stage
}

/**
 * The label a curriculum gives a rung, DERIVED from that curriculum's naming
 * convention. With no curriculum the fullest unambiguous name is returned, so a
 * curriculum-agnostic surface (an admin filter, a search result) still reads
 * correctly.
 */
export function gradeLabel(codeOrId, curriculumId) {
  const g = getGrade(codeOrId)
  if (!g) return String(codeOrId ?? '')
  if (g.properName) return g.properName
  const curriculum = getCurriculum(curriculumId)
  const convention = curriculum
    ? curriculum.gradeNaming[gradeStage(g.code, curriculum.id)]
    : (g.formNumber != null ? GRADE_NAMING_CONVENTIONS.GRADE_FORM : GRADE_NAMING_CONVENTIONS.GRADE)
  switch (convention) {
    case GRADE_NAMING_CONVENTIONS.FORM:
      return g.formNumber != null ? `Form ${g.formNumber}` : `Grade ${g.gradeNumber}`
    case GRADE_NAMING_CONVENTIONS.GRADE_FORM:
      return g.formNumber != null
        ? `Grade ${g.gradeNumber} / Form ${g.formNumber}`
        : `Grade ${g.gradeNumber}`
    case GRADE_NAMING_CONVENTIONS.PROPER:
      return g.properName || `Grade ${g.gradeNumber}`
    default:
      return `Grade ${g.gradeNumber}`
  }
}

/** The name a curriculum gives a subject. Falls back to the canonical name. */
export function subjectName(subjectId, curriculumId, grade) {
  const s = getSubject(subjectId)
  if (!s) return String(subjectId ?? '')
  // The combined maths/science area is named for its stage, not its curriculum.
  if (s.earlyChildhoodName && grade && gradeStage(grade, curriculumId) === 'ece') {
    return s.earlyChildhoodName
  }
  const cid = String(curriculumId ?? '').trim().toLowerCase()
  return (s.namesByCurriculum && s.namesByCurriculum[cid]) || s.name
}

/**
 * The rungs a curriculum defines, in ladder order. This is the ONLY correct way
 * to build a grade picker: it is a FILTER on the one ladder, never a list of
 * its own.
 */
export function gradesForCurriculum(curriculumId) {
  const cid = String(curriculumId ?? '').trim().toLowerCase()
  if (!cid) return CANONICAL_GRADES.slice()
  if (!CURRICULUM_BY_ID.has(cid)) return []
  return CANONICAL_GRADES.filter((g) => g.curricula.includes(cid))
}

/** Grade options in the shared `{ value, label }` picker shape. */
export function gradeOptions(curriculumId) {
  return gradesForCurriculum(curriculumId).map((g) => ({
    value: g.code,
    label: gradeLabel(g.code, curriculumId),
    stage: gradeStage(g.code, curriculumId),
  }))
}

/** Subject options in the shared `{ value, label }` picker shape. */
export function subjectOptions(curriculumId, grade) {
  return CANONICAL_SUBJECTS.map((s) => ({
    value: s.id,
    label: subjectName(s.id, curriculumId, grade),
    group: s.group,
  }))
}

/* ══════════════════════════════════════════════════════════════════════════
 * Per-feature grade filters
 * ══════════════════════════════════════════════════════════════════════════
 * A feature that supports a SUBSET of the ladder declares that subset here,
 * with the product reason. It never keeps a list of its own — that is how the
 * New Class form came to offer Grades 4-7 while the Assessment Studio offered
 * Nursery to Form 4, and a teacher could make a Grade 7 class but not a Grade 7
 * paper.
 *
 * The default is the FULL ladder. A feature absent from this table gets every
 * grade its curriculum defines.
 */
export const FEATURE_GRADE_RESTRICTIONS = Object.freeze({
  /**
   * The learner-facing quiz/lesson catalogue is authored for upper primary
   * only — those are the grades content actually exists for, and offering a
   * grade with no content is a dead end rather than a restriction.
   */
  'learner-catalogue': Object.freeze({
    codes: Object.freeze(['G4', 'G5', 'G6', 'G7']),
    reason: 'Learner quizzes and lessons are authored for upper primary only; ' +
      'other grades have no published content yet.',
  }),
  /**
   * ECZ publishes past papers for the two national examination years.
   */
  'past-papers': Object.freeze({
    codes: Object.freeze(['G7', 'G12']),
    reason: 'ECZ sets national examinations at Grade 7 (PSLE) and Grade 12 ' +
      '(School Certificate) only.',
  }),
  /**
   * School-Based Assessment is an upper-primary OBC instrument (10% banked per
   * grade across Grades 5-7).
   */
  sba: Object.freeze({
    codes: Object.freeze(['G5', 'G6', 'G7']),
    reason: 'SBA is an upper-primary OBC instrument — 10% banked per grade ' +
      'across Grades 5-7, 30% total.',
  }),
})

/**
 * The grades a feature offers: the canonical ladder for the curriculum,
 * narrowed by a declared restriction if the feature has one.
 *
 * An unknown featureId returns the full list — a feature that has not declared a
 * restriction does not have one.
 */
export function gradesForFeature(featureId, curriculumId) {
  const all = gradesForCurriculum(curriculumId)
  const restriction = FEATURE_GRADE_RESTRICTIONS[featureId]
  if (!restriction) return all
  return all.filter((g) => restriction.codes.includes(g.code))
}

/** Why a feature restricts its grades, for the UI to explain. '' when it does not. */
export function gradeRestrictionReason(featureId) {
  return FEATURE_GRADE_RESTRICTIONS[featureId]?.reason || ''
}

/**
 * The bare Grade number a rung carries ('G4' → '4', 'Form 1' → '8'), or '' for
 * an ECE band that has no number.
 *
 * The learner-facing quiz/lesson catalogue keys its documents by this bare
 * number rather than the G-code, so a surface holding a canonical code and
 * querying that catalogue translates HERE — one named boundary — instead of
 * doing string surgery at each call site.
 */
export function gradeNumberOf(codeOrId) {
  const g = getGrade(codeOrId)
  return g && g.gradeNumber != null ? String(g.gradeNumber) : ''
}

/* ══════════════════════════════════════════════════════════════════════════
 * Migration helpers — used by scripts/migrate-canonical-education.mjs ONLY
 * ══════════════════════════════════════════════════════════════════════════
 * These fold a STORED value onto a canonical id. They return '' rather than
 * guessing, so the migration can fail loudly on anything unmapped. Do not call
 * them from a render path: a picker must render the canonical list, not repair
 * whatever it was handed.
 */

function migrationKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ')
}

/** Stored curriculum value → canonical curriculum id, or '' when unmapped. */
export function migrationCurriculumId(value) {
  const k = migrationKey(value)
  if (!k) return ''
  return CURRICULUM_MIGRATION_ALIASES[k] || ''
}

/** Stored grade value → canonical grade code, or '' when unmapped. */
export function migrationGradeCode(value) {
  const k = migrationKey(value)
  if (!k) return ''
  return GRADE_MIGRATION_ALIASES[k] || ''
}

/**
 * Stored subject value → canonical subject id, or '' when unmapped.
 *
 * Returns '' for an AMBIGUOUS value too (one that named two subjects). The
 * caller distinguishes the two cases with `ambiguousSubjectOptions()` so the
 * report can say "cannot map" versus "names two subjects, needs a human".
 */
export function migrationSubjectId(value) {
  const k = migrationKey(value)
  if (!k) return ''
  if (k in AMBIGUOUS_SUBJECT_VALUES) return ''
  // The combined maths/science area answers to the slug, two level-dependent
  // names and two syllabus SHEET names. They are declared once, in
  // mathsScienceArea.js, and matched through it rather than copied into the
  // table above — a second list of them is exactly what this module exists to
  // stop.
  if (isMathsScienceName(value)) return MATHS_SCIENCE_SUBJECT_KEY
  const direct = SUBJECT_MIGRATION_ALIASES[k]
  if (direct) return direct
  // A slugged spelling of a name already in the table ("social-studies",
  // "integrated_science") — fold the separators and try once more.
  const slugged = k.replace(/[^a-z0-9]+/g, ' ').trim()
  return SUBJECT_MIGRATION_ALIASES[slugged] || ''
}

/** The subjects an ambiguous stored value named, or null when it is not one. */
export function ambiguousSubjectOptions(value) {
  return AMBIGUOUS_SUBJECT_VALUES[migrationKey(value)] || null
}

/* ── Reading a record that has not been migrated yet ───────────────────────
 * A migration is eventually-consistent: records written before it ran still
 * carry their old spelling, and a display path must keep rendering them
 * correctly rather than printing a raw slug. These resolvers exist for that,
 * and ONLY that.
 *
 * The distinction that matters — and the one the fragmentation came from — is
 * between READING a stored value and BUILDING A PICKER. A picker must render
 * `CANONICAL_SUBJECTS` / `gradesForCurriculum()`; it must never be assembled
 * from an alias table, because that is how a studio ends up offering a
 * vocabulary no other studio shares. Reading is the opposite problem: be
 * generous, because the value is already written.
 */

/** A stored grade value → its canonical rung, or null. For READ paths. */
export function resolveStoredGrade(value) {
  return getGrade(value) || getGrade(migrationGradeCode(value))
}

/** A stored subject value → its canonical record, or null. For READ paths. */
export function resolveStoredSubject(value) {
  return getSubject(value) || getSubject(migrationSubjectId(value))
}

/**
 * The label to print for a stored grade value, whatever spelling it is in.
 * Falls back to the raw value so an unrecognised record shows what it holds
 * rather than an empty cell.
 */
export function storedGradeLabel(value, curriculumId) {
  const g = resolveStoredGrade(value)
  return g ? gradeLabel(g.code, curriculumId) : String(value ?? '')
}

/** The name to print for a stored subject value, whatever spelling it is in. */
export function storedSubjectName(value, curriculumId, grade) {
  const s = resolveStoredSubject(value)
  return s ? subjectName(s.id, curriculumId, grade) : String(value ?? '')
}
