/**
 * Lesson Activities schema validator — for the Lesson Plan Studio's
 * "Assessment Activities" generator. One call can return a Class Exercise
 * (done in class) and/or a Homework (done at home), both grounded on the
 * lesson's grade + subject + topic + sub-topic.
 *
 * Same hand-rolled style as homeworkSchema.js / worksheetSchema.js — no
 * external deps, coerces where safe, never throws. Each activity is a flat
 * numbered question list (richer than homework: every question carries a
 * `type`, optional MCQ options, a matching-pair list, structured sub-parts,
 * a model answer and a marking note) plus an answer key.
 */

const SCHEMA_VERSION = "1.0";

// Canonical internal question types the studio + exporters understand.
const QUESTION_TYPES = [
  "multiple_choice",
  "short_answer",
  "fill_in_blank",
  "matching",
  "structured",
  "true_false",
  "calculation",
  "essay",
];

// Authoring/LLM spellings folded onto the canonical set above.
const TYPE_ALIASES = {
  mcq: "multiple_choice",
  multiplechoice: "multiple_choice",
  "multiple-choice": "multiple_choice",
  short: "short_answer",
  shortanswer: "short_answer",
  fill: "fill_in_blank",
  fill_in_the_blank: "fill_in_blank",
  fill_in_blanks: "fill_in_blank",
  fill_blank: "fill_in_blank",
  fill_blanks: "fill_in_blank",
  fillintheblanks: "fill_in_blank",
  match: "matching",
  tf: "true_false",
  truefalse: "true_false",
  "true/false": "true_false",
  structured_question: "structured",
  structured_questions: "structured",
  calc: "calculation",
};

const DIFFICULTIES = ["easy", "medium", "challenging"];

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function str(v, max) {
  return isNonEmptyString(v) ? String(v).trim().slice(0, max) : "";
}
function isPositiveNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}
function normalizeType(raw) {
  const v = String(raw || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (QUESTION_TYPES.includes(v)) return v;
  if (TYPE_ALIASES[v]) return TYPE_ALIASES[v];
  return "short_answer";
}
function normalizeDifficulty(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (DIFFICULTIES.includes(v)) return v;
  if (v === "hard" || v === "difficult") return "challenging";
  if (v === "moderate") return "medium";
  return "medium";
}

function cleanQuestion(q, fallbackNumber) {
  const type = normalizeType(q.type);
  const number = isPositiveNumber(q.number) ?
    Math.round(q.number) : fallbackNumber;

  const options = Array.isArray(q.options) ?
    q.options.map((o) => str(o, 600)).filter(Boolean).slice(0, 8) : [];

  const matchPairs = Array.isArray(q.matchPairs) ?
    q.matchPairs
        .filter((p) => p && typeof p === "object")
        .map((p) => ({left: str(p.left, 300), right: str(p.right, 300)}))
        .filter((p) => p.left || p.right)
        .slice(0, 12) :
    [];

  const parts = Array.isArray(q.parts) ?
    q.parts
        .filter((p) => p && typeof p === "object")
        .map((p, i) => ({
          label: str(p.label, 12) || `(${"abcdefghij"[i] || i + 1})`,
          prompt: str(p.prompt, 1200),
          answer: str(p.answer, 1200),
          marks: isPositiveNumber(Number(p.marks)) ?
            Math.round(Number(p.marks)) : 1,
        }))
        .filter((p) => p.prompt)
        .slice(0, 8) :
    [];

  return {
    number,
    type,
    prompt: str(q.prompt, 2000) || "(missing question)",
    marks: isPositiveNumber(Number(q.marks)) ? Math.round(Number(q.marks)) : 1,
    options,
    answer: str(q.answer, 1500),
    modelAnswer: str(q.modelAnswer, 2500),
    workingNotes: str(q.workingNotes, 1500),
    matchPairs,
    parts,
  };
}

function cleanActivity(input, kind, errors) {
  if (!input || typeof input !== "object") return null;

  const h = input.header || {};
  const header = {
    title: str(h.title, 200) ||
      (kind === "homework" ? "Homework" : "Class Exercise"),
    grade: str(h.grade, 20),
    subject: str(h.subject, 60),
    topic: str(h.topic, 200),
    subtopic: str(h.subtopic, 200),
    term: Number.isInteger(Number(h.term)) ? Number(h.term) : null,
    difficulty: normalizeDifficulty(h.difficulty),
    estimatedMinutes: isPositiveNumber(Number(h.estimatedMinutes)) ?
      Math.round(Number(h.estimatedMinutes)) :
      (kind === "homework" ? 20 : 15),
    totalMarks: isPositiveNumber(Number(h.totalMarks)) ?
      Math.round(Number(h.totalMarks)) : 0,
    instructions: str(h.instructions, 1000),
  };
  if (!header.grade) errors.push(`${kind}.header.grade is required`);
  if (!header.subject) errors.push(`${kind}.header.subject is required`);
  if (!header.topic) errors.push(`${kind}.header.topic is required`);

  // The "word box" (a.k.a. word bank / white box) of choices shown above the
  // questions for fill-in-the-blank exercises. Kept as structured data so the
  // exporter can render it in its own bordered box BELOW the instruction,
  // rather than the model cramming the list into the instruction text.
  const wordBank = Array.isArray(input.wordBank) ?
    input.wordBank.map((w) => str(w, 80)).filter(Boolean).slice(0, 40) : [];

  let n = 1;
  const questions = Array.isArray(input.questions) ?
    input.questions
        .filter((q) => q && typeof q === "object")
        .map((q) => {
          const cleaned = cleanQuestion(q, n);
          n = Math.max(n + 1, cleaned.number + 1);
          return cleaned;
        }) :
    [];
  if (questions.length === 0) {
    errors.push(`${kind} has no questions.`);
  }

  // Auto-sum the paper total when the model omitted it.
  if (!header.totalMarks) {
    header.totalMarks = questions.reduce(
        (sum, q) => sum + (q.parts.length ?
          q.parts.reduce((s, p) => s + (p.marks || 0), 0) : (q.marks || 0)),
        0,
    );
  }

  return {
    kind,
    header,
    instructions: str(input.instructions, 1000) ||
      (kind === "homework" ?
        "Do this work at home on your own. Show all your working." :
        "Answer all the questions. Show your working where needed."),
    wordBank,
    questions,
    parentNote: kind === "homework" ? str(input.parentNote, 1000) : "",
    answerKey: {
      markingNotes: str((input.answerKey || {}).markingNotes, 2500),
    },
  };
}

/**
 * Validate the combined `{ exercise, homework }` payload. `wanted` tells the
 * validator which activities were requested so a missing one is only an error
 * when it was asked for.
 *
 * @param {object} input  raw model output
 * @param {{exercise?: boolean, homework?: boolean}} wanted
 * @return {{ok: boolean, value: object, errors?: string[]}}
 */
function validateLessonActivities(input, wanted = {}) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."], value: {exercise: null, homework: null}};
  }

  const exercise = wanted.exercise ?
    cleanActivity(input.exercise, "exercise", errors) : null;
  const homework = wanted.homework ?
    cleanActivity(input.homework, "homework", errors) : null;

  if (wanted.exercise && !exercise) {
    errors.push("Class exercise was requested but not produced.");
  }
  if (wanted.homework && !homework) {
    errors.push("Homework was requested but not produced.");
  }

  const value = {schemaVersion: SCHEMA_VERSION, exercise, homework};
  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {
  SCHEMA_VERSION,
  QUESTION_TYPES,
  DIFFICULTIES,
  normalizeType,
  normalizeDifficulty,
  validateLessonActivities,
};
