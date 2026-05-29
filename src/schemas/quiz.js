/**
 * src/schemas/quiz.js
 *
 * Single source of truth for the shape of a Quiz document.
 *
 * Companion to src/editor/schema/question.js (which covers the subdocuments
 * under quizzes/{quizId}/questions). This module covers the parent quizzes/{quizId}
 * document plus its embedded `passages[]` and `parts[]` arrays.
 *
 * Two exports:
 *   - quizWriteSchema — strict zod validation, called before any addDoc/updateDoc.
 *     Catches typos in field names, wrong types, and stray fields. Use
 *     `.parse()` (throw) for creates and `.partial()` for partial updates.
 *   - coerceQuiz(raw) — defensive READ-side normalisation. Takes a Firestore
 *     doc that may have come from a legacy or partially-broken state and
 *     returns a quiz with the array-shaped fields guaranteed to be arrays,
 *     null-or-malformed entries filtered out, and numeric fields coerced.
 *     Never throws — designed for the runner, where blanking the page is
 *     worse than silently dropping garbage.
 *
 * The two are intentionally asymmetric:
 *   - Writes are strict so bad data can never get IN.
 *   - Reads are permissive so bad data already in Firestore (from before
 *     this PR) doesn't blank the UI for learners.
 *
 * Use `.passthrough()` on every object — quizzes have accumulated many ad-hoc
 * fields (importStatus, isDemo, submittedAt, …) that aren't yet documented in
 * this schema. Passthrough preserves them rather than silently dropping. As
 * those fields are catalogued in follow-ups, move them into the schema and
 * eventually flip to `.strict()`.
 */

import { z } from 'zod'

// ── Field helpers ─────────────────────────────────────────────────

/**
 * A bounded string field that treats `null`/`undefined` as the empty string.
 *
 * Plain `z.string().default('')` only fills in for `undefined` — a `null`
 * still fails with Zod's "Invalid input". The serializer writes
 * `passage.imageUrl || null` for image-less passages, so without this the
 * whole quiz save throws `Invalid quiz payload at "passages.0.imageUrl"`.
 * Read-side `coercePassage` already normalises null→'', so accepting it here
 * keeps the write and read boundaries symmetric.
 */
const emptyableString = (max) =>
  z.preprocess((v) => (v == null ? '' : v), z.string().max(max))

// ── Embedded shapes ───────────────────────────────────────────────

/**
 * One passage block embedded in a quiz doc. The passage's questions live as
 * subdocuments under quizzes/{quizId}/questions and reference back via
 * question.passageId.
 */
export const passageSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: emptyableString(500),
    instructions: emptyableString(10000),
    passageText: emptyableString(50000),
    imageUrl: emptyableString(2000),
    passageKind: emptyableString(40),
    order: z.number().int().min(0).max(10000).default(0),
  })
  .passthrough()

/**
 * One part (section group) embedded in a quiz doc — used by PRISCA-style
 * papers that group questions under numbered Parts.
 */
export const partSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().max(500).default(''),
    instructions: z.string().max(10000).default(''),
    example: z.string().max(10000).default(''),
    order: z.number().int().min(0).max(10000).default(0),
  })
  .passthrough()

// ── Quiz shape ────────────────────────────────────────────────────

const STATUSES = ['draft', 'pending', 'published']
const QUIZ_TYPES = ['practice', 'daily_exam']

/**
 * The Quiz doc shape as written to Firestore. Required fields throw on a
 * missing value; everything else has a permissive default.
 *
 * IMPORTANT: this schema uses `.passthrough()` (see module docstring). It
 * validates the fields it knows about; unknown fields are preserved verbatim
 * so we don't accidentally drop teacher-set data when validating on update.
 */
