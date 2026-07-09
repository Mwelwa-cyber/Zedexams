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
import { normalizeSubject } from '../config/curriculum.js'

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

// The only grades the platform (and firestore.rules `_validGrade`) accept.
// Kept as strings because the Firestore rule requires `value is string`.
const ACTIVE_GRADE_STRINGS = ['4', '5', '6', '7']

/**
 * Coerce any grade the editor/importer might hold into a rule-valid string.
 *
 * This mirrors the `duration` fix: `grade` used to ride through as
 * `string | number` and only blew up at the Firestore rule
 * (`_validGrade` accepts ONLY the strings '4'..'7') with an opaque
 * "Missing or insufficient permissions" — a scanned paper whose grade the
 * importer couldn't detect saved with `grade: ''`, and EVERY save/auto-save
 * of it was silently rejected. So we normalise here, at the one write choke
 * point, so a write can never carry a grade the rule will reject:
 *   - a number (or numeric string) is clamped into 4..7 and stringified
 *     ('8' → '7', 3 → '4', 5 → '5');
 *   - an empty / unparseable grade falls back to the app default '5'
 *     (matching CreateQuizV2) so the paper stays saveable while the admin
 *     sets the real grade from the 4–7 selector.
 * `undefined` is passed through so an update patch that omits `grade`
 * doesn't spuriously write one.
 */
export function coerceGrade(v) {
  if (v === undefined) return undefined
  if (typeof v === 'string' && ACTIVE_GRADE_STRINGS.includes(v)) return v
  const n = Number(v)
  if (Number.isFinite(n) && n >= 1) {
    return String(Math.min(7, Math.max(4, Math.round(n))))
  }
  return '5'
}

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
    // Pinned total marks for a stimulus block (overrides the auto-sum of its
    // sub-questions). null = auto. Nullable so the editor can clear it back to
    // auto with an explicit value Firestore will persist.
    manualMarks: z.number().int().min(0).max(999).nullable().optional(),
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
    // Repair a stray curriculum slug ("mathematics") into its canonical
    // display label ("Mathematics") before validating, so an imported or
    // legacy slug never hard-fails the save. The string bound stays the
    // source of truth for length/type — normalizeSubject only rewrites
    // recognised slugs and leaves everything else untouched.
    subject: z.preprocess(
      (v) => (typeof v === 'string' ? normalizeSubject(v) : v),
      z.string().min(1).max(100),
    ),
    // Grade can arrive as a string ('5'), a number (5), an out-of-range value
    // (a paper detected as Grade 8), or empty (the importer couldn't detect
    // it). coerceGrade normalises ALL of these into a rule-valid '4'..'7'
    // string so the write never fails `_validGrade` with an opaque permission
    // error (the "scanned paper won't save" bug). See coerceGrade above.
    grade: z.preprocess(coerceGrade, z.enum(ACTIVE_GRADE_STRINGS)),
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
    // The editor writes the active quiz length as `duration` (minutes); it
    // previously rode through on `.passthrough()` unvalidated, so a bad value
    // only blew up at the Firestore rule (duration int 5..180) with an opaque
    // permission error. Validate it client-side instead, giving a named error
    // on create. The update path relaxes this (see quizUpdateSchema) so editing
    // a legacy quiz whose stored duration is outside 5..180 never hard-fails.
    duration: z.number().int().min(5).max(180).optional(),
    isDemo: z.boolean().optional(),
    // When true, the learner runner randomises question order at attempt time
    // (within Parts/passages). Absent/false preserves document order.
    shuffleQuestions: z.boolean().optional(),
  })
  .passthrough()

/**
 * Partial variant for updateDoc(). Every field is optional, but typed values
 * are still validated when present. Use for `updateQuiz(id, patch)`.
 *
 * `duration` is overridden to be lenient: EditQuizV2 deliberately keeps a
 * legacy/custom saved duration selectable even when it falls outside the
 * 5..180 dropdown range (durationOptions), and re-saves it verbatim on an
 * unrelated edit. A strict bound here would block that edit with a confusing
 * "Invalid quiz update at duration" error, so on the update path we clamp the
 * value into 5..180 rather than reject it. A genuinely fresh out-of-range
 * value still gets corrected before it can fail the Firestore rule.
 */
export const quizUpdateSchema = quizWriteSchema.partial().extend({
  duration: z.preprocess(
    (v) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return v
      return Math.min(180, Math.max(5, Math.round(v)))
    },
    z.number().int().min(5).max(180).optional(),
  ),
})

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
    manualMarks: raw.manualMarks == null ? null : safeNumber(raw.manualMarks, null),
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
