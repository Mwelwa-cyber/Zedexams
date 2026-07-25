// Paper-generation taxonomy for "Create paper with AI" (CreatePaperModal).
//
// Pure helpers only — no React, no Firebase — so the bulk test suite can
// import this directly (scripts/test-paper-taxonomy.mjs) and so the studio
// AI modals share one source of truth for:
//   - the grades a paper can target (now incl. ECE Nursery/Reception),
//   - the test types (Exercise removed → lives in Worksheets; Monthly test
//     added),
//   - how many topics each test type may cover (cumulative tests cover many),
//   - canonical subject-key resolution + friendly labels.
//
// The actual subject + topic OPTION LISTS are derived from the live syllabus
// in syllabusTopicOptions.js; this file holds the static taxonomy + the
// label/key plumbing those hooks lean on.

import { normalizeSubject } from '../../config/curriculum.js'

// ── Grades ─────────────────────────────────────────────────────────────────
// The studio's own grade picker stays 1–12 (assessmentStudioMeta.js); the AI
// paper modal offers a CURRICULUM-AWARE grade + form list so CBC and the
// previous syllabus no longer show an identical set of grades/subjects:
//
//   • CBC (2023): ECE Nursery/Reception, Grade 1–6 (primary) and Form 1–4
//     (secondary). Grade 7 was abolished from primary in the 3-6-4-2
//     restructure. Secondary is labelled with FORMS — the CBC syllabus keys
//     Form 1–4 as G8–G11 (see syllabusMapping.sheetNameToGrade), so a form
//     option carries its G-code as the VALUE while it DISPLAYS "Form N".
//
//   • Previous (2013): Grade 1–7 (primary) + Form 1–5 (secondary). The 2013
//     syllabus keys secondary by Grade 8–12; those are surfaced as Form 1–5
//     (the historical labelling Zambian teachers know), mapping Form N →
//     G(N+7). No ECE bands — the 2013 data has none.
//
// Keeping the form VALUE as the KB grade code (G8…G12) means the syllabus
// subject/topic lookups and the server grounding both resolve; only the label
// changes. Values match functions/teacherTools/assessmentAllowlists.js.
const ECE_GRADE_OPTIONS = [
  { value: 'ECE_N', label: 'ECE — Nursery (3–4 yrs)' },
  { value: 'ECE_R', label: 'ECE — Reception (4–5 yrs)' },
]

const gradeOpt = (n) => ({ value: String(n), label: `Grade ${n}` })
// Form N → Grade (N+7); the value keeps the G-code the syllabus is keyed by.
const formOpt = (n) => ({ value: `G${n + 7}`, label: `Form ${n}` })

// CBC (2023): ECE + Grade 1–6 + Form 1–4.
const CBC_GRADE_OPTIONS = [
  ...ECE_GRADE_OPTIONS,
  ...[1, 2, 3, 4, 5, 6].map(gradeOpt),
  ...[1, 2, 3, 4].map(formOpt),
]

// Previous (2013): Grade 1–7 + Form 1–5.
const PREVIOUS_GRADE_OPTIONS = [
  ...[1, 2, 3, 4, 5, 6, 7].map(gradeOpt),
  ...[1, 2, 3, 4, 5].map(formOpt),
]

// The full universe of selectable grade values across both frameworks. Still
// exported for callers/tests that want the superset rather than one framework.
export const PAPER_GRADE_OPTIONS = [
  ...ECE_GRADE_OPTIONS,
  ...[1, 2, 3, 4, 5, 6, 7].map(gradeOpt),
  ...[1, 2, 3, 4, 5].map(formOpt),
]

const PAPER_GRADE_VALUES = new Set(
  [...CBC_GRADE_OPTIONS, ...PREVIOUS_GRADE_OPTIONS].map((g) => g.value),
)

export function isPaperGrade(value) {
  return PAPER_GRADE_VALUES.has(String(value || ''))
}

