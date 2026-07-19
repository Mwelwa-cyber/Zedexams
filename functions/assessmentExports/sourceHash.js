/**
 * Deterministic export "source hash" for an assessment.
 *
 * The hash is the cache key for a generated export: it MUST change whenever any
 * export-relevant content changes (questions, ordering, marks, answers, header,
 * instructions, paper settings, metadata) AND whenever the export template
 * itself changes (bump EXPORT_TEMPLATE_VERSION when a renderer's output shape
 * moves). Two assessments with identical export-relevant content hash to the
 * same value; a single edited mark flips it.
 *
 * Pure — only `node:crypto`, so it runs under plain `node` in tests and can be
 * reused unchanged by any Cloud Function. It deliberately does NOT import
 * firebase-* (the *Core.js convention).
 *
 * The scheme (marking key) and the plain paper share ONE source hash because
 * they render the SAME underlying content — the scheme merely reveals answers
 * that are already part of the hashed projection. One hash → three files
 * (paper.docx / paper.pdf / scheme.docx) under `.../{sourceHash}/`.
 */

const crypto = require("node:crypto");

/**
 * Bump this string whenever an export renderer changes in a way that alters the
 * bytes it would produce for unchanged content (layout tweak, header redesign,
 * new answer-line defaults, image-embedding change). Bumping it invalidates
 * every cached export so the next download regenerates against the new template.
 */
const EXPORT_TEMPLATE_VERSION = "2026-07-19.1";

/**
 * Stable JSON stringify: object keys are emitted in sorted order at every depth
 * so `{a:1,b:2}` and `{b:2,a:1}` serialise identically. Arrays keep their order
 * (question/section order is content). `undefined` fields are dropped; `null`
 * is preserved. This is what makes the hash independent of Firestore's field
 * ordering while staying sensitive to genuine content changes.
 */
function stableStringify(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v === undefined ? null : v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }
  // Numbers/strings/booleans. NaN/Infinity are not valid JSON — coerce to null
  // so a corrupt numeric field can't throw here.
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  return JSON.stringify(value);
}

/** Normalise a Firestore Timestamp / Date / number to a stable millis number,
 * or return the value untouched when it isn't a time. Timestamps that don't
 * affect the rendered paper are excluded from the projection entirely, so this
 * only runs on fields we intentionally hash. */
function toMillis(t) {
  if (!t) return t;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (t instanceof Date) return t.getTime();
  if (typeof t._seconds === "number") return t._seconds * 1000;
  return t;
}

/**
 * Project a single question down to only the fields that change the rendered
 * paper or marking scheme. Firestore ids, audit timestamps and UI-only flags
 * are excluded so re-saving an unchanged paper doesn't churn the hash.
 */
function projectQuestion(q) {
  if (!q || typeof q !== "object") return null;
  return {
    order: Number(q.order ?? 0),
    type: String(q.type || q.detectedType || ""),
    text: q.text ?? q.questionText ?? q.question ?? "",
    marks: Number(q.marks ?? 0),
    options: Array.isArray(q.options) ? q.options.map((o) => (o == null ? "" : o)) : [],
    // Answers/marking-scheme content — part of the hash so a changed answer
    // invalidates the scheme cache (and the plain paper, harmlessly).
    correctAnswer: q.correctAnswer ?? null,
    answer: q.answer ?? null,
    markingScheme: q.markingScheme ?? null,
    explanation: q.explanation ?? null,
    // Visual stimulus: a diagram/image swap must invalidate the export.
    imageUrl: q.imageUrl || "",
    diagramText: q.diagramText || "",
    imageDiagram: q.imageDiagram && q.imageDiagram.libraryKey
      ? { libraryKey: q.imageDiagram.libraryKey, params: q.imageDiagram.params || {} }
      : null,
    passageId: q.passageId || null,
    subParts: Array.isArray(q.subParts) ? q.subParts : undefined,
    answerLines: q.answerLines ?? undefined,
  };
}

/**
 * Build the canonical, render-relevant projection of an assessment + its
 * questions. Everything that the paper/scheme renderers read should appear
 * here; everything they ignore (createdAt, updatedAt, view counts, _id, draft
 * flags) should not.
 */
function buildExportProjection(assessment = {}, questions = []) {
  const a = assessment || {};
  const orderedQuestions = [...(questions || [])]
    .map(projectQuestion)
    .filter(Boolean)
    .sort((x, y) => x.order - y.order);

  return {
    templateVersion: EXPORT_TEMPLATE_VERSION,
    meta: {
      title: a.title ?? "",
      grade: a.grade ?? "",
      subject: a.subject ?? "",
      assessmentType: a.assessmentType ?? "",
      paperName: a.paperName ?? "",
      term: a.term ?? "",
      year: a.year ?? a.assessmentYear ?? "",
      duration: a.duration ?? "",
      assessmentDate: toMillis(a.assessmentDate) ?? "",
    },
    header: {
      schoolName: a.schoolName ?? "",
      schoolLogoUrl: a.schoolLogoUrl ?? "",
      motto: a.motto ?? "",
      address: a.address ?? "",
      emisNumber: a.emisNumber ?? "",
      className: a.className ?? "",
    },
    learnerFields: {
      showNameField: a.showNameField !== false,
      showDateField: a.showDateField !== false,
      showClassField: Boolean(a.showClassField),
      showMarksField: a.showMarksField !== false,
    },
    instructions: a.coverInstructions ?? "",
    paperSettings: {
      mcqOptionLayout: a.mcqOptionLayout ?? null,
      mcqAnswerChoiceCount: a.mcqAnswerChoiceCount ?? null,
      answerLines: a.answerLines ?? null,
    },
    // Structure that reorders/regroups questions on the page.
    parts: Array.isArray(a.parts) ? a.parts : [],
    passages: Array.isArray(a.passages) ? a.passages : [],
    pagebreaks: Array.isArray(a.pagebreaks) ? a.pagebreaks : [],
    ungroupedOrder: a.ungroupedOrder ?? null,
    questions: orderedQuestions,
  };
}

/**
 * The deterministic export source hash: sha256 of the canonical projection,
 * hex, truncated to 32 chars (128 bits — collision-safe for a per-teacher,
 * per-assessment namespace, and short enough for a tidy Storage path).
 */
function computeSourceHash(assessment, questions) {
  const projection = buildExportProjection(assessment, questions);
  const canonical = stableStringify(projection);
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

module.exports = {
  EXPORT_TEMPLATE_VERSION,
  stableStringify,
  projectQuestion,
  buildExportProjection,
  computeSourceHash,
};
