/**
 * src/utils/questionType.js
 *
 * Single source of truth for QUESTION TYPE + MARKS normalization across the app.
 *
 * Background (see scripts/test-question-consistency.mjs for the locked-in
 * behavior this consolidates): the codebase grew THREE divergent type
 * vocabularies and several copies of the marks-clamp logic —
 *
 *   • Editor / quiz path:  mcq · tf · short_answer · fill_blanks · numeric ·
 *                          matching · sequence · essay · diagram · hotspot · …
 *   • CSV importer:        its own alias map (multiple-choice → mcq, short →
 *                          short_answer, number → numeric)
 *   • Assessment / paper:  multiple_choice · true_false · structured ·
 *                          calculation · essay · matching · short_answer
 *
 * This module makes the EDITOR vocabulary the canonical one for the quiz path
 * and gives every quiz-side surface (schema, importers, preview, scorer) one
 * canonicalizeQuestionType() to call. The assessment vocabulary is intentionally
 * kept SEPARATE (it has concepts — structured, calculation — the quiz path
 * lacks) but is defined here too, alongside ONE documented bridge
 * (assessmentTypeToEditor / editorTypeToAssessment) so cross-namespace
 * conversion lives in exactly one tested place instead of being re-invented.
 *
 * Marks: normalizeMarks() + MARKS_BOUNDS replace the ad-hoc
 * `Math.max(1, Math.min(20, …))` clamps so "a 20-mark question behaves the same
 * everywhere" is enforced by one helper with explicit per-context bounds.
 *
 * Zero dependencies (pure data + functions) so it can be imported from the
 * schema layer, the importers, the scorer, and the exporters without cycles.
 */

// ── Editor / quiz canonical types ─────────────────────────────────────────
export const QUESTION_TYPES = [
  'mcq', 'tf', 'short_answer', 'diagram', 'diagram_label', 'fill', 'fill_blanks',
  'short', 'numeric', 'hotspot', 'essay', 'matching', 'sequence',
]

// Well-known type ALIASES → canonical editor enum value. The authoring surfaces
// and importers don't agree on a spelling: QuizSectionsEditor and the document
// importer emit 'truefalse', the Assessment Studio block picker labels its
// blocks 'true_false' / 'fill_in_blank', and the server quiz generator requests
// 'fill_blank'. The canonical names are 'tf' and 'fill_blanks', so a question
// authored under an alias fails the strict `type` enum on save — the classic
// "MCQ saves but true/false doesn't" bug. canonicalizeQuestionType() folds the
// known aliases onto the enum so every surface lands on the same value; an
// unrecognised value is returned UNCHANGED so a genuine typo still fails loudly
// at validation instead of being silently coerced to the wrong type.
//
// NOTE: assessment-namespace spellings ('multiple_choice', 'true_false' as the
// assessment canonical, 'structured', 'calculation') are deliberately NOT folded
// here — crossing namespaces goes through the bridge below. 'true_false' IS
// listed because the quiz editor's own block picker emits it for a quiz tf
// question; that overlap is intentional.
export const QUESTION_TYPE_ALIASES = {
  truefalse: 'tf',
  true_false: 'tf',
  'true/false': 'tf',
  fill_in_blank: 'fill_blanks',
  fill_in_the_blank: 'fill_blanks',
  fill_blank: 'fill_blanks',
}

/**
 * Map a possibly-aliased question type onto its canonical schema enum value.
 * Returns the input unchanged when it's already canonical or unrecognised, so
 * the strict write schema still rejects true garbage loudly.
 */
export function canonicalizeQuestionType(type) {
  if (typeof type !== 'string') return type
  const lowered = type.trim().toLowerCase()
  if (QUESTION_TYPE_ALIASES[lowered]) return QUESTION_TYPE_ALIASES[lowered]
  // A RECOGNISED type in the wrong case folds to its canonical spelling. It did
  // not, and 'MCQ' came back as 'MCQ' — which the completeness rules compare
  // against 'mcq', miss, and report as an unrecognised question type. Harmless
  // while only the editor called this (it writes lowercase); a real refusal now
  // that the rule runs over stored documents, where uppercase does occur —
  // functions/assessmentExports/renderModel.js lowercases defensively for
  // exactly that reason.
  //
  // Garbage is still returned unchanged, so the strict write schema keeps
  // rejecting it loudly: only a type already in QUESTION_TYPES is folded.
  if (QUESTION_TYPES.includes(lowered)) return lowered
  return type
}

// Human-readable labels for each canonical question type. Single source of
// truth shared by the studio dropdowns, the pre-publish error messages, and
// the exported-paper code — so a teacher never sees the raw enum value ("tf",
// "fill_blanks") in a toast or a checklist. Keyed by CANONICAL type;
// questionTypeLabel() folds aliases through canonicalizeQuestionType() first.
export const QUESTION_TYPE_LABELS = {
  mcq: 'Multiple Choice',
  tf: 'True / False',
  short_answer: 'Short Answer',
  short: 'Short Answer',
  diagram: 'Diagram / Image',
  diagram_label: 'Label the Diagram',
  fill: 'Fill in the Blank',
  fill_blanks: 'Fill in the Blanks',
  numeric: 'Numeric',
  hotspot: 'Image Hotspot',
  essay: 'Essay',
  matching: 'Matching',
  sequence: 'Sequence / Ordering',
}

/**
 * Friendly label for a (possibly aliased) question type. Folds the alias onto
 * its canonical value first, then looks up the label. An unknown/typo value is
 * humanised (snake/kebab → Title Case) so the message stays legible without
 * pretending the type is recognised.
 */
