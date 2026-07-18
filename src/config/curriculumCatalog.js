/**
 * Canonical curriculum catalogue — the ONE authoritative API every teacher
 * studio must use to build its Curriculum → Grade → Subject → Topic → Subtopic
 * pickers.
 *
 * Why this file exists
 * ────────────────────
 * Curriculum/grade/subject selection was fragmented across ~30 modules in four
 * incompatible ID vocabularies (see docs/architecture/06-curriculum-architecture.md).
 * Studios each maintained their own grade list, subject list, alias map or
 * fallback, so the SAME curriculum + grade produced different subjects in
 * different studios — and a subject that was invalid for the grade could linger
 * and break the topic lookup ("no syllabus topics on file").
 *
 * This module is a THIN, PURE façade over the already-complete, node-testable
 * authority in `teacherTaxonomy.js` (which models subject × grade × curriculum,
 * both frameworks, ECE and the CBC-abolished Grade 7). It invents NO new
 * curriculum data — it only re-shapes the authority into the stable-ID contract
 * the studios and tests consume, and adds the fail-closed guarantees:
 *
 *   • Stable IDs everywhere ({ id, label, curriculumId, … }) — never the visible
 *     label as the database identity.
 *   • Aliases live ONLY in the normalize* layer.
 *   • Fail closed: an unknown/invalid curriculum+grade returns [] — NEVER a
 *     generic "all subjects" list and NEVER a CBC+OBC union.
 *   • CBC and OBC subject sets never mix.
 *
 * Topic / subtopic data is large and async (the merged Syllabi Studio JSON), so
 * it is supplied by a registered provider (see registerTopicProvider). The pure
 * subject/grade layer above stays deterministic and synchronous so parity and
 * regression tests run under plain `node`.
 *
 * Kept DOM-free and side-effect-free so `node` test scripts can import it.
 */

import {
  CURRICULUM_GRADE_STRUCTURES,
  gradeOptionsForCurriculum,
  isGradeInCurriculum,
  getSubjectsForGrade as taxonomySubjectsForGrade,
  isSubjectValidForGrade as taxonomySubjectValidForGrade,
} from './teacherTaxonomy.js'

/**
 * Bump when the SHAPE or the subject/grade DATA behind the catalogue changes in
 * a way that must invalidate cached selections. Persisted selections and cached
 * option lists are namespaced by this value; a mismatch discards the cache and
 * re-validates the saved selection (see useCurriculumSelection + Phase 6).
 */
export const CATALOGUE_SCHEMA_VERSION = '2026.07.1'

/* ── Curricula ────────────────────────────────────────────────────────────
 * Canonical curriculum ids are 'cbc' and 'obc'. Internally the taxonomy speaks
 * 'cbc' | 'previous'; toTaxonomyCurriculum() bridges the two so 'obc' is the
 * single public spelling of the 2013 outcome-based curriculum.
 */
const CURRICULA = [
  { id: 'cbc', label: 'Competency-Based Curriculum (CBC)', shortLabel: 'CBC', year: 2023 },
  { id: 'obc', label: 'Outcome-Based Curriculum (OBC)', shortLabel: 'OBC', year: 2013 },
]

const CURRICULUM_IDS = new Set(CURRICULA.map((c) => c.id))

// Alias table — the ONLY place curriculum spellings are folded. Never expands
// to a subject/grade that isn't valid for the resolved curriculum.
const CURRICULUM_ALIASES = {
  cbc: 'cbc', new: 'cbc', 2023: 'cbc', 'cbc-2023': 'cbc', 'competency-based': 'cbc',
  obc: 'obc', old: 'obc', previous: 'obc', 2013: 'obc', 'obc-2013': 'obc', 'outcome-based': 'obc',
}

/** Fold any spelling of a curriculum to its canonical id, or '' when unknown. */
export function normalizeCurriculumId(value) {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return ''
  if (CURRICULUM_IDS.has(s)) return s
  return CURRICULUM_ALIASES[s] || ''
}

/** The taxonomy's curriculum token ('cbc' | 'previous') for a canonical id. */
function toTaxonomyCurriculum(curriculumId) {
  const id = normalizeCurriculumId(curriculumId)
  if (id === 'cbc') return 'cbc'
  if (id === 'obc') return 'previous'
  return ''
}

/** All supported curricula, as stable-ID descriptors. */
export function getCurricula() {
  return CURRICULA.map((c) => ({ ...c }))
}

export function getCurriculum(curriculumId) {
  const id = normalizeCurriculumId(curriculumId)
  return CURRICULA.find((c) => c.id === id) || null
}

/* ── Grades ──────────────────────────────────────────────────────────────── */

/** Which stage a grade code sits in, for the current curriculum's structure. */
function stageForGrade(curriculumId, gradeId) {
  const mode = toTaxonomyCurriculum(curriculumId)
  const structure = CURRICULUM_GRADE_STRUCTURES[mode]
  if (!structure) return null
  for (const stage of structure.stages) {
    if (stage.grades.some((g) => g.value === gradeId)) {
      return { id: stage.id, label: stage.label }
    }
  }
  return null
}

