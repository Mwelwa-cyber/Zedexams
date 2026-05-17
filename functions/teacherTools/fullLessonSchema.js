/**
 * Full Lesson schema validator — same style as worksheetSchema.js /
 * notesSchema.js. No external deps; coerces where safe, returns errors
 * where not.
 *
 * A "Full Lesson" is a single self-contained lesson a teacher can deliver
 * end to end: objectives, vocabulary, an engaging intro, the core teaching
 * content explained for learners, worked examples, guided + independent
 * practice, formative checks with answers, a summary and homework.
 */

const SCHEMA_VERSION = "1.0";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function str(v, max) {
  return isNonEmptyString(v) ? String(v).trim().slice(0, max) : "";
}
function strArr(v, {max = 600, cap = 40} = {}) {
  if (!Array.isArray(v)) return [];
  return v.filter(isNonEmptyString)
    .map((s) => String(s).trim().slice(0, max)).slice(0, cap);
}
function pairArr(v, ka, kb, {max = 800, cap = 20} = {}) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      [ka]: str(x[ka], max),
      [kb]: str(x[kb], max),
    }))
    .filter((x) => x[ka] || x[kb])
    .slice(0, cap);
}

function validateFullLesson(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  const h = input.header || {};
  const header = {
    title: str(h.title, 200),
    grade: str(h.grade, 20),
    subject: str(h.subject, 60),
    topic: str(h.topic, 200),
    subtopic: str(h.subtopic, 200),
    term: Number.isInteger(Number(h.term)) ? Number(h.term) : null,
    durationMinutes: Number.isFinite(Number(h.durationMinutes)) ?
      Math.round(Number(h.durationMinutes)) : 40,
    language: str(h.language, 30) || "English",
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");
  if (!header.topic) errors.push("header.topic is required");

  const intro = input.introduction || {};
  const introduction = {
    hook: str(intro.hook, 1200),
    priorKnowledge: str(intro.priorKnowledge, 1200),
  };

  const a = input.assessment || {};
  const assessment = {
    checks: strArr(a.checks, {max: 600}),
    answers: strArr(a.answers, {max: 600}),
  };

  const hw = input.homework || {};
  const homework = {
    task: str(hw.task, 2000),
    answerGuide: str(hw.answerGuide, 2000),
  };

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    objectives: strArr(input.objectives, {max: 500}),
    keyVocabulary: pairArr(input.keyVocabulary, "term", "definition",
        {max: 400}),
    introduction,
    teaching: pairArr(input.teaching, "heading", "explanation",
        {max: 4000, cap: 12}),
    workedExamples: Array.isArray(input.workedExamples) ?
      input.workedExamples
          .filter((x) => x && typeof x === "object")
          .map((x) => ({
            problem: str(x.problem, 1000),
            steps: strArr(x.steps, {max: 600}),
            answer: str(x.answer, 600),
          }))
          .filter((x) => x.problem)
          .slice(0, 8) :
      [],
    guidedPractice: strArr(input.guidedPractice, {max: 800}),
    learnerActivities: strArr(input.learnerActivities, {max: 800}),
    assessment,
    summary: str(input.summary, 3000),
    homework,
    references: strArr(input.references, {max: 300, cap: 8}),
  };

  const hasBody = value.objectives.length > 0 ||
    value.teaching.length > 0 || value.learnerActivities.length > 0;
  if (!hasBody) {
    errors.push("The lesson has no objectives, teaching content or activities.");
  }

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {
  SCHEMA_VERSION,
  validateFullLesson,
};
