/**
 * lessonMemory — pure helpers for the Lesson Plan Studio's persistent lesson
 * memory: the studio remembers every lesson plan a teacher has created for a
 * given (curriculum, grade, subject, topic, subtopic) so that returning to the
 * same selection shows what already exists, what is missing, teaching progress,
 * and what to do next.
 *
 * This module is intentionally pure (no React / Firebase) so it unit-tests
 * under plain `node` and the matching/maths logic lives in one tested place.
 * The Firestore I/O lives in src/utils/lessonMemoryService.js and the live
 * subscription in hooks/useLessonMemory.js.
 *
 * A "lesson memory" record (a `lessonPlans/{id}` doc) carries the curriculum
 * coordinates plus a per-lesson `lessonNumber`, `status` and `teachingStatus`.
 * Records are keyed by a deterministic doc id per (teacher, subtopic, lesson
 * number) slot so re-generating Lesson 1 updates the same record instead of
 * piling up duplicates.
 */

// ── Status vocabularies ───────────────────────────────────────────────────────

/** Lifecycle status of the plan document itself. */
export const PLAN_STATUSES = ['draft', 'completed', 'taught', 'archived']

/** How far the teacher has got teaching this lesson. Drives the status pills. */
export const TEACHING_STATUSES = [
  { id: 'not_started', label: 'Not started' },
  { id: 'planned', label: 'Planned' },
  { id: 'taught', label: 'Taught' },
  { id: 'needs_revision', label: 'Needs revision' },
]

const TEACHING_STATUS_IDS = new Set(TEACHING_STATUSES.map((s) => s.id))

/** Safe label lookup for a teaching-status id. */
export function teachingStatusLabel(id) {
  const hit = TEACHING_STATUSES.find((s) => s.id === id)
  return hit ? hit.label : 'Planned'
}

/** True when `id` is one of the recognised teaching statuses. */
export function isTeachingStatus(id) {
  return TEACHING_STATUS_IDS.has(id)
}

// ── Normalisation + keys ──────────────────────────────────────────────────────

