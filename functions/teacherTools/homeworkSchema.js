/**
 * Homework schema validator — same style as worksheetSchema.js /
 * fullLessonSchema.js. No external deps; coerces where safe.
 *
 * Homework is short take-home practice: a single numbered question list with
 * answers + brief working notes, a parent/guardian note, and an estimated
 * time. Lighter than a worksheet, designed for independent work at home.
 */

const SCHEMA_VERSION = "1.0";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function str(v, max) {
  return isNonEmptyString(v) ? String(v).trim().slice(0, max) : "";
}
function isPositiveNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function validateHomework(input) {
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
    estimatedMinutes: isPositiveNumber(Number(h.estimatedMinutes)) ?
      Math.round(Number(h.estimatedMinutes)) : 20,
    language: str(h.language, 30) || "English",
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");
  if (!header.topic) errors.push("header.topic is required");

  let globalQNum = 1;
  const questions = Array.isArray(input.questions) ?
    input.questions
        .filter((q) => q && typeof q === "object")
        .map((q) => {
          const number = isPositiveNumber(q.number) ?
            Math.round(q.number) : globalQNum;
          globalQNum = Math.max(globalQNum + 1, number + 1);
          return {
            number,
            prompt: str(q.prompt, 1500) || "(missing question)",
            answer: str(q.answer, 1500),
            workingNotes: str(q.workingNotes, 1500),
          };
        }) :
    [];
  if (questions.length === 0) {
    errors.push("Homework has no questions.");
  }

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    instructions: str(input.instructions, 1000) ||
      "Do this work at home on your own. Show your working.",
    questions,
    parentNote: str(input.parentNote, 1000),
    answerKey: {
      markingNotes: str(
          (input.answerKey || {}).markingNotes, 2000),
    },
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {SCHEMA_VERSION, validateHomework};
