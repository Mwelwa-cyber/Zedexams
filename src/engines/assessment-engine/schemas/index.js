/**
 * The canonical assessment contract — the shape every runner's source is
 * normalised INTO, and the only shape the engine's own code reads.
 *
 * `docs/architecture.md` §4.1 defines it; this is that definition made
 * executable. It is deliberately narrow: it carries what the three Phase 3
 * sources actually provide (learner quizzes, past-paper quizzes, `timed_quiz`
 * games), not the full §4.1 wish-list. A field nothing supplies is a field
 * nothing can be tested against.
 *
 * ## Four rules this file exists to enforce
 *
 * 1. **`schemaVersion` is READ-TIME ONLY** (owner decision, 2026-08-05, recorded
 *    in architecture.md §4.1). The normaliser stamps it on the in-memory model;
 *    nothing writes it to Firestore. Phase 3's byte-compatibility rule means a
 *    new `results` record must not differ from an old one by so much as a field,
 *    and stamping a version while two writers disagree about whether it exists
 *    would record which code path served the request rather than the shape of
 *    what was stored.
 *
 * 2. **Legacy plain strings become `RichContent` on READ, and what is stored is
 *    never mutated** (§4.1 note 3). `toRichContent` wraps; nothing here writes
 *    back.
 *
 * 3. **No third question vocabulary.** Types are folded through
 *    `canonicalizeQuestionType` from the shared package, which already owns the
 *    editor vocabulary, the assessment vocabulary, and the one tested bridge
 *    between them (§14.10).
 *
 * 4. **No Firebase, no React, no browser globals.** The engine sits below
 *    features in the layering and reaches Firebase through `src/services/`
 *    (§14.2); keeping this file loadable under plain `node` is what makes the
 *    contract testable at all. Enforced by `../purity.test.js`.
 */
import { z } from 'zod'
import {
  canonicalizeQuestionType,
  normalizeMarks,
  MARKS_BOUNDS,
  QUESTION_TYPES,
} from '../../../../functions/shared/assessment/questionTypeCore.js'
import { asTiptapDoc } from '../../../../functions/shared/assessment/richTextContentCore.js'
import { getRichPlainText } from '../../../editor/richPlainText.js'

/**
 * The in-memory model's version. Bumped when the SHAPE below changes, which is
 * a different event from a stored record changing — nothing in Firestore
 * carries this value, by decision.
 */
export const ASSESSMENT_SCHEMA_VERSION = 1

/** The `RichContent` envelope version (§4.1: `RichContent.version`). */
export const RICH_CONTENT_VERSION = 1

/** Where a normalised assessment came from. The engine branches on nothing else. */
export const ASSESSMENT_SOURCES = Object.freeze(['quiz', 'pastPaperQuiz', 'game'])

// ── RichContent ──────────────────────────────────────────────────────────────

export const richContentSchema = z.object({
  version: z.number().int().positive(),
  tiptapDoc: z.record(z.any()).nullable(),
  plainTextFallback: z.string(),
})

/**
 * Wrap any stored prompt/option value in the `RichContent` envelope.
 *
 * `tiptapDoc` is null for a legacy plain string — that is the honest answer, not
 * a failure. Consumers render the doc when it exists and the fallback when it
 * does not, which is exactly what `QuizRunnerV2` already does inline.
 *
 * **Known gap, stated rather than hidden:** a raw HTML string reaches
 * `plainTextFallback` with its tags intact, because `getRichPlainText` handles
 * TipTap docs and plain text but does not strip markup. No Phase 3 source keeps
 * prompts as HTML — the quiz path holds `textHtml` in its own field, and options
 * are strings or docs — so this is latent, not live. It is asserted in the tests
 * so the behaviour is recorded rather than discovered.
 *
 * A second recorded behaviour: `getRichPlainText` returns `''` for a number, so
 * numeric values are stringified by the caller that can produce them
 * (`fromGame`) rather than being silently blanked here.
 */
export function toRichContent(value) {
  return {
    version: RICH_CONTENT_VERSION,
    tiptapDoc: asTiptapDoc(value),
    plainTextFallback: getRichPlainText(value),
  }
}

// ── Questions ────────────────────────────────────────────────────────────────

/**
 * One answerable item.
 *
 * `correctIndex` is the canonical answer position for choice questions, and it
 * is a POSITION in every source — which is the single most important thing the
 * normaliser does, because the sources disagree: a quiz holds
 * `correctAnswer: 1` (an index) while a `timed_quiz` game holds `answer: '42'`
 * (the option's VALUE). Normalising to one of them and leaving the other to each
 * consumer is how the current runners ended up with four scoring paths.
 *
 * `answerKey` carries the type-specific rest — tolerance, correctRegion,
 * matching pairs — untouched, because the marking modules that already grade
 * them are the authority on their shape and this contract must not fork it.
 */
export const questionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(QUESTION_TYPES),
  prompt: richContentSchema,
  marks: z.number().int().min(MARKS_BOUNDS.quiz.min).max(MARKS_BOUNDS.quiz.max),
  options: z.array(richContentSchema),
  correctIndex: z.number().int().min(0).nullable(),
  answerKey: z.record(z.any()),
  topicIds: z.array(z.string()),
})

// ── Settings ─────────────────────────────────────────────────────────────────

export const assessmentSettingsSchema = z.object({
  timed: z.boolean(),
  durationMinutes: z.number().int().positive().nullable(),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  allowResume: z.boolean(),
  showResults: z.boolean(),
})

// ── Assessment ───────────────────────────────────────────────────────────────

export const assessmentSchema = z.object({
  schemaVersion: z.literal(ASSESSMENT_SCHEMA_VERSION),
  source: z.enum(ASSESSMENT_SOURCES),
  id: z.string().min(1),
  title: z.string(),
  subject: z.string(),
  grade: z.string(),
  totalMarks: z.number().int().min(0),
  settings: assessmentSettingsSchema,
  questions: z.array(questionSchema),
})

/**
 * Validate a normalised assessment, throwing with the field path on failure.
 *
 * Used by the normaliser's own tests, and available to a consumer that wants
 * the guarantee at a boundary. It is NOT called inside `normalise()` — running
 * zod over every question on a learner's hot path would buy a guarantee the
 * tests already give, and `normalise` is pure, so those tests genuinely cover
 * it.
 */
export function assertAssessment(value) {
  return assessmentSchema.parse(value)
}

/** Non-throwing variant: `{ ok, value }` or `{ ok, error }`. */
export function safeAssessment(value) {
  const result = assessmentSchema.safeParse(value)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error }
}

// Re-exported so a consumer normalising a type never reaches for a second
// vocabulary — there is one, and it is the shared package's.
export { canonicalizeQuestionType, normalizeMarks, QUESTION_TYPES }