/**
 * Grades/forms for a curriculum, as stable-ID descriptors:
 *   { id, label, curriculumId, stageId, stageLabel }
 * Fail closed: an unknown curriculum returns []. Group headers from the
 * taxonomy are dropped — callers group by stageId/stageLabel instead.
 */
export function getGradesForCurriculum(curriculumId) {
  const id = normalizeCurriculumId(curriculumId)
  if (!id) return []
  const opts = gradeOptionsForCurriculum(toTaxonomyCurriculum(id))
  const out = []
  for (const opt of opts) {
    if (opt.value === undefined) continue // <optgroup> header
    const stage = stageForGrade(id, opt.value)
    out.push({
      id: opt.value,
      label: opt.label,
      curriculumId: id,
      stageId: stage?.id || null,
      stageLabel: stage?.label || null,
    })
  }
  return out
}

// Grade label/number/code → canonical taxonomy grade code ('G4','ECE_N','G8').
const GRADE_ALIASES = {
  nursery: 'ECE_N', 'ece nursery': 'ECE_N', ece_n: 'ECE_N', ece: 'ECE_N',
  reception: 'ECE_R', ece_r: 'ECE_R',
}

/** Fold any grade spelling to the canonical G-code, or '' when unresolvable. */
export function normalizeGradeId(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const upper = raw.toUpperCase()
  // Already a canonical code.
  if (/^G\d{1,2}$/.test(upper) || upper === 'ECE_N' || upper === 'ECE_R' || upper === 'ECE') {
    return upper === 'ECE' ? 'ECE_N' : upper
  }
  const lower = raw.toLowerCase()
  if (GRADE_ALIASES[lower]) return GRADE_ALIASES[lower]
  // Form N → G(N+7).
  const form = lower.match(/^form\s*(\d{1,2})$/)
  if (form) {
    const n = Number(form[1])
    if (n >= 1 && n <= 5) return `G${n + 7}`
  }
  // "Grade N" or a bare number → GN.
  const grade = lower.match(/^(?:grade\s*)?(\d{1,2})$/)
  if (grade) {
    const n = Number(grade[1])
    if (n >= 1 && n <= 12) return `G${n}`
  }
  return ''
}

/* ── Subjects ────────────────────────────────────────────────────────────── */

// Display-label / slug / legacy-value → canonical underscore subject slug. This
// is the ONLY place subject aliases live. It never manufactures a subject that
// isn't in the taxonomy vocabulary — an unknown value slugs to a best-effort key
// that validateSelection will then reject if it isn't valid for the grade.
const SUBJECT_ALIASES = {
  science: 'integrated_science',
  'integrated science': 'integrated_science',
  integrated_science: 'integrated_science',
  english_language: 'english',
  'english language': 'english',
  cinyanja: 'cinyanja',
  'zambian language': 'zambian_language',
  'zambian languages': 'zambian_language',
  zambian_languages: 'zambian_language',
  'expressive art': 'expressive_arts',
  'expressive arts': 'expressive_arts',
  expressive_art: 'expressive_arts',
  numeracy: 'numeracy',
  'maths & science': 'numeracy',
  'mathematics and science': 'numeracy',
  'pre-maths & science': 'numeracy',
  'creative & technology studies': 'creative_and_technology_studies',
  'creative and technology studies': 'creative_and_technology_studies',
  creative_technology_studies: 'creative_and_technology_studies',
  ict: 'technology_studies',
}

/**
 * Fold any subject value (display label with a parenthetical qualifier, slug,
 * or legacy value) to its canonical underscore slug. Aliases are applied here
 * and nowhere else. Returns '' for an empty value.
 */
export function normalizeSubjectId(value) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  // Already a canonical-looking slug.
  if (/^[a-z][a-z_]*$/.test(s)) {
    const k = s.replace(/^_+|_+$/g, '')
    return SUBJECT_ALIASES[k] || k
  }
  // Strip a teacher-facing parenthetical ("Numeracy (Maths & Science)") before
  // slugging so the derived key matches the canonical slug rather than folding
  // the qualifier in.
  const bare = s.replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() || s
  const lower = bare.toLowerCase()
  if (SUBJECT_ALIASES[lower]) return SUBJECT_ALIASES[lower]
  const key = lower.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return SUBJECT_ALIASES[key] || key
}

/**
 * Subjects valid for a curriculum + grade, as stable-ID descriptors:
 *   { id, label, curriculumId, gradeId }
 *
 * Fail closed (Phase 3): an unknown/invalid curriculum+grade returns [] — never
 * a generic all-subjects list, never a CBC+OBC union. CBC and OBC subject sets
 * never mix because the taxonomy filters strictly per curriculum.
 */
export function getSubjectsForGrade(curriculumId, gradeId) {
  const cid = normalizeCurriculumId(curriculumId)
  const gid = normalizeGradeId(gradeId)
  if (!cid || !gid) return []
  if (!isGradeInCurriculum(gid, toTaxonomyCurriculum(cid))) return []
  const opts = taxonomySubjectsForGrade(gid, toTaxonomyCurriculum(cid))
  const out = []
  for (const opt of opts) {
    if (opt.value === undefined) continue // <optgroup> header
    out.push({
      id: opt.value,
      label: opt.label,
      curriculumId: cid,
      gradeId: gid,
    })
  }
  return out
}

