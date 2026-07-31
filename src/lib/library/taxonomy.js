/**
 * Library taxonomy — an ADAPTER over the platform's existing declarations,
 * never a second registry.
 *
 * Two files already own this vocabulary and both keep owning it:
 *
 *   src/config/educationLevels.js   the Zambian education ladder (ids, labels,
 *                                   stages, order, aliases, which framework
 *                                   declares each level)
 *   src/config/curriculumCatalog.js the curriculum ids (cbc / obc) + the alias
 *                                   table that folds every spelling in the repo
 *
 * This module re-shapes those into the four things the library needs — a grade
 * id, a display label, a group, and a sort order — plus tolerant normalisers
 * the future migration reuses. It declares NO grade, NO curriculum and NO label
 * of its own. A grade list living here would recreate exactly the drift the
 * smart-folder work exists to remove: two sources of truth for what a Grade 4
 * is, disagreeing the first time one of them changes.
 *
 * IDENTITY NOTE (this is the one thing to get right before reading further):
 * a GradeId is `educationLevels.js`'s `id` — 'nursery', 'reception', 'grade-4',
 * 'form-2' — NOT the shorthand 'g4'/'f2' the spec sketched, and NOT the stored
 * `value` ('4', 'G9', 'ECE_N'). The ladder's own id is the only spelling that
 * is already canonical everywhere else in the app, so grouping documents by it
 * means the library and the studios agree by construction.
 *
 * Pure — no React, no Firebase — so the plain-node suite imports it directly.
 */

import {
  EDUCATION_LEVELS,
  LEVEL_STAGES,
  LEVEL_STAGE_LABELS,
  levelResolution,
  levelsForFramework,
} from '../../config/educationLevels.js'
import {
  getCurricula,
  getSubjectsForGrade,
  normalizeCurriculumId,
  normalizeSubjectId,
} from '../../config/curriculumCatalog.js'

/* ── Grades ──────────────────────────────────────────────────── */

/**
 * Spellings `educationLevels.js` does not carry because nothing else in the app
 * produces them, but a free-text migration will meet: written-out numbers, and
 * the compact 'gr4' form. Keyed by the ladder's canonical id, so this map can
 * never introduce a level — only another way to spell one.
 */
const WORD_NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven']

const EXTRA_ALIASES = (() => {
  const map = {}
  WORD_NUMBERS.forEach((word, index) => {
    const n = index + 1
    map[`grade-${n}`] = [`grade ${word}`, `gr ${n}`, `gr${n}`]
    if (n <= 5) map[`form-${n}`] = [`form ${word}`]
  })
  map.nursery = ['nursery class']
  map.reception = ['reception class']
  return map
})()

/**
 * The ladder, in library shape. `group`/`groupLabel` are the ladder's `stage`
 * renamed for library callers; every other value is passed through untouched.
 *
 * @typedef {string} GradeId
 * @typedef {{
 *   id: GradeId, label: string, group: string, groupLabel: string,
 *   order: number, aliases: string[], value: string, kbGrade: string,
 *   frameworks: string[],
 * }} LibraryGrade
 */
export const LIBRARY_GRADES = Object.freeze(
  EDUCATION_LEVELS.map((level) => Object.freeze({
    id: level.id,
    label: level.label,
    group: level.stage,
    groupLabel: LEVEL_STAGE_LABELS[level.stage] || level.stage,
    order: level.order,
    // The ladder's own spellings, plus the library-only ones added below.
    aliases: Object.freeze([...level.aliases, ...(EXTRA_ALIASES[level.id] || [])]),
    value: level.value,
    kbGrade: level.kbGrade,
    frameworks: level.frameworks,
  })),
)

/** The ordered group ids ('ece' → 'primary' → 'secondary'). */
export const LIBRARY_GRADE_GROUPS = Object.freeze(
  LEVEL_STAGES.map((id) => Object.freeze({ id, label: LEVEL_STAGE_LABELS[id] || id })),
)

const GRADE_BY_ID = new Map(LIBRARY_GRADES.map((g) => [g.id, g]))