// Grade options for the chosen curriculum — CBC (2023) vs the previous 2013
// syllabus. See the note above for why the two lists differ (and why secondary
// is labelled with forms in both).
export function paperGradeOptions(framework = '2023') {
  return String(framework) === '2013' ? PREVIOUS_GRADE_OPTIONS : CBC_GRADE_OPTIONS
}

// ── Level identity + ordering (normalized IDs) ───────────────────────────────
// Every selectable level carries a STABLE id, its OFFICIAL label, an education
// stage and an EXPLICIT sort order so pickers never sort alphabetically (which
// interleaves "Grade 10" between "Grade 1" and "Grade 2", or lists Form 1
// before Grade 1). The `value` stays the KB-pipeline token the syllabus lookups
// + generators already speak — a bare number for primary grades, 'G8'..'G12'
// for the forms displayed as Form 1..5, and 'ECE_N'/'ECE_R' for the two ECE
// bands — so nothing downstream has to change to gain proper Form/Nursery
// labels. A Form is NEVER relabelled as a Grade: G8 is "Form 1", not "Grade 8".
export const LEVEL_STAGE_LABELS = {
  ece: 'Early Childhood',
  primary: 'Primary',
  secondary: 'Secondary',
}

const LEVEL_META = (() => {
  const m = {
    ECE_N: { id: 'nursery', label: 'Nursery', stage: 'ece', order: 10 },
    ECE_R: { id: 'reception', label: 'Reception', stage: 'ece', order: 20 },
  }
  // Primary grades 1–7 → bare-number values, order 40..100.
  for (let n = 1; n <= 7; n++) {
    m[String(n)] = { id: `grade-${n}`, label: `Grade ${n}`, stage: 'primary', order: 30 + n * 10 }
  }
  // Forms 1–5 → KB codes G8..G12, order 110..150 (always AFTER every grade).
  for (let n = 1; n <= 5; n++) {
    m[`G${n + 7}`] = { id: `form-${n}`, label: `Form ${n}`, stage: 'secondary', order: 100 + n * 10 }
  }
  return m
})()

// A legacy paper saved before secondary was surfaced as forms carries a bare
// secondary grade token ('8'..'12') that literally meant "Grade 8"…"Grade 12".
// Per the backward-compatibility rule we must NOT silently convert those to
// forms — keep the historical "Grade N" label and flag them as legacy.
export function isLegacySecondaryGrade(value) {
  const n = Number(String(value ?? '').trim())
  return Number.isInteger(n) && n >= 8 && n <= 12
}

/**
 * Normalized level descriptor for a picker/stored value:
 *   { id, label, stage, order }
 * Recognises the canonical option values, human labels ('Grade 4', 'Form 1',
 * 'Nursery') and legacy bare secondary numbers. Unknown values degrade to a
 * best-effort label so a paper never crashes on an unexpected grade token.
 */
export function paperLevel(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (LEVEL_META[raw]) return { value: raw, ...LEVEL_META[raw] }
  // Legacy bare secondary number → keep "Grade N", flag it.
  if (isLegacySecondaryGrade(raw)) {
    const n = Number(raw)
    return { value: raw, id: `grade-${n}`, label: `Grade ${n}`, stage: 'secondary', order: 100 + (n - 7) * 10, legacy: true }
  }
  // Human labels the studio sometimes stores ('Grade 4', 'Form 1', 'Nursery').
  const lower = raw.toLowerCase()
  if (lower === 'nursery') return { value: 'ECE_N', ...LEVEL_META.ECE_N }
  if (lower === 'reception') return { value: 'ECE_R', ...LEVEL_META.ECE_R }
  const form = lower.match(/^form\s*(\d)$/)
  if (form) {
    const code = `G${Number(form[1]) + 7}`
    if (LEVEL_META[code]) return { value: code, ...LEVEL_META[code] }
  }
  const grade = lower.match(/^grade\s*(\d{1,2})$/)
  if (grade) {
    const n = Number(grade[1])
    if (LEVEL_META[String(n)]) return { value: String(n), ...LEVEL_META[String(n)] }
    if (n >= 8 && n <= 12) {
      return { value: String(n), id: `grade-${n}`, label: `Grade ${n}`, stage: 'secondary', order: 100 + (n - 7) * 10, legacy: true }
    }
  }
  return { value: raw, id: raw, label: raw, stage: 'unknown', order: 999 }
}

