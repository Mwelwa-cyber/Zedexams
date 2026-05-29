/**
 * functions/editQuestionPrompt.js
 *
 * Pure (no firebase-functions / firebase-admin) helpers for the per-question
 * AI edit callable. Kept dependency-free — exactly like aiPromptPolicy.js — so
 * editQuizQuestion.test.js runs under the CI "tests" job, which installs only
 * the repo-root deps (`npm ci`), NOT functions/node_modules.
 *
 * aiService.js re-exports these (wrapping parseEditedQuestion's thrown Error in
 * an HttpsError) so the Cloud Function keeps its friendly error message.
 */

// Minimal local copies of the two text helpers (kept tiny and stable). They
// intentionally mirror aiService.cleanString / stripJsonFences; the edit tests
// pin their behaviour so drift is caught.
const EDIT_LIMITS = {question: 1200, subject: 80, grade: 20, topic: 120};

function cleanString(value, maxLength = 600) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function stripJsonFences(raw) {
  if (!raw) return "";
  const fence = String(raw).match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fence ? fence[1] : raw).trim();
}

// action key → the instruction handed to the model. Terse + concrete: this is
// the whole behaviour contract for the "✨ AI" button on every question.
const EDIT_QUESTION_ACTIONS = {
  simplify:
    "Rewrite the question so a struggling learner can understand it: simpler " +
    "words, shorter sentences. Keep the SAME concept, the same number of " +
    "options (with the same meaning), and the same correct option.",
  easier:
    "Lower the difficulty while still testing the same concept and CBC topic. " +
    "You may simplify the numbers or wording. Keep four options and one " +
    "correct answer.",
  harder:
    "Raise the difficulty while still testing the same concept and CBC topic, " +
    "staying appropriate for the grade. Keep four options and one correct " +
    "answer.",
  rephrase:
    "Reword the question to read more clearly, WITHOUT changing its meaning, " +
    "difficulty, options, or correct answer.",
  suggest_answer:
    "Work out the correct answer to this question. Return the correct option " +
    "LETTER and a short explanation. Do NOT change the question text or options.",
  explain:
    "Write a short, kind explanation (under 80 words) of why the correct " +
    "answer is correct, for a Zambian learner. Do NOT change the question or " +
    "options.",
};

function isEditQuestionAction(action) {
  return Object.prototype.hasOwnProperty.call(EDIT_QUESTION_ACTIONS, action);
}

// Build the messages for the per-question AI edit callable. `payload` carries
// the plain-text question, options, correctAnswer letter, grade/subject/topic,
// and the chosen action.
function buildEditQuestionMessages(payload) {
  const subject = cleanString(payload.subject, EDIT_LIMITS.subject);
  const grade = cleanString(payload.grade, EDIT_LIMITS.grade);
  const topic = cleanString(payload.topic, EDIT_LIMITS.topic);
  const action = cleanString(payload.action, 30);
  const question = cleanString(payload.question, EDIT_LIMITS.question);
  const options = (Array.isArray(payload.options) ? payload.options : [])
    .slice(0, 6)
    .map((opt) => cleanString(opt, 300));
  const correctAnswer = cleanString(payload.correctAnswer, 40);
  const context = [grade && `Grade ${grade}`, subject, topic]
    .filter(Boolean)
    .join(", ");

  const optionLines = options.length ?
    options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join("\n") :
    "(no options — this is a short-answer / numeric question)";

  return [
    {
      role: "system",
      content: [
        "You help Zambian CBC teachers improve a single quiz question.",
        "Keep everything appropriate for the given grade and subject.",
        "Preserve mathematics with this markup so the editor renders it as",
        "real fractions, column sums, maths and tables: fractions as",
        "\\frac{3}{4} (mixed: 1\\frac{1}{3}); other inline maths in $...$ e.g.",
        "$\\sqrt{49}$, $x^2$; vertical/column arithmetic as one token on its",
        "own line [[vmath op=- lines=954751,362948 answer=]]; tables as a",
        "GitHub-style Markdown table.",
        "Never use 'all of the above', 'none of the above', or 'both A and B'.",
        "Return ONLY a JSON object. No markdown fences, no commentary.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        context ? `Context: ${context}` : "",
        `Task: ${EDIT_QUESTION_ACTIONS[action] || EDIT_QUESTION_ACTIONS.rephrase}`,
        "",
        `Question: ${question}`,
        "Options:",
        optionLines,
        correctAnswer ? `Current correct answer: ${correctAnswer}` : "",
        "",
        "Return JSON with ONLY the fields you actually changed:",
        "{\"text\":\"revised stem\",\"options\":[\"A\",\"B\",\"C\",\"D\"],",
        "\"correctAnswer\":\"B\",\"explanation\":\"...\",\"note\":\"one short",
        "sentence telling the teacher what you did\"}",
        "- Omit text and options if you did not change them.",
        "- correctAnswer must be the LETTER of the correct option (A, B, C…).",
        "- Keep the option count the same when you rewrite options.",
        "- Use the maths markup above for any fraction, sum, or table.",
      ].filter(Boolean).join("\n"),
    },
  ];
}

// Parse the edit-callable response into a patch the client can apply. Only the
// fields the model actually returned are present, so an apply never blanks a
// field the teacher kept. Throws a plain Error on unparseable input; the
// aiService wrapper turns that into an HttpsError for the callable.
function parseEditedQuestion(raw) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    throw new Error("AI edit response was not valid JSON.");
  }

  const patch = {};
  if (typeof parsed.text === "string" && parsed.text.trim()) {
    patch.text = cleanString(parsed.text, EDIT_LIMITS.question);
  }
  if (Array.isArray(parsed.options)) {
    const opts = parsed.options
      .map((opt) => cleanString(opt, 300))
      .filter((opt) => opt.length);
    if (opts.length >= 2) patch.options = opts.slice(0, 6);
  }
  if (parsed.correctAnswer !== null && parsed.correctAnswer !== undefined) {
    const letter = cleanString(String(parsed.correctAnswer), 40);
    if (letter) patch.correctAnswer = letter;
  }
  if (typeof parsed.explanation === "string" && parsed.explanation.trim()) {
    patch.explanation = cleanString(parsed.explanation, 800);
  }
  if (typeof parsed.note === "string" && parsed.note.trim()) {
    patch.note = cleanString(parsed.note, 240);
  }
  return patch;
}

module.exports = {
  EDIT_QUESTION_ACTIONS,
  isEditQuestionAction,
  buildEditQuestionMessages,
  parseEditedQuestion,
};