export function questionTypeLabel(type) {
  const canonical = canonicalizeQuestionType(type)
  if (QUESTION_TYPE_LABELS[canonical]) return QUESTION_TYPE_LABELS[canonical]
  return String(type ?? '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase()) || 'Unknown'
}

// ── Import-input spelling tolerance (CSV / human upload) ──────────────────
// Spellings a teacher might type in a CSV that the canonical alias map above
// doesn't carry (they aren't emitted by any authoring surface, only typed by
// hand). Applied as a thin pre-map by the CSV importer BEFORE
// canonicalizeQuestionType, so the canonical alias logic still lives in one
// place and the importer just adds human-input tolerance on top.
const IMPORT_TYPE_ALIASES = {
  'multiple-choice': 'mcq',
  'multiple choice': 'mcq',
  short: 'short_answer',
  number: 'numeric',
}

/**
 * Canonicalize a hand-typed import (CSV) question type: tolerate the extra
 * human spellings, then fold through the shared canonicalizer. Returns the
 * canonical editor type, or the input unchanged if unrecognised (so the
 * importer can flag it as an error rather than guess).
 */
export function canonicalizeImportedQuestionType(type) {
  if (typeof type !== 'string') return type
  const key = type.trim().toLowerCase()
  return canonicalizeQuestionType(IMPORT_TYPE_ALIASES[key] || key)
}

// ── Marks policy ──────────────────────────────────────────────────────────
// One implementation, explicit per-context bounds. "Same behavior everywhere"
// means the same rounding/clamping function — not the same cap, because the
// assessment/exam path legitimately carries higher-mark questions (a 50-mark
// essay section) than a learner quiz item.
export const MARKS_BOUNDS = {
  // Learner-quiz question (src/editor/schema/question.js write schema).
  quiz: { min: 1, max: 20 },
  // Assessment / exam-paper top-level question.
  assessmentQuestion: { min: 1, max: 100 },
  // A structured question's sub-part.
  subPart: { min: 0, max: 99 },
}

/**
 * Normalise a marks value to an integer within [min, max].
 *
 * Matches the long-standing coerceQuestion() read-side semantics: a finite
 * value ≥ min is floored and capped at max; anything else (missing, NaN,
 * below min, non-numeric) falls back to `fallback` (default `min`). Fractional
 * values floor (marks are integers everywhere; the write schema enforces int).
 *
 * @param {*} value
 * @param {{min?:number,max?:number,fallback?:number}} [bounds] defaults to quiz bounds
 */
export function normalizeMarks(value, bounds = MARKS_BOUNDS.quiz) {
  const min = bounds.min ?? MARKS_BOUNDS.quiz.min
  const max = bounds.max ?? MARKS_BOUNDS.quiz.max
  const fallback = bounds.fallback ?? min
  const n = Number(value)
  if (!Number.isFinite(n) || n < min) return fallback
  return Math.min(max, Math.floor(n))
}

// ── Assessment / exam-paper namespace (kept separate, defined here) ────────
// Mirrors functions/teacherTools/assessmentSchema.js ALLOWED_TYPES. Kept in
// sync by scripts/test-question-consistency.mjs (the two module systems —
// src/ ESM and functions/ CJS — can't share a module, so a guard test pins
// the parity instead).
export const ASSESSMENT_QUESTION_TYPES = [
  'multiple_choice', 'short_answer', 'structured', 'calculation',
  'true_false', 'essay', 'matching', 'fill_blanks',
]

// Assessment-side input spellings → assessment canonical (mirrors the picker
// in src/components/teacher/CreatePaperModal.jsx).
export const ASSESSMENT_TYPE_ALIASES = {
  'multiple choice': 'multiple_choice',
  'multiple-choice': 'multiple_choice',
  mcq: 'multiple_choice',
  'true/false': 'true_false',
  truefalse: 'true_false',
  tf: 'true_false',
}

/** Canonicalize a value onto the ASSESSMENT namespace (unchanged if unknown). */
export function canonicalizeAssessmentType(type) {
  if (typeof type !== 'string') return type
  return ASSESSMENT_TYPE_ALIASES[type.trim().toLowerCase()] || type
}

// ── The bridge: the ONE place quiz⇄assessment type conversion lives ────────
// Only the unambiguous, bijective pairs are mapped. Quiz-only types
// (diagram/hotspot/fill/sequence) and assessment-only types
// (structured/calculation) have no clean counterpart, so the bridge returns
// `null` for them and the caller decides (rather than silently picking a wrong
// type). 'short' folds onto short_answer on the way out. fill_blanks uses the
// same canonical key on both sides, so it maps bijectively through unchanged.
const EDITOR_TO_ASSESSMENT = {
  mcq: 'multiple_choice',
  tf: 'true_false',
  short_answer: 'short_answer',
  short: 'short_answer',
  essay: 'essay',
  matching: 'matching',
  fill_blanks: 'fill_blanks',
}
const ASSESSMENT_TO_EDITOR = {
  multiple_choice: 'mcq',
  true_false: 'tf',
  short_answer: 'short_answer',
  essay: 'essay',
  matching: 'matching',
  fill_blanks: 'fill_blanks',
}

/** Editor type → assessment namespace, or null when there's no clean mapping. */
export function editorTypeToAssessment(type) {
  return EDITOR_TO_ASSESSMENT[canonicalizeQuestionType(type)] ?? null
}

/** Assessment type → editor namespace, or null when there's no clean mapping. */
export function assessmentTypeToEditor(type) {
  return ASSESSMENT_TO_EDITOR[canonicalizeAssessmentType(type)] ?? null
}

export const QUESTION_TYPES_LIST = QUESTION_TYPES