/** Official display label for a grade/level value ('Grade 4' / 'Form 1' / 'Nursery'). */
export function paperGradeLabel(value) {
  return paperLevel(value)?.label || String(value ?? '')
}

/** Sort level descriptors/options into the fixed educational order. */
export function orderLevels(levels) {
  return [...(levels || [])].sort((a, b) => (a?.order ?? 999) - (b?.order ?? 999))
}

/**
 * Enriched, ordered level options for a curriculum framework — the same values
 * paperGradeOptions returns, decorated with { id, label, stage, order, group }.
 */
export function paperLevelOptions(framework = '2023') {
  return orderLevels(
    paperGradeOptions(framework).map((o) => {
      const meta = LEVEL_META[o.value] || paperLevel(o.value)
      return {
        value: o.value,
        label: meta?.label || o.label,
        id: meta?.id,
        stage: meta?.stage,
        order: meta?.order,
        group: LEVEL_STAGE_LABELS[meta?.stage] || 'Other',
      }
    }),
  )
}

/**
 * The levels genuinely available for a curriculum, given the set of KB grade
 * codes that actually have syllabus records under it. This is the source of
 * truth the pickers use: a level is shown ONLY when the Syllabi Studio carries
 * data for it under the selected curriculum — no universal Grade 1–12 list.
 *
 * @param {object} args
 * @param {'cbc'|'previous'|'2023'|'2013'} args.curriculumId
 * @param {Iterable<string>|null} args.gradeCodes  KB codes present in the syllabus
 *   (e.g. ['G4','G8','ECE_N']). When null/undefined the full curriculum list is
 *   returned (the syllabus index hasn't resolved yet) rather than an empty one.
 * @returns enriched, ordered level options
 */
export function getAvailableLevels({ curriculumId = 'cbc', gradeCodes = null } = {}) {
  const framework = curriculumId === 'previous' || curriculumId === '2013' ? '2013' : '2023'
  const all = paperLevelOptions(framework)
  if (!gradeCodes) return all
  const present = gradeCodes instanceof Set ? gradeCodes : new Set(gradeCodes)
  if (present.size === 0) return []
  return all.filter((o) => present.has(studioGradeToKbGrade(o.value)))
}

// Coerce a grade arriving from the studio header (bare '4'…'12', 'Grade 8'),
// a legacy paper (KB code 'G10'), or a form label ('Form 2') into the value
// scheme the modal's grade <select> uses: primary grades stay bare numbers,
// secondary becomes its G-code (shown as a Form). Unrecognised values pass
// through so downstream validation can still reject genuine garbage.
export function normalizePaperGrade(grade) {
  const raw = String(grade || '').trim()
  if (!raw) return ''
  if (isPaperGrade(raw)) return raw
  const upper = raw.toUpperCase()
  if (upper === 'ECE') return 'ECE_N'
  if (upper === 'ECE_N' || upper === 'ECE_R') return upper
  const form = upper.match(/^F(?:ORM)?\s*(\d)$/)
  if (form) {
    const n = Number(form[1])
    if (n >= 1 && n <= 5) return `G${n + 7}`
  }
  const num = upper.match(/^(?:GRADE\s*|G)?(\d{1,2})$/)
  if (num) {
    const n = Number(num[1])
    if (n >= 1 && n <= 7) return String(n)
    if (n >= 8 && n <= 12) return `G${n}`
  }
  return raw
}