/** Lowercase + strip non-alphanumerics for tolerant comparison (mirrors coverageAnalysis.normName). */
export function normToken(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Stable 32-bit FNV-1a hash → base36 string. Deterministic across sessions and
 * machines (unlike Math.random) so the same coordinates always map to the same
 * doc id. Used to keep Firestore doc ids short + valid from long subtopic keys.
 */
export function stableHash(s) {
  let h = 0x811c9dc5
  const str = String(s == null ? '' : s)
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Human-facing curriculum label from the studio's internal mode. */
export function curriculumTypeLabel(mode) {
  return mode === 'previous' ? 'Previous Curriculum' : 'CBC'
}

/** Internal curriculum id ('cbc' | 'previous') from either form. */
export function curriculumIdFor(modeOrLabel) {
  const v = String(modeOrLabel || '').toLowerCase()
  return v === 'previous' || v.startsWith('previous') ? 'previous' : 'cbc'
}

/**
 * Deterministic key identifying one subtopic for a curriculum+grade+subject.
 * Everything is normalised so "Grade 4" / "grade  4" collapse to the same key.
 */
export function buildSubtopicKey({ curriculumType, grade, subject, topic, subtopic }) {
  return [
    normToken(curriculumIdFor(curriculumType)),
    normToken(grade),
    normToken(subject),
    normToken(topic),
    normToken(subtopic),
  ].join('|')
}

/** Deterministic key for a curriculum+grade+subject (the coverage scope). */
export function buildGradeSubjectKey({ curriculumType, grade, subject }) {
  return [
    normToken(curriculumIdFor(curriculumType)),
    normToken(grade),
    normToken(subject),
  ].join('|')
}

/** Deterministic Firestore doc id for one lesson slot (teacher + subtopic + lesson number). */
export function lessonPlanDocId({ uid, subtopicKey, lessonNumber }) {
  return `${normToken(uid)}_${stableHash(subtopicKey)}_L${Number(lessonNumber) || 1}`
}

/** Deterministic Firestore doc id for a grade+subject progress rollup. */
export function lessonProgressDocId({ uid, curriculumType, grade, subject }) {
  const key = buildGradeSubjectKey({ curriculumType, grade, subject })
  return `${normToken(uid)}_${stableHash(key)}`
}

// ── Curriculum code extraction ────────────────────────────────────────────────
//
// CBC/2013 syllabus labels sometimes embed a code prefix, e.g.
// "O.1.2.1 The External Human Body Parts" or "3.1.1 Counting". The studio's
// dropdowns carry the whole label as one string, so we split a leading code off
// for the `topicCode`/`subtopicCode` metadata while keeping the readable name.

const CODE_PREFIX_RE = /^([A-Za-z]{0,3}\.?\d+(?:\.\d+){1,4})\b[\s.:)–—-]*/

/** Pull a leading curriculum code (e.g. "O.1.2.1", "3.1.1") off a label, or '' if none. */
export function extractCode(label) {
  const m = String(label == null ? '' : label).trim().match(CODE_PREFIX_RE)
  return m ? m[1] : ''
}

/** The readable name with any leading code stripped (falls back to the original). */
export function stripCode(label) {
  const s = String(label == null ? '' : label).trim()
  const m = s.match(CODE_PREFIX_RE)
  if (!m) return s
  const rest = s.slice(m[0].length).trim()
  return rest || s
}

// ── Per-subtopic lesson set ───────────────────────────────────────────────────

/**
 * All of a teacher's saved lessons for one subtopic, sorted by lesson number.
 *
 * @param {Array<object>} plans      every lessonPlans record for the teacher
 * @param {string} subtopicKey       buildSubtopicKey(...) of the current selection
 * @returns {Array<object>}
 */
export function lessonsForSubtopic(plans, subtopicKey) {
  if (!Array.isArray(plans) || !subtopicKey) return []
  return plans
    .filter((p) => p && p.subtopicKey === subtopicKey && p.status !== 'archived')
    .slice()
    .sort((a, b) => (Number(a.lessonNumber) || 0) - (Number(b.lessonNumber) || 0))
}

/**
 * Progress summary for a subtopic's lessons against the expected lesson count.
 *
 * @param {Array<object>} lessons     lessonsForSubtopic(...) output
 * @param {number} expectedCount      how many lessons the subtopic should have
 * @returns {{
 *   created: number,
 *   expected: number,
 *   taughtCount: number,
 *   completedNumbers: number[],
 *   missingNumbers: number[],
 *   nextToCreate: number,
 *   nextToTeach: number|null,
 * }}
 */
export function subtopicProgress(lessons, expectedCount) {
  const list = Array.isArray(lessons) ? lessons : []
  const created = list.length
  // Expected can never be fewer than what already exists.
  const expected = Math.max(Number(expectedCount) || 0, created, created ? 0 : 1)
  const numbers = list.map((l) => Number(l.lessonNumber) || 0)
  const present = new Set(numbers)
  const taughtCount = list.filter((l) => l.teachingStatus === 'taught' || l.status === 'taught').length
  const completedNumbers = list
    .filter((l) => l.teachingStatus === 'taught' || l.status === 'taught' || l.status === 'completed')
    .map((l) => Number(l.lessonNumber) || 0)

  const missingNumbers = []
  for (let n = 1; n <= expected; n++) {
    if (!present.has(n)) missingNumbers.push(n)
  }

  const maxCreated = numbers.length ? Math.max(...numbers) : 0
  const nextToCreate = missingNumbers.length ? missingNumbers[0] : maxCreated + 1
  const nextToTeach = list.find((l) => l.teachingStatus !== 'taught' && l.status !== 'taught')
    ? (list.find((l) => l.teachingStatus !== 'taught' && l.status !== 'taught').lessonNumber)
    : null

  return {
    created,
    expected,
    taughtCount,
    completedNumbers,
    missingNumbers,
    nextToCreate,
    nextToTeach: nextToTeach == null ? null : Number(nextToTeach) || null,
  }
}

/** The existing lesson with a given number, or null. */
export function findLessonByNumber(lessons, lessonNumber) {
  const n = Number(lessonNumber)
  if (!Array.isArray(lessons) || !Number.isFinite(n)) return null
  return lessons.find((l) => (Number(l.lessonNumber) || 0) === n) || null
}

// ── Generate-button state (requirement #9) ────────────────────────────────────

/**
 * Decide the Generate button's label + action from the subtopic's memory.
 *
 *   no lessons          → "Generate Lesson Plan"   (generate)
 *   gaps / more to plan → "Create Next Lesson"     (create-next)
 *   all planned, taught → "Review Completed Lessons" (review)
 *   all planned, untaught → "Continue Lesson Plan" (continue)
 *
 * @returns {{ label: string, action: string, nextLessonNumber: number|null }}
 */
export function generateButtonState({ lessons, expected }) {
  const p = subtopicProgress(lessons, expected)
  if (p.created === 0) {
    return { label: 'Generate Lesson Plan', action: 'generate', nextLessonNumber: 1 }
  }
  if (p.created < p.expected || p.missingNumbers.length > 0) {
    return { label: 'Create Next Lesson', action: 'create-next', nextLessonNumber: p.nextToCreate }
  }
  if (p.taughtCount >= p.created) {
    return { label: 'Review Completed Lessons', action: 'review', nextLessonNumber: null }
  }
  return { label: 'Continue Lesson Plan', action: 'continue', nextLessonNumber: p.nextToTeach ?? p.created }
}

// ── Smart recommendation (requirement #5) ─────────────────────────────────────

/**
 * One human sentence guiding the teacher's next move for this subtopic.
 *
 * @returns {{ text: string, kind: string }}
 */
export function recommendationFor({ lessons, expected, subtopicName, nextRecommendedSubtopic }) {
  const p = subtopicProgress(lessons, expected)
  const name = subtopicName || 'this subtopic'

  if (p.created === 0) {
    return { text: 'This subtopic has no lesson plan yet.', kind: 'empty' }
  }
  if (p.created < p.expected || p.missingNumbers.length > 0) {
    return { text: `Continue: create Lesson ${p.nextToCreate} for ${name}.`, kind: 'continue-series' }
  }
  if (p.taughtCount >= p.created) {
    const next = nextRecommendedSubtopic
      ? ` Next recommended subtopic: ${nextRecommendedSubtopic}.`
      : ''
    return { text: `You have completed all planned lessons for this subtopic.${next}`, kind: 'done' }
  }
  if (p.created === 1) {
    return { text: 'You have already created Lesson 1 for this subtopic.', kind: 'has-one' }
  }
  return {
    text: `${p.created} of ${p.expected} lessons planned for ${name} — ${p.taughtCount} taught.`,
    kind: 'progress',
  }
}

/**
 * Resolve how many lessons a subtopic is expected to have, preferring (in order)
 * an explicit series breakdown, an AI recommendation, the count already created,
 * then a single-lesson default.
 */
export function resolveExpectedCount({ breakdownLength, aiRecommended, created }) {
  const candidates = [Number(breakdownLength) || 0, Number(aiRecommended) || 0, Number(created) || 0, 1]
  return Math.max(...candidates)
}
