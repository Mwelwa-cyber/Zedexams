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
import {
  EDUCATION_LEVELS, LEVEL_STAGE_LABELS as LADDER_STAGE_LABELS,
  levelsForFramework, resolveLevel, levelKbGrade, reportLevelResolution,
  levelAvailability, LEVEL_AVAILABILITY,
} from '../../config/educationLevels.js'
import {
  MATHS_SCIENCE_LABEL, MATHS_SCIENCE_SUBJECT_KEY, mathsScienceLabelForGrade,
  isMathsScienceName,
} from '../../config/mathsScienceArea.js'

// ── Grades ─────────────────────────────────────────────────────────────────
// Every level, its label, its syllabus code, its aliases and which curriculum
// defines it now come from ONE declaration: src/config/educationLevels.js.
// This file used to carry its own copies of those lists, which is how the ECE
// naming and the Form/Grade mapping ended up stated in several places at once.
//
// What the ladder encodes, so it is not re-derived here:
//   • Early Childhood is exactly Nursery then Reception, one per published ECE
//     age band. "Baby Class" and "Middle Class" are NOT levels and are never
//     displayed — they are legacy spellings that normalise onto Nursery so an
//     old record still opens.
//   • Secondary VALUES stay the KB grade codes (G8…G12) and DISPLAY as Form
//     1–5, with "Grade 8"…"Grade 12" declared as aliases of the same level, so
//     a school using either naming lands on one curriculum year.
//   • CBC (2023) abolished Grade 7 and stops at Form 4; the previous (2013)
//     syllabus runs Grade 1–7 and Form 1–5 and has no ECE bands.
//
// Being OFFERED additionally requires syllabus rows on file — see
// getAvailableLevels below.
const optionOf = (level) => ({ value: level.value, label: level.label })

const CBC_GRADE_OPTIONS = levelsForFramework('2023').map(optionOf)
const PREVIOUS_GRADE_OPTIONS = levelsForFramework('2013').map(optionOf)

// The full universe of selectable grade values across both frameworks. Still
// exported for callers/tests that want the superset rather than one framework.
export const PAPER_GRADE_OPTIONS = EDUCATION_LEVELS.map(optionOf)

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

// ── Level identity + ordering ───────────────────────────────────────────────
// Resolution, labels, stages and ordering all come from the ladder. Pickers
// sort on the ladder's explicit `order` so they never sort alphabetically
// (which interleaves "Grade 10" between "Grade 1" and "Grade 2", or lists Form
// 1 before Grade 1).
export const LEVEL_STAGE_LABELS = LADDER_STAGE_LABELS

// A paper saved before secondary was surfaced as forms carries a bare secondary
// token ('8'..'12') that literally meant "Grade 8"…"Grade 12". Those ARE the
// Form years under their alternative naming — the ladder declares "Grade 8" as
// an alias of Form 1 — but the historical label is kept and the descriptor
// flagged `legacy`, so an old paper still prints the words it was saved with
// and no display silently rewrites itself.
export function isLegacySecondaryGrade(value) {
  const n = Number(String(value ?? '').trim())
  return Number.isInteger(n) && n >= 8 && n <= 12
}

/**
 * Normalized level descriptor for a picker/stored value:
 *   { value, id, label, stage, order }
 * Resolves canonical values, official labels, display aliases ('Grade 10' →
 * Form 3) and the retired ECE spellings ('Baby Class' / 'Middle Class' →
 * Nursery). Unknown values degrade to a best-effort label so a paper never
 * crashes on an unexpected grade token.
 */