// Studio grade value ('4', 'ECE_N') → KB grade code ('G4', 'ECE_N'). The ECE
// family + already-prefixed G/F codes pass through unchanged; bare numbers
// get the G-prefix.
export function studioGradeToKbGrade(grade) {
  const g = String(grade || '').trim().toUpperCase()
  if (!g) return ''
  return g.startsWith('G') || g.startsWith('F') || g.startsWith('ECE') ? g : `G${g}`
}

// ── Assessment types (canonical registry) ──────────────────────────────────
// ONE authoritative list of every selectable assessment type, shared by the
// builder's own type <select>, the "Create with AI" modal, the library
// filters, cover-title generation and export formatting. There is no longer
// a route-level "test studio" vs "exam studio" split — the studio a paper
// belongs to is entirely determined by which type the teacher picked here,
// and every type below can be created from the same /teacher/assessment-papers
// studio. Values match the server's canonical ASSESSMENT_TYPES
// (functions/teacherTools/assessmentFormats.js) exactly, so the value chosen
// in the picker reaches generateAssessment unchanged — no relabelling, no
// collapsing distinct exam types onto a single 'mock_exam' format id.
export const ASSESSMENT_TYPES = {
  topic_test: { label: 'Topic Test', category: 'test' },
  weekly_test: { label: 'Weekly Test', category: 'test' },
  mid_term: { label: 'Mid-Term Test', category: 'test' },
  end_of_term: { label: 'End-of-Term Test', category: 'test' },
  mock_exam: { label: 'Mock Examination', category: 'examination' },
  examination: { label: 'Examination', category: 'examination' },
  final_exam: { label: 'Final Examination', category: 'examination' },
}

export const ASSESSMENT_TYPE_VALUES = Object.keys(ASSESSMENT_TYPES)
export const TEST_ASSESSMENT_TYPES = ASSESSMENT_TYPE_VALUES.filter(
  (t) => ASSESSMENT_TYPES[t].category === 'test',
)
export const EXAMINATION_ASSESSMENT_TYPES = ASSESSMENT_TYPE_VALUES.filter(
  (t) => ASSESSMENT_TYPES[t].category === 'examination',
)

// Legacy stored values that predate the canonical registry (from the old
// route-scoped 'test'/'exam' studio wording, and from assessment types that
// were trimmed from the picker but still exist in saved documents). Mapped
// onto the nearest canonical type so old papers keep working without a
// destructive migration — see normalizeAssessmentType.
const LEGACY_TYPE_MAP = {
  topic: 'topic_test',
  weekly: 'weekly_test',
  test: 'topic_test',
  mock: 'mock_exam',
  exam: 'examination',
  monthly: 'mid_term',
  monthly_test: 'mid_term',
  diagnostic: 'topic_test',
  pre_test: 'topic_test',
  post_test: 'topic_test',
  revision: 'topic_test',
  continuous: 'topic_test',
  summative: 'end_of_term',
  practical: 'topic_test',
  oral: 'topic_test',
  project: 'end_of_term',
}

/**
 * Normalize any stored/legacy/route-scoped assessment-type string to one of
 * the 7 canonical registry keys. Never throws — an unrecognised value falls
 * back to 'topic_test' (the safest, narrowest default) rather than crashing
 * a paper that predates the current type list. This is read-only: callers
 * must NOT use the normalized value to silently rewrite the saved document —
 * only persist it on the next explicit save (see AssessmentStudio).
 */
export function normalizeAssessmentType(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return 'topic_test'
  if (ASSESSMENT_TYPES[raw]) return raw
  return LEGACY_TYPE_MAP[raw] || 'topic_test'
}

/** 'test' | 'examination' for any canonical or legacy assessment-type value. */
export function assessmentCategory(value) {
  return ASSESSMENT_TYPES[normalizeAssessmentType(value)].category
}

export function isExaminationType(value) {
  return assessmentCategory(value) === 'examination'
}

// Back-compat alias — several call sites still import isExamPaperType.
export const isExamPaperType = isExaminationType

