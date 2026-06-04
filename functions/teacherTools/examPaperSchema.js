/**
 * Exam-paper schema validator — same style as quizSchema.js.
 *
 * An exam paper is a flat numbered list of single-best-answer multiple-choice
 * questions in the ECZ Grade 7 style. Each item carries the FULL-text correct
 * answer (which must appear among the options), a one-line explanation, the
 * area it tests, and a difficulty band.
 *
 * Unlike the scanned-paper importer, the generator invents each item, so a
 * valid, in-range correctAnswer is REQUIRED — an item whose correctAnswer is
 * missing or does not match an option is a schema error (the runner flags the
 * generation for review rather than silently shipping a broken key).
 */

const SCHEMA_VERSION = "1.0";

const ALLOWED_DIFFICULTY = new Set(["easy", "medium", "hard"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function str(v, max) {
  return isNonEmptyString(v) ? String(v).trim().slice(0, max) : "";
}
function isPositiveInt(v) {
  return Number.isFinite(Number(v)) && Number(v) > 0;
}

/**
 * @param {object} input    raw model output
 * @param {object} [opts]
 * @param {number} [opts.optionCount] expected options per question (default 4)
 */
function validateExamPaper(input, opts = {}) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  const expectedOptions = Math.min(6, Math.max(2,
      Math.round(Number(opts.optionCount) ||
        Number((input.header || {}).optionCount) || 4)));

  const h = input.header || {};
  const header = {
    title: str(h.title, 200),
    grade: str(h.grade, 20),
    subject: str(h.subject, 60),
    topic: str(h.topic, 200),
    subtopic: str(h.subtopic, 200),
    optionCount: expectedOptions,
    instructions: str(h.instructions, 800) ||
      "Answer ALL questions. For each question, choose the ONE best answer.",
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");

  let n = 1;
  let badAnswers = 0;
  let badOptionCounts = 0;
  const questions = Array.isArray(input.questions) ?
    input.questions
        .filter((q) => q && typeof q === "object")
        .map((q) => {
          const number = isPositiveInt(q.number) ? Math.round(q.number) : n;
          n = Math.max(n + 1, number + 1);

          const options = Array.isArray(q.options) ?
            q.options.filter(isNonEmptyString).map((o) => String(o).trim())
                .slice(0, 6) :
            [];

          // correctAnswer must be the FULL text of one of the options.
          const rawAnswer = str(q.correctAnswer, 1000);
          const match = options.find(
              (o) => o.toLowerCase() === rawAnswer.toLowerCase(),
          );
          if (!match) badAnswers += 1;
          if (options.length !== expectedOptions) badOptionCounts += 1;

          const difficulty = ALLOWED_DIFFICULTY.has(q.difficulty) ?
            q.difficulty : "medium";

          return {
            number,
            type: "multiple_choice",
            question: str(q.question, 1500) || "(missing question)",
            options,
            // Normalise to the canonical option text when it matched, so the
            // exported answer key always lines up exactly with an option.
            correctAnswer: match || rawAnswer,
            explanation: str(q.explanation, 1500),
            topic: str(q.topic, 200),
            difficulty,
          };
        }) :
    [];

  if (questions.length === 0) {
    errors.push("The exam paper has no questions.");
  }
  if (badOptionCounts > 0) {
    errors.push(`${badOptionCounts} question(s) do not have exactly ` +
      `${expectedOptions} options.`);
  }
  if (badAnswers > 0) {
    errors.push(`${badAnswers} question(s) have a correctAnswer that does ` +
      "not match one of the options.");
  }

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    questions,
    // Kept for parity with the quiz shape so the existing DOCX exporter
    // (downloadQuizDocx) can render the same structure unchanged.
    answerKey: {
      notes: str((input.answerKey || {}).notes, 2000),
    },
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {SCHEMA_VERSION, validateExamPaper};