export function paperLevel(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  // Legacy bare secondary number → keep the historical "Grade N" wording.
  if (isLegacySecondaryGrade(raw)) {
    const n = Number(raw)
    return {
      value: raw, id: `grade-${n}`, label: `Grade ${n}`,
      stage: 'secondary', order: 100 + (n - 7) * 10, legacy: true,
    }
  }
  const level = resolveLevel(raw)
  if (level) {
    return {
      value: level.value, id: level.id, label: level.label,
      stage: level.stage, order: level.order,
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
    levelsForFramework(framework).map((level) => ({
      value: level.value,
      label: level.label,
      id: level.id,
      stage: level.stage,
      order: level.order,
      band: level.band,
      group: LEVEL_STAGE_LABELS[level.stage] || 'Other',
    })),
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
  return getLevelCatalogue({ curriculumId, gradeCodes })
    .filter((o) => o.availability === LEVEL_AVAILABILITY.AVAILABLE)
}

/**
 * EVERY level of a curriculum, each annotated with whether it can actually be
 * used and why not — so a picker can show a recognised level whose syllabus has
 * not been loaded, with words explaining that, instead of just omitting it and
 * leaving the teacher staring at a gap.
 *
 * A level is never silently replaced by one from the other curriculum: an
 * unavailable level stays unselectable and says which curriculum defines it.
 *
 * @returns {Array<{value,label,id,stage,order,band,group,availability,message,unavailable}>}
 */
export function getLevelCatalogue({ curriculumId = 'cbc', gradeCodes = null } = {}) {
  const framework = curriculumId === 'previous' || curriculumId === '2013' ? '2013' : '2023'
  return paperLevelOptions(framework).map((option) => {
    const { availability, message } = levelAvailability(option.value, { framework, gradeCodes })
    return {
      ...option,
      availability,
      message,
      unavailable: availability !== LEVEL_AVAILABILITY.AVAILABLE,
    }
  })
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
  // The ladder resolves every declared spelling — official label, display alias
  // ("Grade 10" → Form 3) — and the retired ones ("Baby Class", "Middle Class",
  // a bare "ECE"), which normalise onto Nursery rather than leaving a record
  // pointing at a level no picker offers. A legacy or ambiguous match is logged
  // so it can be noticed and normalised, not silently carried forever.
  const level = reportLevelResolution(raw, 'normalizePaperGrade').level
  if (level) return level.value
  return raw
}

// ── Level availability (curriculum × syllabus coverage) ─────────────────────
// Re-exported so the studio pickers can tell the four cases apart — a level we
// do not know, a real level whose syllabus has not been loaded, a level the
// OTHER curriculum defines, and one that is genuinely ready — and say the right
// thing for each instead of showing an unexplained empty dropdown.
export { levelAvailability, LEVEL_AVAILABILITY }

// Studio grade value ('4', 'ECE_B', 'Form 3') → the KB grade code its syllabus
// is filed under ('G4', 'ECE_N', 'G10'). This is the one place the mapping is
// applied: Baby Class stores ECE_B but grounds on the 3-4 year syllabus, and
// Middle Class and Reception both ground on the 4-5 year one, so the code
// cannot be derived from the value by string surgery. Unknown values fall back
// to the historical prefix rule so an unexpected token still resolves to
// something the lookups can reject cleanly.
export function studioGradeToKbGrade(grade) {
  const mapped = levelKbGrade(grade)
  if (mapped) return mapped
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
/**
 * Does `map` DECLARE `key` — as opposed to inheriting it from Object.prototype?
 *
 * `map[key]` is truthy for 'constructor', '__proto__', 'toString' and friends
 * on any object literal, so a bare lookup is not a membership test: a stored
 * `assessmentType` of "__proto__" used to pass the registry check here, be
 * returned as if canonical, and then reach paperNaming's SHORT_TYPE table,
 * where `build(term)` threw "build is not a function" and took the render down
 * with it. "constructor" was quieter and worse — it returned an Object wrapper
 * where every caller expects a string. Neither value is reachable through the
 * picker; both are reachable in a saved document. (CodeQL #77.)
 *
 * hasOwnProperty.call rather than Object.hasOwn: no browser-support floor to
 * think about, and these run on whatever device a school actually has.
 */
function declares(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key)
}

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
  if (declares(ASSESSMENT_TYPES, raw)) return raw
  return declares(LEGACY_TYPE_MAP, raw) ? LEGACY_TYPE_MAP[raw] : 'topic_test'
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
  if (declares(ASSESSMENT_TYPES, raw)) return ASSESSMENT_TYPES[raw].label
  return ASSESSMENT_TYPES[normalizeAssessmentType(raw)].label
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
  // The combined CBC maths/science area. It is stored under the `numeracy`
  // slug, but "Numeracy" is not what the syllabus calls it and not what may
  // print on a paper — subjectLabel() takes the grade so Nursery/Reception get
  // "Pre-Mathematics and Science" instead. See src/config/mathsScienceArea.js.
  numeracy: MATHS_SCIENCE_LABEL,
  literacy: 'Literacy',
  creative_and_technology_studies: 'Creative & Technology Studies',
  religious_education: 'Religious Education',
  religious_education_2044: 'Religious Education 2044',
  religious_education_2046: 'Religious Education 2046',
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
  // The second Forms 1-4 mathematics syllabus, numbered from 1.1 like the first.
  // It used to fold into `mathematics`, which collided 29 of their codes.
  mathematics_ii: 'Mathematics II',
  // Its own Forms 1-4 syllabus, numbered from 1.1.1 like the English language
  // one. It used to fold into `english`, which collided 4 of their codes.
  literature_in_english: 'Literature in English',
  // Own examinable subjects, own numbering. home_economics stays a real subject
  // (CBC Grades 4-6, 2013 Grades 5-7) — it just no longer swallows these four.
  food_and_nutrition: 'Food & Nutrition',
  home_management: 'Home Management',
  fashion_and_fabrics: 'Fashion & Fabrics',
  hospitality_management: 'Hospitality Management',
  // Retained so a record saved before the split still renders a sensible label.
  // Never assigned to new content; the migration classifies these per record.
  commerce_and_principles_of_accounts: 'Commerce & Principles of Accounts',
  design_and_technology_studies: 'Design & Technology Studies',
  music_and_creative_arts: 'Music & Creative Arts',
}

/**
 * Teacher-facing label for a canonical subject key.
 *
 * `grade` is optional and only changes the combined maths/science area, whose
 * name differs by level ("Pre-Mathematics and Science" at Nursery/Reception,
 * "Mathematics and Science" from Grade 1). Pass it wherever the grade is known
 * — a dropdown built for a level, a saved paper's header — so an ECE paper
 * never prints the primary name.
 */
export function subjectLabel(key, grade) {
  const k = String(key || '').trim()
  if (!k) return ''
  if (k === MATHS_SCIENCE_SUBJECT_KEY) return mathsScienceLabelForGrade(grade)
  // `declares`, not `SUBJECT_LABELS[k] ||`: a subject key of 'constructor'
  // returned the Object CONSTRUCTOR from this lookup, so a paper header and
  // every subject dropdown got a function where they print a string.
  // '__proto__' returned Object.prototype. React renders neither. (CodeQL #77
  // family — same defect, a lookup the first pass did not reach.)
  if (declares(SUBJECT_LABELS, k)) return SUBJECT_LABELS[k]
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
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
// Nutrition, Hospitality Management, Travel & Tourism, Literature in English)
// keep their own slug and are accepted by the generators' allowlists instead of
// folded.
const SUBJECT_FIXES = {
  expressive_art: 'expressive_arts',
  science: 'integrated_science',
  cinyanja: 'zambian_language',
  // Verbose grade-4-6 / forms-1-4 subject-key variants → canonical slug.
  english_language: 'english',
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
  fashion_fabrics: 'fashion_and_fabrics',
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
  // The combined maths/science area answers to more spellings than any other
  // subject — the slug, two level-dependent labels, two syllabus sheet names
  // and the old parenthesised one. They all mean the same syllabus rows, so
  // they fold in one place rather than as five entries below.
  if (isMathsScienceName(s)) return MATHS_SCIENCE_SUBJECT_KEY
  // Already a canonical-looking key (lowercase + underscores, no spaces).
  if (/^[a-z][a-z_]*$/.test(s)) {
    const k = s.replace(/^_+|_+$/g, '')
    return declares(SUBJECT_FIXES, k) ? SUBJECT_FIXES[k] : k
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
  // Same guard as above. This value becomes a KB lookup key and reaches
  // Firestore paths, so a function here does not stay a rendering problem.
  return declares(SUBJECT_FIXES, key) ? SUBJECT_FIXES[key] : key
}
