/**
 * Quiz schema validator — same style as worksheetSchema.js /
 * assessmentSchema.js. A quiz is a short, mostly auto-checkable formative
 * check: a flat numbered question list (MCQ / true-false / short answer)
 * with the correct answer and a one-line explanation, plus a compact
 * answer key. Lighter than an Assessment (no sections, no marks).
 */

const SCHEMA_VERSION = "1.0";

const ALLOWED_TYPES = new Set([
  "multiple_choice",
  "true_false",
  "short_answer",
]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function str(v, max) {
  return isNonEmptyString(v) ? String(v).trim().slice(0, max) : "";
}
function isPositiveNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function validateQuiz(input) {
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
    durationMinutes: isPositiveNumber(Number(h.durationMinutes)) ?
      Math.round(Number(h.durationMinutes)) : 15,
    instructions: str(h.instructions, 800) ||
      "Answer all questions. Choose the best answer.",
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");
  if (!header.topic) errors.push("header.topic is required");

  let n = 1;
  const questions = Array.isArray(input.questions) ?
    input.questions
        .filter((q) => q && typeof q === "object")
        .map((q) => {
          const type = ALLOWED_TYPES.has(q.type) ?
            q.type : "multiple_choice";
          const number = isPositiveNumber(q.number) ?
            Math.round(q.number) : n;
          n = Math.max(n + 1, number + 1);
          const options = Array.isArray(q.options) ?
            q.options.filter(isNonEmptyString).slice(0, 6) : [];
          return {
            number,
            type,
            question: str(q.question, 1500) || "(missing question)",
            options: (type === "multiple_choice" || type === "true_false") ?
              (options.length >= 2 ? options : []) :
              [],
            correctAnswer: str(q.correctAnswer, 1000),
            explanation: str(q.explanation, 1500),
          };
        }) :
    [];
  if (questions.length === 0) {
    errors.push("The quiz has no questions.");
  }
  const mcqMissingOptions = questions.filter(
      (q) => q.type === "multiple_choice" && q.options.length < 2,
  ).length;
  if (mcqMissingOptions > 0) {
    errors.push(`${mcqMissingOptions} multiple-choice question(s) have ` +
      "fewer than 2 options.");
  }

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    questions,
    answerKey: {
      notes: str((input.answerKey || {}).notes, 2000),
    },
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {SCHEMA_VERSION, validateQuiz};
