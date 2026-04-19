/**
 * Worksheet schema validator — same style as lessonPlanSchema.js.
 * No external deps; coerces where safe, returns errors where not.
 */

const SCHEMA_VERSION = "1.0";

const ALLOWED_TYPES = new Set([
  "multiple_choice",
  "short_answer",
  "calculation",
  "true_false",
  "fill_in_blank",
  "essay",
]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v, {minLen = 0} = {}) {
  return Array.isArray(v) && v.length >= minLen && v.every(isNonEmptyString);
}

function isPositiveNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function isNonNegativeNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function validateWorksheet(input) {
  const errors = [];

  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  // ── header ─────────────────────────────────────────────────
  const h = input.header || {};
  const header = {
    title: isNonEmptyString(h.title) ? h.title : "",
    subject: isNonEmptyString(h.subject) ? h.subject : "",
    grade: isNonEmptyString(h.grade) ? h.grade : "",
    topic: isNonEmptyString(h.topic) ? h.topic : "",
    subtopic: isNonEmptyString(h.subtopic) ? h.subtopic : "",
    duration: isNonEmptyString(h.duration) ? h.duration : "",
    totalMarks: isNonNegativeNumber(h.totalMarks) ? Math.round(h.totalMarks) : 0,
    instructions: isNonEmptyString(h.instructions) ?
      h.instructions : "Answer ALL questions. Show your working clearly.",
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");
  if (!header.topic) errors.push("header.topic is required");

  // ── sections ──────────────────────────────────────────────
  let globalQNum = 1;
  let marksFromQuestions = 0;
  const sections = Array.isArray(input.sections) ?
    input.sections
      .filter((s) => s && typeof s === "object")
      .map((s, sIdx) => {
        const questions = Array.isArray(s.questions) ?
          s.questions
            .filter((q) => q && typeof q === "object")
            .map((q) => {
              const type = ALLOWED_TYPES.has(q.type) ? q.type : "short_answer";
              const marks = isPositiveNumber(q.marks) ? Math.round(q.marks) : 1;
              marksFromQuestions += marks;
              const number = isPositiveNumber(q.number) ?
                Math.round(q.number) : globalQNum;
              globalQNum = Math.max(globalQNum + 1, number + 1);

              const options = Array.isArray(q.options) ?
                q.options.filter(isNonEmptyString) :
                null;

              return {
                number,
                type,
                prompt: isNonEmptyString(q.prompt) ? q.prompt : "(missing prompt)",
                options: (type === "multiple_choice" || type === "true_false") ?
                  (options && options.length >= 2 ? options : null) :
                  null,
                marks,
                answer: isNonEmptyString(q.answer) ? q.answer : "",
                workingNotes: isNonEmptyString(q.workingNotes) ? q.workingNotes : "",
              };
            }) :
          [];

        return {
          title: isNonEmptyString(s.title) ? s.title : `Section ${sIdx + 1}`,
          instructions: isNonEmptyString(s.instructions) ? s.instructions : "",
          questions,
        };
      }) :
    [];

  if (sections.length === 0 || sections.every((s) => s.questions.length === 0)) {
    errors.push("The worksheet has no questions.");
  }

  // ── answerKey ─────────────────────────────────────────────
  const ak = input.answerKey || {};
  const answerKey = {
    markingNotes: isNonEmptyString(ak.markingNotes) ? ak.markingNotes : "",
    totalMarks: isNonNegativeNumber(ak.totalMarks) ?
      Math.round(ak.totalMarks) : marksFromQuestions,
  };

  // If header.totalMarks was unset or disagrees with the question sum, prefer
  // the question sum (the authoritative number).
  if (header.totalMarks === 0 || header.totalMarks !== marksFromQuestions) {
    header.totalMarks = marksFromQuestions;
  }
  answerKey.totalMarks = marksFromQuestions;

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    sections,
    answerKey,
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {
  SCHEMA_VERSION,
  validateWorksheet,
};