/** Official display label — recognises canonical AND legacy values. */
export function assessmentTypeLabel(value) {
  const raw = String(value || '').trim().toLowerCase()
  return ASSESSMENT_TYPES[raw]?.label || ASSESSMENT_TYPES[normalizeAssessmentType(raw)].label
}

// Both test papers and examination papers live in the `assessments`
// collection and are edited by the same AssessmentStudio, at one canonical
// route family — the type the teacher picked no longer changes which studio
// route a paper opens in.
export function assessmentRouteBase() {
  return '/teacher/assessment-papers'
}

export function assessmentEditPath(assessment) {
  const id = assessment?.id
  if (!id) return null
  return `/teacher/assessment-papers/${id}/edit`
}

// How many topics each type may cover. Topic and weekly tests are narrow; an
// end-of-term paper is cumulative and should span everything the class has
// learned, so its cap is large and the modal offers an "Add all topics"
// shortcut for it. Every examination type is cumulative — an exam covers the
// whole syllabus — so they carry the largest cap.
const TOPIC_CAPS = {
  topic_test: 3,
  weekly_test: 3,
  mid_term: 6,
  end_of_term: 15,
  mock_exam: 15,
  examination: 15,
  final_exam: 15,
}
const DEFAULT_TOPIC_CAP = 3

export function maxTopicsFor(assessmentType) {
  return TOPIC_CAPS[normalizeAssessmentType(assessmentType)] || DEFAULT_TOPIC_CAP
}

// Cumulative papers (end of term / examinations) are expected to draw on
// every topic covered, so the modal surfaces a one-click "Add all topics"
// affordance.
export function isCumulativeType(assessmentType) {
  return maxTopicsFor(assessmentType) >= 6
}

// ── Subjects ────────────────────────────────────────────────────────────
// Canonical CBC subject keys (as stored in the syllabus / accepted by the
// generator) mapped to teacher-facing labels. Lower-primary + ECE bundle
// strands under keys that don't look like the upper-grade subjects, so the
// labels spell out what each one contains.
const SUBJECT_LABELS = {
  english: 'English',
  mathematics: 'Mathematics',
  integrated_science: 'Integrated Science',
  social_studies: 'Social Studies',
  expressive_arts: 'Expressive Arts',
  technology_studies: 'Technology Studies',
  home_economics: 'Home Economics',
  zambian_language: 'Zambian Language (Cinyanja etc.)',
  numeracy: 'Numeracy (Maths & Science)',
  literacy: 'Literacy',
  creative_and_technology_studies: 'Creative & Technology Studies',
  religious_education: 'Religious Education',
  civic_education: 'Civic Education',
  physical_education: 'Physical Education',
  environmental_science: 'Environmental Science',
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology',
  geography: 'Geography',
  history: 'History',
  accounts: 'Accounts',
  cinyanja: 'Cinyanja',
  agricultural_science: 'Agricultural Science',
  art_and_design: 'Art & Design',
  // Two independently-numbered syllabi that used to share one key. Their topic
  // codes both start at 1.1 and are supposed to — see syllabusSubjectSplit.js.
  commerce: 'Commerce',
  principles_of_accounts: 'Principles of Accounts',
  // Own examinable subjects, own numbering. home_economics stays a real subject
  // (CBC Grades 4-6, 2013 Grades 5-7) — it just no longer swallows these two.
  food_and_nutrition: 'Food & Nutrition',
  home_management: 'Home Management',
  // Retained so a record saved before the split still renders a sensible label.
  // Never assigned to new content; the migration classifies these per record.
  commerce_and_principles_of_accounts: 'Commerce & Principles of Accounts',
  design_and_technology_studies: 'Design & Technology Studies',
  music_and_creative_arts: 'Music & Creative Arts',
}