/** Every alias spelling → its grade id. Lower-cased, whitespace-collapsed. */
const GRADE_BY_ALIAS = (() => {
  const map = new Map()
  const put = (key, id) => {
    const k = normalizeKey(key)
    // First declaration wins — a spelling shared by two levels can never
    // silently flip which one it resolves to.
    if (k && !map.has(k)) map.set(k, id)
  }
  for (const grade of LIBRARY_GRADES) {
    put(grade.id, grade.id)
    for (const alias of grade.aliases) put(alias, grade.id)
  }
  return map
})()

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/* ── Curricula ───────────────────────────────────────────────── */

/**
 * @typedef {'cbc'|'obc'} CurriculumId
 */
export const CURRICULA = Object.freeze(
  getCurricula().map((c) => Object.freeze({
    id: c.id,
    label: c.label,
    shortLabel: c.shortLabel,
    /** The framework token `educationLevels.js` keys its `frameworks` on. */
    framework: c.id === 'obc' ? '2013' : '2023',
  })),
)

const CURRICULUM_BY_ID = new Map(CURRICULA.map((c) => [c.id, c]))

/**
 * Library-only legacy spellings. 'CDC' is the misspelling OBC shipped under
 * before it was renamed (see bucketIntoTree in teacherLibraryService.js);
 * 'Secondary' was a deprecated third folder root that is no longer selectable
 * and identifies no curriculum — it deliberately resolves to null so a document
 * filed under it reads as unclassified rather than as CBC by accident.
 */
const LEGACY_CURRICULUM_ALIASES = Object.freeze({ cdc: 'obc' })

/* ── Terms ───────────────────────────────────────────────────── */

/** @typedef {1|2|3} TermId */
export const TERMS = Object.freeze([1, 2, 3])

const TERM_WORDS = { one: 1, two: 2, three: 3, i: 1, ii: 2, iii: 3 }

/* ── Normalisers ─────────────────────────────────────────────── */

/**
 * Fold any spelling of a grade to its canonical id, or null when the ladder
 * does not define it. Case- and whitespace-insensitive, alias-aware.
 *
 * Returns null rather than a default: a document whose grade we cannot read is
 * unclassified, and saying so is the entire point of the Needs-sorting bucket.
 * Guessing here would file it somewhere wrong and look correct.
 *
 * @param {unknown} input
 * @returns {GradeId|null}
 */
export function normalizeGrade(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return null

  const direct = GRADE_BY_ALIAS.get(normalizeKey(raw))
  if (direct) return direct

  // Fall through to the ladder itself, which additionally understands the
  // legacy ECE spellings ('Baby Class', 'ECE_M') and bare secondary numbers.
  const level = levelResolution(raw).level
  return level ? level.id : null
}

/**
 * Fold any spelling of a curriculum to 'cbc' | 'obc', or null when unknown.
 *
 * Unlike `normalizeCurriculum` in paperTerminology.js — which defaults to CBC
 * because a paper must still print — this one has no default. Filing is not
 * printing: an unreadable curriculum must stay unreadable so the teacher is
 * asked, not silently given a CBC folder for their OBC class.
 *
 * @param {unknown} input
 * @returns {CurriculumId|null}
 */
export function normalizeCurriculum(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const key = normalizeKey(raw)
  if (LEGACY_CURRICULUM_ALIASES[key]) return LEGACY_CURRICULUM_ALIASES[key]
  return normalizeCurriculumId(raw) || null
}

/**
 * Fold any spelling of a term to 1 | 2 | 3, or null when unknown.
 * Accepts 2, '2', 'Term 2', 'term two', 'T2', 'II'.
 *
 * @param {unknown} input
 * @returns {TermId|null}
 */
export function normalizeTerm(input) {
  if (input === null || input === undefined || input === '') return null
  if (typeof input === 'number') return TERMS.includes(input) ? input : null

  const key = normalizeKey(input)
  if (!key) return null

  const digits = key.match(/^(?:term\s*|t)?(\d)$/)
  if (digits) {
    const n = Number(digits[1])
    return TERMS.includes(n) ? n : null
  }
  const words = key.match(/^(?:term\s*)?([a-z]+)$/)
  if (words) {
    const n = TERM_WORDS[words[1]]
    return n ? n : null
  }
  return null
}