/**
 * The canonical subject-id list a studio must render for a curriculum + grade.
 * Every studio wired to this catalogue gets an IDENTICAL list by construction —
 * the cross-studio parity guarantee (Phase 9). `studioId` is accepted for the
 * diagnostic/parity contract but never changes the result.
 */
export function getStudioSubjectIds(studioId, curriculumId, gradeId) {
  return getSubjectsForGrade(curriculumId, gradeId).map((s) => s.id)
}

/** True when the subject is valid for the curriculum + grade (fail closed). */
export function isSubjectValidForSelection(curriculumId, gradeId, subjectId) {
  const cid = normalizeCurriculumId(curriculumId)
  const gid = normalizeGradeId(gradeId)
  const sid = normalizeSubjectId(subjectId)
  if (!cid || !gid || !sid) return false
  if (!isGradeInCurriculum(gid, toTaxonomyCurriculum(cid))) return false
  return taxonomySubjectValidForGrade(sid, gid, toTaxonomyCurriculum(cid))
}

/* ── Topics / subtopics (provider-backed, async data) ─────────────────────
 * Topic/subtopic data is the large, async merged Syllabi Studio catalogue, so
 * it is supplied by a registered provider rather than baked into this pure
 * module. With no provider attached the getters fail closed (empty), never a
 * fallback list. The app registers the syllabi-backed provider once at startup;
 * tests register a small fixture.
 */
let _topicProvider = null

/**
 * Register the topic/subtopic data source. The provider is an object:
 *   {
 *     getTopics(curriculumId, gradeId, subjectId) => Promise<string[]>|string[]
 *     getSubtopics(curriculumId, gradeId, subjectId, topicId) => Promise<string[]>|string[]
 *     source: string   // e.g. 'syllabi-merged' — surfaced in diagnostics
 *   }
 */
export function registerTopicProvider(provider) {
  _topicProvider = provider || null
}

export function getTopicProviderSource() {
  return _topicProvider?.source || 'unavailable'
}

/** Topics for a subject (fail closed to [] with no provider). */
export async function getTopicsForSubject(curriculumId, gradeId, subjectId) {
  const cid = normalizeCurriculumId(curriculumId)
  const gid = normalizeGradeId(gradeId)
  const sid = normalizeSubjectId(subjectId)
  if (!cid || !gid || !sid || !_topicProvider) return []
  if (!isSubjectValidForSelection(cid, gid, sid)) return []
  const topics = await _topicProvider.getTopics(cid, gid, sid)
  return Array.isArray(topics) ? topics : []
}

/** Subtopics for a topic (fail closed to [] with no provider). */
export async function getSubtopicsForTopic(curriculumId, gradeId, subjectId, topicId) {
  const cid = normalizeCurriculumId(curriculumId)
  const gid = normalizeGradeId(gradeId)
  const sid = normalizeSubjectId(subjectId)
  const topic = String(topicId ?? '').trim()
  if (!cid || !gid || !sid || !topic || !_topicProvider) return []
  const subs = await _topicProvider.getSubtopics(cid, gid, sid, topic)
  return Array.isArray(subs) ? subs : []
}

/* ── Validation ──────────────────────────────────────────────────────────── */

/**
 * Validate a full or partial selection against the canonical catalogue.
 * Returns { valid, reason, normalized } where `normalized` carries the
 * canonical ids so a caller can persist stable ids rather than labels.
 *
 * The subject level is validated against the curriculum + grade; topic and
 * subtopic are shape-checked only (their data is async) so this stays pure.
 * `reason` is one of the stable machine tokens the diagnostics + UI use.
 */
export function validateCurriculumSelection(selection = {}) {
  const cid = normalizeCurriculumId(selection.curriculumId)
  const gid = normalizeGradeId(selection.gradeId)
  const sid = normalizeSubjectId(selection.subjectId)
  const normalized = {
    curriculumId: cid,
    gradeId: gid,
    subjectId: sid,
    topicId: String(selection.topicId ?? '').trim(),
    subtopicId: String(selection.subtopicId ?? '').trim(),
    catalogueVersion: CATALOGUE_SCHEMA_VERSION,
  }
  if (selection.curriculumId != null && selection.curriculumId !== '' && !cid) {
    return { valid: false, reason: 'unknown_curriculum', normalized }
  }
  if (selection.gradeId != null && selection.gradeId !== '') {
    if (!gid) return { valid: false, reason: 'unknown_grade', normalized }
    if (cid && !isGradeInCurriculum(gid, toTaxonomyCurriculum(cid))) {
      return { valid: false, reason: 'grade_not_in_curriculum', normalized }
    }
  }
  if (selection.subjectId != null && selection.subjectId !== '') {
    if (!sid) return { valid: false, reason: 'unknown_subject', normalized }
    if (cid && gid && !isSubjectValidForSelection(cid, gid, sid)) {
      return { valid: false, reason: 'subject_not_valid_for_grade', normalized }
    }
  }
  return { valid: true, reason: '', normalized }
}
