/**
 * src/documentEngine/structuredDocument.js
 *
 * ESM twin of `functions/documentEngine/structuredDocumentCore.js`. Defines the
 * canonical StructuredDocument field lists the editor relies on and a light
 * `stampQuestion` mirror. Pinned to the CJS core by
 * `scripts/test-document-engine-parity.mjs`.
 *
 * The editor consumes a StructuredDocument produced server-side; it does not
 * build one from raw documents. So this module intentionally exposes only the
 * shape contract + per-card stamping the client needs for live re-validation.
 */

import { computeValidationStatus } from './validationEngine.js'

export const STRUCTURED_DOCUMENT_FIELDS = [
  'meta',
  'passages',
  'parts',
  'questions',
  'validation',
  'report',
]

export const CANONICAL_QUESTION_FIELDS = [
  'type',
  'prompt',
  'options',
  'correctAnswer',
  'explanation',
  'sourceNumber',
  'answerKnown',
  'order',
  'requiresReview',
  'passageId',
  'partId',
  'table',
  'validationStatus',
  'aiConfidence',
]

function clampConfidence(v) {
  if (v == null) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1, n))
}

/**
 * Stamp the per-card engine fields (validationStatus, aiConfidence) onto a
 * working-shape question. Mirrors the CJS core so the editor can re-derive a
 * card's status live as a teacher edits it.
 */
export function stampQuestion(question) {
  const q = question || {}
  return {
    ...q,
    validationStatus: computeValidationStatus(q),
    aiConfidence: clampConfidence(q.aiConfidence != null ? q.aiConfidence : q.confidence),
  }
}