/**
 * Fold any spelling of a subject to its canonical catalogue slug, or null.
 *
 * Subjects differ from the other three dimensions: their vocabulary is not a
 * fixed enum but the curriculum-and-grade syllabus catalogue, so this delegates
 * to `curriculumCatalog.normalizeSubjectId` — the one place subject aliases are
 * folded — and never invents a slug of its own.
 *
 * @param {unknown} input
 * @returns {string|null}
 */
export function normalizeSubject(input) {
  return normalizeSubjectId(input) || null
}

/**
 * The subjects a curriculum + grade actually offers, as `{ id, label }`.
 * Fails closed via the catalogue: an unknown pair yields [], never a union of
 * both curricula's subjects.
 *
 * @param {CurriculumId|null} curriculumId
 * @param {GradeId|null} gradeId
 */
export function subjectsForGrade(curriculumId, gradeId) {
  const curriculum = normalizeCurriculum(curriculumId)
  const grade = GRADE_BY_ID.get(normalizeGrade(gradeId))
  if (!curriculum || !grade) return []
  // The catalogue keys grades by KB code ('G4', 'ECE_N'), which the ladder
  // already records — so no second grade-code mapping is written here.
  return getSubjectsForGrade(curriculum, grade.kbGrade)
    .map((s) => ({ id: s.id, label: s.label }))
}

/* ── Lookups + ordering ──────────────────────────────────────── */

/** The library-shaped grade for an id, or null. */
export function getGrade(gradeId) {
  return GRADE_BY_ID.get(gradeId) || null
}

/** Display label for a grade id; falls back to the id so a label is never blank. */
export function gradeLabel(gradeId) {
  return GRADE_BY_ID.get(gradeId)?.label || String(gradeId ?? '')
}

/** Display label for a curriculum id. */
export function curriculumLabel(curriculumId) {
  return CURRICULUM_BY_ID.get(curriculumId)?.label || String(curriculumId ?? '')
}

/** Display label for a term. */
export function termLabel(term) {
  const t = normalizeTerm(term)
  return t ? `Term ${t}` : ''
}

/**
 * The grades a curriculum actually declares, in ladder order. CBC abolished
 * Grade 7 and stops at Form 4; the previous syllabus runs Grade 1–7 / Form 1–5
 * and has no ECE bands — a curriculum fact `educationLevels.js` already
 * records, so it is read from there rather than re-listed here.
 *
 * An unknown curriculum yields the whole ladder: candidate enumeration for a
 * document filed under no curriculum must still be able to count every grade.
 *
 * @param {CurriculumId|null} curriculumId
 * @returns {LibraryGrade[]}
 */
export function gradesForCurriculum(curriculumId) {
  const curriculum = CURRICULUM_BY_ID.get(normalizeCurriculum(curriculumId))
  if (!curriculum) return [...LIBRARY_GRADES]
  const ids = new Set(levelsForFramework(curriculum.framework).map((l) => l.id))
  return LIBRARY_GRADES.filter((g) => ids.has(g.id))
}

/**
 * Sort comparator for grade ids — ladder order (Nursery → Reception → Grade 1…7
 * → Form 1…5), never alphabetical. Alphabetical puts Form 1 before Grade 1 and
 * Reception after Grade 7, which is how a library starts looking arbitrary.
 */
export function compareGrades(a, b) {
  const left = GRADE_BY_ID.get(a)
  const right = GRADE_BY_ID.get(b)
  if (!left && !right) return String(a).localeCompare(String(b))
  if (!left) return 1
  if (!right) return -1
  return left.order - right.order
}

/** Sort a list of grade ids into ladder order. Does not mutate the input. */
export function sortGradeIds(gradeIds = []) {
  return [...gradeIds].sort(compareGrades)
}