export const quizWriteSchema = z
  .object({
    // ── Identity & meta ──
    title: z.string().min(1).max(200),
    subject: z.string().min(1).max(100),
    // Grade can be a string ('5') or number (5) depending on the form; both
    // are accepted, the canonical normaliser below coerces to string.
    grade: z.union([z.string().max(20), z.number().int().min(0).max(20)]),
    term: z.string().max(20).default(''),
    description: z.string().max(5000).default(''),

    // ── Sections ──
    passages: z.array(passageSchema).max(50).default([]),
    parts: z.array(partSchema).max(20).default([]),
    passageCount: z.number().int().min(0).max(1000).default(0),
    totalMarks: z.number().int().min(0).max(10000).default(0),
    questionCount: z.number().int().min(0).max(2000).default(0),

    // ── Publication ──
    isPublished: z.boolean().default(false),
    status: z.enum(STATUSES).default('draft'),

    // ── Authorship ──
    createdBy: z.string().min(1).max(200),

    // ── Optional type/classification ──
    // Daily exam quizzes are flagged with both `quizType: 'daily_exam'` and
    // `isDailyExam: true`. Practice quizzes use `quizType: 'practice'` (or
    // omit `quizType` entirely on legacy docs — getQuizzes() filters
    // explicitly so omitting it means the quiz never lists for learners).
    //
    // `quizType` and `dailyExamDate` are nullable so admin actions (Publish
    // an exam-only paper, Unassign a quiz) can explicitly *clear* the value
    // with `null` rather than `undefined` — Firestore needs an actual value
    // in the patch to delete the existing field on the doc.
    quizType: z.enum(QUIZ_TYPES).nullable().optional(),
    isDailyExam: z.boolean().optional(),
    dailyExamDate: z.string().max(10).nullable().optional(),
    durationMinutes: z.number().int().min(1).max(600).optional(),
    isDemo: z.boolean().optional(),
  })
  .passthrough()

/**
 * Partial variant for updateDoc(). Every field is optional, but typed values
 * are still validated when present. Use for `updateQuiz(id, patch)`.
 */
export const quizUpdateSchema = quizWriteSchema.partial()

// ── Coerce helpers (read-side, never throw) ──────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function safeString(v, fallback = '') {
  if (v == null) return fallback
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}

function safeNumber(v, fallback = 0) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

/**
 * Coerce a single passage entry into a guaranteed-shape object. Drops the
 * entry entirely (returns null) if it has no usable id — the runner can't
 * key the section without one.
 */
function coercePassage(raw) {
  if (!isPlainObject(raw)) return null
  if (!raw.id || typeof raw.id !== 'string') return null
  return {
    id: raw.id,
    title: safeString(raw.title),
    instructions: safeString(raw.instructions),
    passageText: safeString(raw.passageText),
    imageUrl: safeString(raw.imageUrl),
    passageKind: safeString(raw.passageKind),
    order: safeNumber(raw.order, 0),
    // Preserve any extra fields the runner might read directly.
    ...raw,
    // Re-overwrite the normalised values so they win over the original
    // (possibly malformed) ones.
    ...(raw.id ? { id: raw.id } : {}),
  }
}

function coercePart(raw) {
  if (!isPlainObject(raw)) return null
  if (!raw.id || typeof raw.id !== 'string') return null
  return {
    id: raw.id,
    title: safeString(raw.title),
    instructions: safeString(raw.instructions),
    example: safeString(raw.example),
    order: safeNumber(raw.order, 0),
    ...raw,
    ...(raw.id ? { id: raw.id } : {}),
  }
}

/**
 * Normalise a raw Firestore quiz document for safe consumption by the UI.
 *
 * - Returns null when input is null/undefined/not-an-object.
 * - Guarantees `passages` and `parts` are arrays of well-shaped entries.
 *   Malformed entries (null, primitive, missing id) are filtered out.
 * - Coerces numeric fields. Anything unparseable falls back to 0.
 * - Preserves every other field verbatim — readers that rely on
 *   undocumented fields (importStatus, submittedAt, …) keep working.
 *
 * This is the single read-boundary helper. Once every reader calls it, the
 * scattered `Array.isArray(quiz.passages)` guards in quizSections.js,
 * examService.js, etc. can be removed in a follow-up cleanup.
 */
export function coerceQuiz(raw) {
  if (!isPlainObject(raw)) return null

  const passages = (Array.isArray(raw.passages) ? raw.passages : [])
    .map(coercePassage)
    .filter(Boolean)

  const parts = (Array.isArray(raw.parts) ? raw.parts : [])
    .map(coercePart)
    .filter(Boolean)

  return {
    ...raw,
    passages,
    parts,
    passageCount: safeNumber(raw.passageCount, passages.length),
    totalMarks: safeNumber(raw.totalMarks, 0),
    questionCount: safeNumber(raw.questionCount, 0),
    isPublished: Boolean(raw.isPublished),
  }
}

export const QUIZ_STATUSES = STATUSES
export const QUIZ_TYPES_LIST = QUIZ_TYPES
