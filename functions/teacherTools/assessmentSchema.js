/**
 * Assessment schema validator — same style as worksheetSchema.js. A formal,
 * graded test: sections of marked questions plus a marking scheme / answer
 * key. Heavier than a worksheet (marks, marking guide per question).
 */

const SCHEMA_VERSION = "1.0";

const ALLOWED_TYPES = new Set([
  "multiple_choice",
  "short_answer",
  "structured",
  "calculation",
  "true_false",
  "essay",
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
function isNonNegativeNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function validateAssessment(input) {
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
      Math.round(Number(h.durationMinutes)) : 40,
    totalMarks: isNonNegativeNumber(Number(h.totalMarks)) ?
      Math.round(Number(h.totalMarks)) : 0,
    instructions: str(h.instructions, 1000) ||
      "Answer ALL questions. Write clearly and show your working.",
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");
  if (!header.topic) errors.push("header.topic is required");

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
                  const type = ALLOWED_TYPES.has(q.type) ?
                    q.type : "short_answer";
                  const marks = isPositiveNumber(q.marks) ?
                    Math.round(q.marks) : 1;
                  marksFromQuestions += marks;
                  const number = isPositiveNumber(q.number) ?
                    Math.round(q.number) : globalQNum;
                  globalQNum = Math.max(globalQNum + 1, number + 1);
                  const options = Array.isArray(q.options) ?
                    q.options.filter(isNonEmptyString) : null;
                  return {
                    number,
                    type,
                    prompt: str(q.prompt, 2000) || "(missing question)",
                    options: (type === "multiple_choice" ||
                      type === "true_false") ?
                      (options && options.length >= 2 ? options : null) :
                      null,
                    marks,
                    answer: str(q.answer, 2000),
                    markingGuide: str(q.markingGuide, 2000),
                  };
                }) :
            [];
          return {
            title: str(s.title, 200) || `Section ${sIdx + 1}`,
            instructions: str(s.instructions, 600),
            questions,
          };
        }) :
    [];

  if (sections.length === 0 ||
      sections.every((s) => s.questions.length === 0)) {
    errors.push("The assessment has no questions.");
  }

  if (header.totalMarks === 0 || header.totalMarks !== marksFromQuestions) {
    header.totalMarks = marksFromQuestions;
  }

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    sections,
    markingScheme: {
      notes: str((input.markingScheme || {}).notes, 3000),
      totalMarks: marksFromQuestions,
    },
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {SCHEMA_VERSION, validateAssessment};
