/**
 * SBA task schema validator.
 *
 * One ECZ-compliant School Based Assessment task: header (subject / grade /
 * task type / Bloom levels / marks), administration instructions, an optional
 * stimulus (passage, data table, diagram description, experiment method…),
 * sub-task questions with model answers + per-step mark allocation, and a
 * marking scheme whose shape follows the task's marking style (answer key,
 * oral observation sheet, method marks, experiment/project rubric, competence
 * or criteria rubric).
 *
 * Permissive by design — like rubricSchema, it normalises a best-effort AI
 * payload rather than rejecting it, so a teacher always gets something to edit.
 */

const SCHEMA_VERSION = "1.0";

const ALLOWED_MARKING_STYLES = new Set([
  "answer_key", "oral_observation", "method_marks",
  "experiment_rubric", "project_rubric", "competence_rubric", "criteria_rubric",
]);

const ALLOWED_BLOOM = new Set([
  "Knowledge", "Comprehension", "Application", "Analysis", "Synthesis", "Evaluation",
]);

function str(v) { return typeof v === "string" ? v.trim() : ""; }
function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }
function nonNegInt(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

function normalizeMarkAllocation(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      description: str(m.description),
      marks: nonNegInt(m.marks),
    }))
    .filter((m) => m.description);
}

function normalizeQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q) => q && typeof q === "object")
    .map((q, i) => ({
      number: nonNegInt(q.number) || i + 1,
      prompt: str(q.prompt),
      marks: nonNegInt(q.marks),
      answer: str(q.answer),
      markAllocation: normalizeMarkAllocation(q.markAllocation),
    }))
    .filter((q) => q.prompt);
}

function normalizeCriteria(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      name: str(c.name),
      maxMarks: nonNegInt(c.maxMarks),
      descriptor: str(c.descriptor),
    }))
    .filter((c) => c.name);
}

function validateSbaTask(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  // ── header ───────────────────────────────────────────────────
  const h = input.header || {};
  const bloomLevels = Array.isArray(h.bloomLevels) ?
    h.bloomLevels.map(str).filter((b) => ALLOWED_BLOOM.has(b)) : [];
  const outcomeRefs = Array.isArray(h.outcomeRefs) ?
    h.outcomeRefs.map(str).filter(Boolean).slice(0, 12) : [];

  const header = {
    title: str(h.title),
    subject: str(h.subject),
    grade: str(h.grade),
    taskType: str(h.taskType),
    component: str(h.component),
    skill: str(h.skill),
    term: str(h.term),
    duration: str(h.duration),
    totalMarks: nonNegInt(h.totalMarks),
    bloomLevels,
    outcomeRefs,
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.taskType) errors.push("header.taskType is required");

  // ── marking scheme ───────────────────────────────────────────
  const ms = input.markingScheme || {};
  const style = ALLOWED_MARKING_STYLES.has(ms.style) ? ms.style : "answer_key";
  const markingScheme = {
    style,
    notes: str(ms.notes),
    criteria: normalizeCriteria(ms.criteria),
  };

  const questions = normalizeQuestions(input.questions);

  // A task is only useful if it can be administered and marked: it needs
  // either gradeable questions or a marking rubric (oral/practical tasks have
  // no written questions — the observation/criteria rows ARE the task).
  if (questions.length === 0 && markingScheme.criteria.length === 0) {
    errors.push("Task needs either questions or marking criteria.");
  }

  // ── total marks: trust the components over a possibly-stale header ─
  const questionMarks = questions.reduce((s, q) => s + q.marks, 0);
  const criteriaMarks = markingScheme.criteria.reduce((s, c) => s + c.maxMarks, 0);
  const computed = questionMarks || criteriaMarks;
  if (computed > 0 && header.totalMarks !== computed) {
    header.totalMarks = computed;
  }

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    instructions: str(input.instructions),
    stimulus: str(input.stimulus),
    questions,
    markingScheme,
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {SCHEMA_VERSION, validateSbaTask, ALLOWED_MARKING_STYLES};
