/**
 * suggestQuizAnswers — batched "work out the correct option" for the Quiz
 * Editor's bulk answer tools.
 *
 * Scanned ECZ papers import with every answer blank. The per-question AI
 * "Suggest answer" already exists, but keying 60 answers one at a time (or
 * running 60 separate AI calls) is the slow part. This callable answers a
 * whole batch of MCQs in ONE Claude call and returns each question's best
 * option index, so the editor can fill them in a single pass. Every answer is
 * a *suggestion* the admin still verifies — the questions stay flagged.
 *
 * Pure helpers (input sanitising, prompt, output parsing) are exported and
 * unit-tested with the model injected; the Anthropic client is lazy-required
 * so the file loads in the CI "Tests" job (root-only npm ci, no functions
 * deps), matching scannedQuizImport.js.
 */

function httpsError(code, message) {
  try {
    const {HttpsError} = require("firebase-functions/v2/https");
    return new HttpsError(code, message);
  } catch {
    return Object.assign(new Error(message), {code});
  }
}

const SUGGEST_MODEL =
  process.env.SUGGEST_ANSWERS_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  "claude-sonnet-4-5";

const MAX_QUESTIONS = 100;
const MAX_STEM = 1200;
const MAX_OPTION = 400;

const ANSWERS_TOOL_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: {type: "string"},
          index: {
            type: ["integer", "null"],
            description:
              "0-based index of the best option, or null if genuinely unsure.",
          },
        },
        required: ["id", "index"],
      },
    },
  },
  required: ["answers"],
};

const SYSTEM_PROMPT = [
  "You are a Zambian ECZ examiner answering primary-school multiple-choice",
  "questions. For each question you are given an id, the stem, and the options",
  "in order. Choose the single best option and return its 0-based index via the",
  "tool. If a question is genuinely unanswerable (missing a needed diagram, or",
  "two options look equally correct), return index null rather than guessing.",
  "Answer using standard Zambian CBC knowledge. Return one entry per id.",
].join(" ");

function clampText(value, max) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Validate the incoming questions. Keeps only items with an id, a stem, and at
 * least two options; clamps text. Returns { questions, byId } where byId maps
 * id → option count for range-checking the model's answer.
 */
function sanitiseSuggestInput(rawQuestions) {
  const list = Array.isArray(rawQuestions) ? rawQuestions : [];
  const questions = [];
  const optionCountById = new Map();
  for (const raw of list.slice(0, MAX_QUESTIONS)) {
    const id = clampText(raw?.id, 80);
    const text = clampText(raw?.text, MAX_STEM);
    const options = (Array.isArray(raw?.options) ? raw.options : [])
      .map((o) => clampText(o, MAX_OPTION))
      .slice(0, 6);
    // An option may legitimately be blank (a picture option) — keep the slot
    // so indices line up, but require at least two slots and a stem.
    if (!id || !text || options.length < 2) continue;
    if (optionCountById.has(id)) continue; // ids must be unique
    optionCountById.set(id, options.length);
    questions.push({id, text, options});
  }
  return {questions, optionCountById};
}

function buildSuggestMessages(questions, hints = {}) {
  const lines = questions.map((q) => {
    const opts = q.options
      .map((o, i) => `   ${String.fromCharCode(65 + i)}. ${o || "(picture option)"}`)
      .join("\n");
    return `id: ${q.id}\n${q.text}\n${opts}`;
  });
  const header = [
    hints.subject ? `Subject: ${hints.subject}` : "",
    hints.grade ? `Grade: ${hints.grade}` : "",
    "Answer every question below. Return the 0-based index of the best option",
    "for each id via the tool (null only when truly unanswerable).",
  ].filter(Boolean).join("\n");
  return [{role: "user", content: `${header}\n\n${lines.join("\n\n")}`}];
}

/**
 * Parse the model's answers into a { id: index } map, keeping only ids we
 * asked about and indices inside that question's option range. Null / unsure
 * answers are dropped (left blank for the admin).
 */
function parseSuggestOutput(rawAnswers, optionCountById) {
  const list = Array.isArray(rawAnswers) ? rawAnswers : [];
  const map = {};
  for (const item of list) {
    const id = typeof item?.id === "string" ? item.id : "";
    if (!optionCountById.has(id)) continue;
    const index = item?.index;
    if (!Number.isInteger(index)) continue;
    if (index < 0 || index >= optionCountById.get(id)) continue;
    map[id] = index;
  }
  return map;
}

async function runSuggestQuizAnswers(
  {questions: rawQuestions, subject, grade, anthropicKey, uid},
  deps = {},
) {
  const callAnthropic = deps.callAnthropic ||
    require("./aiService").callAnthropic;

  const {questions, optionCountById} = sanitiseSuggestInput(rawQuestions);
  if (!questions.length) {
    throw httpsError("invalid-argument", "No answerable questions were supplied.");
  }

  const result = await callAnthropic(anthropicKey, {
    systemPrompt: SYSTEM_PROMPT,
    messages: buildSuggestMessages(questions, {subject, grade}),
    model: SUGGEST_MODEL,
    maxTokens: 4000,
    temperature: 0,
    tools: [{
      name: "return_answers",
      description: "Return the best option index for each question id.",
      input_schema: ANSWERS_TOOL_SCHEMA,
    }],
    toolChoice: {type: "tool", name: "return_answers"},
    track: uid ? {uid, tool: "suggestQuizAnswers"} : null,
  });

  // callAnthropic returns the tool input as a JSON string when tools are set.
  let parsed = {};
  try {
    parsed = typeof result === "string" ? JSON.parse(result) : (result || {});
  } catch {
    parsed = {};
  }
  const answers = parseSuggestOutput(parsed.answers, optionCountById);

  return {answers, count: Object.keys(answers).length, asked: questions.length};
}

module.exports = {
  runSuggestQuizAnswers,
  // Exported for tests:
  sanitiseSuggestInput,
  buildSuggestMessages,
  parseSuggestOutput,
  ANSWERS_TOOL_SCHEMA,
  SUGGEST_MODEL,
  MAX_QUESTIONS,
};
