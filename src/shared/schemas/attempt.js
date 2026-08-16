/**
 * src/schemas/attempt.js
 *
 * Single source of truth for the shape of an Exam Attempt document
 * (Firestore collection: `exam_attempts`).
 *
 * Two write paths in src/utils/examService.js:
 *   1. startExam()  → addDoc with the initial `in_progress` shape
 *   2. _doSubmit()  → updateDoc with the scoring shape (status: 'submitted',
 *                     score, percentage, topicBreakdown, etc.)
 *
 * We split the schema into two narrow variants rather than one mega-schema
 * with most fields optional, because each variant has different REQUIRED
 * fields and we want loud errors when those are missing.
 *
 * Read-side: coerceAttempt() handles the historical-data shapes that have
 * already caused crashes (`answers` as array instead of object,
 * `flagged` as object map instead of array, missing `currentSectionIndex`,
 * etc. — see git log for PRs #379/#380).
 */

import { z } from 'zod'

const STATUSES = ['in_progress', 'submitted']

/**
 * Permissive answer-map schema. Keys are question IDs (strings); values are
 * either the chosen option (string|number for MCQ; string for short-answer)
 * or an object `{ given, correct }` for text answers where the AI grader has
 * already evaluated it.
 *
 * z.record on a permissive value union catches the historical "answers was
 * accidentally written as an array" bug — z.record rejects array inputs.
 */
const answerValue = z.union([
  z.string().max(50_000),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({}).passthrough(),
])

const answersMap = z.record(z.string().min(1).max(200), answerValue)

/**
 * Flagged-questions list. Canonical form is a string[] of question IDs. A
 * legacy shape (object map { [qid]: true }) is accepted for backward
 * compatibility on the WRITE side via a preprocess; coerceAttempt() also
 * handles it on the read side.
 */
const flaggedList = z.array(z.string().min(1).max(200)).max(2000)

/**
 * Schema for the document body when starting a new attempt (addDoc in
 * startExam). Everything is required so a missing field fails loudly.
 *
 * `startedAt` is a Firestore serverTimestamp(), which is a sentinel value at
 * the SDK level; we accept it as `z.any()` rather than try to introspect.
 */
export const attemptStartSchema = z
  .object({
    userId: z.string().min(1).max(200),
    displayName: z.string().max(200).default('Student'),
    examId: z.string().min(1).max(200),
    subject: z.string().min(1).max(100),
    // Grade may be string or number depending on the quiz doc; same as quiz.js.
    grade: z.union([z.string().max(20), z.number().int().min(0).max(20), z.null()])
      .optional(),
    attemptDate: z.string().min(8).max(10), // YYYY-MM-DD
    status: z.literal('in_progress'),
    startedAt: z.any(), // serverTimestamp sentinel
    endTime: z.number().int().positive(),
    submittedAt: z.null(),
    answers: answersMap.default({}),
    flagged: flaggedList.default([]),
    currentSectionIndex: z.number().int().min(0).max(1000).default(0),
    score: z.null(),
    totalMarks: z.number().int().min(0).max(10000).default(0),
    percentage: z.null(),
    timeTakenSeconds: z.null(),
  })
  .passthrough()

/**
 * Schema for the patch sent in _doSubmit's updateDoc call when an attempt
 * transitions to `submitted`. Only the fields actually written are listed.
 */
export const attemptSubmitSchema = z
  .object({
    status: z.literal('submitted'),
    answers: answersMap,
    score: z.number().int().min(0).max(100_000),
    totalMarks: z.number().int().min(0).max(100_000),
    totalQuestions: z.number().int().min(0).max(10_000),
    percentage: z.number().int().min(0).max(100),
    timeTakenSeconds: z.number().int().min(0).max(86_400),
    submittedAt: z.any(), // serverTimestamp sentinel
    topicBreakdown: z.record(z.string(), z.any()).default({}),
    strengths: z.array(z.string()).default([]),
    weaknesses: z.array(z.string()).default([]),
    performanceLevel: z.string().max(40),
    feedback: z.object({
      can: z.string().max(2000),
      developing: z.string().max(2000),
      practice: z.string().max(2000),
    }),
  })
  .passthrough()

// ── Coerce helper (read-side, never throws) ──────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Normalise an attempt read from Firestore into the runtime shape every
 * caller expects.
 *
 * Defensive guarantees:
 *   - Returns null when input is null/undefined/not-an-object.
 *   - `answers` is always a plain object (not array, not null, not primitive).
 *     A legacy attempt with `answers: []` no longer makes `_doSubmit`'s
 *     `questions.forEach(q => answers[q.id])` blow up — answers is `{}`.
 *   - `flagged` is always an array of strings. A legacy `flagged: { qid: true }`
 *     map is converted to its key list. A `flagged: null` or any other shape
 *     becomes `[]`.
 *   - `currentSectionIndex` is always a finite non-negative integer.
 *   - `status` falls back to `'in_progress'` when missing/unknown.
 *
 * This is the read-boundary helper. Once every reader of `exam_attempts`
 * goes through it, the inline coercions in examService.restoreExam() and
 * _doSubmit() become redundant — they're kept in place for now as a
 * second line of defence (see the audit follow-up cleanup pass).
 */
export function coerceAttempt(raw) {
  if (!isPlainObject(raw)) return null

  // answers: must be a plain object map. Reject arrays explicitly — that's
  // exactly the shape that caused PR #379's crash.
  const answers = isPlainObject(raw.answers) ? raw.answers : {}

  // flagged: canonical is string[]; tolerate the legacy object-map form by
  // promoting its keys (where the value is truthy) to the array.
  let flagged = []
  if (Array.isArray(raw.flagged)) {
    flagged = raw.flagged.filter(x => typeof x === 'string' && x.length > 0)
  } else if (isPlainObject(raw.flagged)) {
    flagged = Object.entries(raw.flagged)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k)
      .filter(x => typeof x === 'string' && x.length > 0)
  }

  const currentSectionIndex = Number.isFinite(raw.currentSectionIndex)
    ? Math.max(0, Math.floor(raw.currentSectionIndex))
    : 0

  const status = STATUSES.includes(raw.status) ? raw.status : 'in_progress'

  return {
    ...raw,
    answers,
    flagged,
    currentSectionIndex,
    status,
  }
}

export const ATTEMPT_STATUSES = STATUSES