export function subjectLabel(key) {
  const k = String(key || '').trim()
  if (!k) return ''
  return SUBJECT_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Fallback subject list when the syllabus can't be loaded for a grade — keeps
// the dropdown usable rather than empty.
export const FALLBACK_SUBJECT_KEYS = [
  'english', 'mathematics', 'integrated_science', 'social_studies',
  'expressive_arts', 'technology_studies', 'home_economics', 'zambian_language',
]

// Display label / slug / canonical key → canonical CBC subject key. Idempotent
// for values that are already canonical keys, so the dynamic subject dropdown
// (which yields keys) and a display label coming from paperMeta both resolve.
//
// The second group folds the verbose syllabi subject keys + ECE/Lower-Primary
// strand names surfaced by the standardized StudioCurriculumSelector into the
// canonical slug a subject genuinely IS (same subject, different label), so the
// selector never dead-ends on a real syllabus subject. Distinct senior/
// vocational subjects that have no core equivalent (Fashion & Fabrics, Food &
// Nutrition, Hospitality, Travel & Tourism, Literature in English) keep their
// own slug and are accepted by the generators' allowlists instead of folded.
const SUBJECT_FIXES = {
  expressive_art: 'expressive_arts',
  science: 'integrated_science',
  cinyanja: 'zambian_language',
  // Verbose grade-4-6 / forms-1-4 subject-key variants → canonical slug.
  english_language: 'english',
  mathematics_ii: 'mathematics',
  home_economics_hospitality: 'home_economics',
  ict: 'technology_studies',
  // ECE + Lower-Primary strand names (post cleanSubjectName) → canonical slug.
  maths_science: 'numeracy',
  pre_maths_science: 'numeracy',
  zambian_languages: 'zambian_language',
  creative_tech: 'creative_and_technology_studies',
  creative_technology: 'creative_and_technology_studies',
  // 2013-framework subjects whose derived slug differs from the KB's
  // canonical key ("Art & Design" → art_design vs KB art_and_design;
  // "Creative & Technology Studies" Grades 1-4 → creative_technology_studies).
  art_design: 'art_and_design',
  creative_technology_studies: 'creative_and_technology_studies',
  // CBC 2023 Forms 1-4 subjects whose "&" display names slug without the
  // "and" ("Commerce & Principles of Accounts" → commerce_principles_of_
  // accounts) — fold back to the canonical KB keys.
  design_technology_studies: 'design_and_technology_studies',
  music_creative_arts: 'music_and_creative_arts',
  // ── The subject split ──────────────────────────────────────────────────
  // One canonical identity per subject, so a topic code is unique within it.
  // 'accounts' and 'food_nutrition' were the teacher-picker spellings of
  // subjects the KB knows under fuller names; folding them keeps a saved pick
  // resolving to the same syllabus rows it always did.
  accounts: 'principles_of_accounts',
  principles_accounts: 'principles_of_accounts',
  food_nutrition: 'food_and_nutrition',
  //
  // 'commerce_and_principles_of_accounts' is deliberately NOT folded. It names
  // two subjects at once, so there is no single key to fold it to — that is the
  // whole reason for the split. It stays recognised (a label exists for it) and
  // scripts/migrate-subject-split.mjs classifies each saved record individually
  // from its own metadata rather than picking one here for all of them.
  commerce_principles_of_accounts: 'commerce_and_principles_of_accounts',
}

export function toKbSubjectKey(subject) {
  const s = String(subject || '').trim()
  if (!s) return ''
  // Already a canonical-looking key (lowercase + underscores, no spaces).
  if (/^[a-z][a-z_]*$/.test(s)) {
    const k = s.replace(/^_+|_+$/g, '')
    return SUBJECT_FIXES[k] || k
  }
  // Display labels may carry a parenthetical qualifier purely for the
  // teacher's benefit — "Zambian Language (Cinyanja etc.)", "Numeracy
  // (Maths & Science)". Strip it before slugging so the derived key matches
  // the canonical KB key ('zambian_language') instead of folding the
  // qualifier in ('zambian_language_cinyanja_etc'), which no allowlist knows.
  const bare = s.replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() || s
  const norm = normalizeSubject(bare)
  const key = String(norm || bare)
    .toLowerCase().trim().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '')
  return SUBJECT_FIXES[key] || key
}
