/**
 * functions/documentEngine/structuredDocumentCore.js
 *
 * The canonical **StructuredDocument** — the one validated output shape every
 * import producer emits and the Quiz Editor consumes. Consolidating on a single
 * shape is what lets a PDF, camera photo, Word doc, or scan flow through the
 * same pipeline and land identically in the editor (which then only displays /
 * edits — it never parses).
 *
 * Pure + dependency-free (see the `*Core.js` convention). ESM twin lives at
 * `src/documentEngine/structuredDocument.js`; the field lists are pinned in
 * lockstep by `scripts/test-document-engine-parity.mjs`.
 *
 *   StructuredDocument = {
 *     meta:      { sourceType, fileName, pageCount, engineVersion,
 *                  subjectHint, gradeHint },
 *     passages:  [ { id, title, passageText, passageKind, order, table? } ],
 *     parts:     [ { id, title, instructions, order } ],
 *     questions: [ CanonicalQuestion ],   // flat, ordered; passageId/partId link up
 *     validation:{ ok, blockers[], warnings[], numbering },
 *     report:    ImportReport,
 *   }
 *
 * A CanonicalQuestion is the importer's working question shape (from
 * `normaliseImportedQuestion`) plus the per-card fields the editor now stores:
 *   validationStatus ('ok'|'warning'|'error') and aiConfidence (0..1 | null).
 */

const {
  collectPassages,
  buildImportReport,
} = require("../teacherTools/pastPaperImportHelpers");
const {
  gateImport,
  computeValidationStatus,
} = require("./validationEngineCore");

// Top-level keys of a StructuredDocument. Pinned against the ESM twin.
const STRUCTURED_DOCUMENT_FIELDS = [
  "meta",
  "passages",
  "parts",
  "questions",
  "validation",
  "report",
];

// The canonical question keys the editor maps 1:1 onto its question schema.
const CANONICAL_QUESTION_FIELDS = [
  "type",
  "prompt",
  "options",
  "correctAnswer",
  "explanation",
  "sourceNumber",
  "answerKnown",
  "order",
  "requiresReview",
  "passageId",
  "partId",
  "table",
  "validationStatus",
  "aiConfidence",
];

function clampConfidence(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/**
 * Stamp the per-card engine fields onto a working-shape question:
 *   - validationStatus: the ok|warning|error rollup the editor chip renders.
 *   - aiConfidence:     0..1 the importer attached (from `confidence`), or null.
 * Leaves everything else (type/prompt/options/…) untouched.
 */
function stampQuestion(question) {
  const q = question || {};
  return {
    ...q,
    validationStatus: computeValidationStatus(q),
    aiConfidence: clampConfidence(
      q.aiConfidence != null ? q.aiConfidence : q.confidence,
    ),
  };
}

function normaliseMeta(meta) {
  const m = meta || {};
  return {
    sourceType: m.sourceType || "",
    fileName: m.fileName || "",
    pageCount: Number.isInteger(m.pageCount) ? m.pageCount : 0,
    engineVersion: m.engineVersion || "",
    subjectHint: m.subjectHint || "",
    gradeHint: m.gradeHint || "",
  };
}

/**
 * Assemble a canonical StructuredDocument from an import producer's output.
 *
 * @param {object} input
 * @param {Array}  input.questions - working-shape questions (may carry a transient
 *                                   `passage` ref which is folded into passages[]).
 * @param {Array}  [input.passages] - pre-collected passages; when omitted they are
 *                                     derived from the questions' `passage` refs.
 * @param {Array}  [input.parts]     - part/section groups.
 * @param {object} [input.meta]      - source + engine metadata.
 * @param {object} [input.report]    - a pre-built ImportReport; when omitted a
 *                                      report is assembled from the questions.
 * @param {object} [input.reportInput] - extra numbers for buildImportReport
 *                                        (pagesProcessed, duplicatesRemoved, …).
 */
function buildStructuredDocument(input = {}) {
  const rawQuestions = Array.isArray(input.questions) ? input.questions : [];

  // Fold shared-passage refs into passages[] + passageId unless the producer
  // already did (i.e. passages were passed in AND questions carry passageId).
  let passages = Array.isArray(input.passages) ? input.passages : null;
  let questions = rawQuestions;
  if (!passages) {
    const collected = collectPassages(rawQuestions);
    passages = collected.passages;
    questions = collected.questions;
  }

  questions = questions.map(stampQuestion);

  const validation = gateImport({ questions });

  const report =
    input.report ||
    buildImportReport({
      questionsFound: rawQuestions.length,
      questionsImported: questions.length,
      passagesCaptured: passages.length,
      questions,
      ...(input.reportInput || {}),
    });

  return {
    meta: normaliseMeta(input.meta),
    passages,
    parts: Array.isArray(input.parts) ? input.parts : [],
    questions,
    validation,
    report,
  };
}

function emptyStructuredDocument(meta) {
  return {
    meta: normaliseMeta(meta),
    passages: [],
    parts: [],
    questions: [],
    validation: { ok: false, blockers: [], warnings: [], numbering: null },
    report: buildImportReport({ questions: [] }),
  };
}

module.exports = {
  STRUCTURED_DOCUMENT_FIELDS,
  CANONICAL_QUESTION_FIELDS,
  stampQuestion,
  normaliseMeta,
  buildStructuredDocument,
  emptyStructuredDocument,
};
