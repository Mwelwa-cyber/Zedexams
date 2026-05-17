/**
 * Notes Studio output validator.
 *
 * Mirrors the rubric/lesson-plan validators: fills in defaults where
 * possible, returns `{ ok, value, errors }` so the caller can decide whether
 * to flag the generation for review.
 */

const SCHEMA_VERSION = "1.0";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function isStringArray(v) {
  return Array.isArray(v) && v.every(isNonEmptyString);
}
function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function validateNotes(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  // ── header ─────────────────────────────────────────────────
  const h = input.header || {};
  const header = {
    title: isNonEmptyString(h.title) ? h.title : "",
    grade: isNonEmptyString(h.grade) ? h.grade : "",
    subject: isNonEmptyString(h.subject) ? h.subject : "",
    topic: isNonEmptyString(h.topic) ? h.topic : "",
    subtopic: isNonEmptyString(h.subtopic) ? h.subtopic : "",
    durationMinutes: clampNumber(h.durationMinutes, 5, 240, 40),
    language: isNonEmptyString(h.language) ? h.language : "english",
    school: isNonEmptyString(h.school) ? h.school : "",
    teacherName: isNonEmptyString(h.teacherName) ? h.teacherName : "",
    lessonPlanId: isNonEmptyString(h.lessonPlanId) ? h.lessonPlanId : "",
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.topic) errors.push("header.topic is required");
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");

  // ── introduction ───────────────────────────────────────────
  const i = input.introduction || {};
  const introduction = {
    hook: isNonEmptyString(i.hook) ? i.hook : "",
    whyItMatters: isNonEmptyString(i.whyItMatters) ? i.whyItMatters : "",
    priorKnowledge: isNonEmptyString(i.priorKnowledge) ? i.priorKnowledge : "",
  };

  // ── keyConcepts ────────────────────────────────────────────
  const keyConcepts = (Array.isArray(input.keyConcepts) ? input.keyConcepts : [])
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      name: isNonEmptyString(c.name) ? c.name : "",
      explanation: isNonEmptyString(c.explanation) ? c.explanation : "",
    }))
    .filter((c) => c.name && c.explanation);

  if (keyConcepts.length === 0) {
    errors.push("Notes need at least one key concept.");
  }

  // ── workedExamples ─────────────────────────────────────────
  const workedExamples = (Array.isArray(input.workedExamples) ? input.workedExamples : [])
    .filter((w) => w && typeof w === "object")
    .map((w) => ({
      problem: isNonEmptyString(w.problem) ? w.problem : "",
      steps: isStringArray(w.steps) ? w.steps : [],
      answer: isNonEmptyString(w.answer) ? w.answer : "",
    }))
    .filter((w) => w.problem);

  // ── studentQuestions ───────────────────────────────────────
  const studentQuestions = (Array.isArray(input.studentQuestions) ? input.studentQuestions : [])
    .filter((q) => q && typeof q === "object")
    .map((q) => ({
      question: isNonEmptyString(q.question) ? q.question : "",
      answer: isNonEmptyString(q.answer) ? q.answer : "",
    }))
    .filter((q) => q.question && q.answer);

  // ── misconceptions ─────────────────────────────────────────
  const misconceptions = (Array.isArray(input.misconceptions) ? input.misconceptions : [])
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      misconception: isNonEmptyString(m.misconception) ? m.misconception : "",
      correction: isNonEmptyString(m.correction) ? m.correction : "",
    }))
    .filter((m) => m.misconception && m.correction);

  // ── discussionPrompts / quickChecks ────────────────────────
  const discussionPrompts = isStringArray(input.discussionPrompts) ?
    input.discussionPrompts.slice(0, 12) : [];
  const quickChecks = isStringArray(input.quickChecks) ?
    input.quickChecks.slice(0, 12) : [];

  // ── glossary ───────────────────────────────────────────────
  const glossary = (Array.isArray(input.glossary) ? input.glossary : [])
    .filter((g) => g && typeof g === "object")
    .map((g) => ({
      term: isNonEmptyString(g.term) ? g.term : "",
      definition: isNonEmptyString(g.definition) ? g.definition : "",
    }))
    .filter((g) => g.term && g.definition);

  // ── references ─────────────────────────────────────────────
  const references = isStringArray(input.references) ?
    input.references.slice(0, 8) : [];

  // ── coveredContent ─────────────────────────────────────────
  // Short bullets of what THIS lesson actually taught — used by the
  // no-repeat tracker so a later lesson of the same sub-topic doesn't
  // re-teach it.
  const coveredContent = isStringArray(input.coveredContent) ?
    input.coveredContent.slice(0, 40) : [];

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    introduction,
    keyConcepts,
    workedExamples,
    studentQuestions,
    misconceptions,
    discussionPrompts,
    quickChecks,
    glossary,
    references,
    coveredContent,
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {SCHEMA_VERSION, validateNotes};
