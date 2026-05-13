/**
 * suggestAnswer — HTTPS callable Cloud Function.
 *
 * Given a single question (any type the studio supports), asks Claude
 * Haiku 4.5 to predict the correct answer and return a one-line rationale
 * + a confidence score. The studio renders the suggestion behind an
 * "AI-suggested" badge until the teacher confirms.
 *
 * Usage from client:
 *   const fn = httpsCallable(functions, 'suggestAnswer');
 *   const result = await fn({
 *     type: 'mcq',                 // mcq | short_answer | structured | essay | numeric | true_false
 *     text: 'What is 7 × 8?',
 *     options: ['54','55','56','57'],   // mcq only
 *     grade: 'G5',                 // optional, sharpens grade-fit
 *     subject: 'mathematics',      // optional
 *     language: 'english',         // optional
 *     wordBank: ['Lungs','Trachea'], // structured only, optional
 *   });
 *   // result.data -> { answer, rationale, confidence }
 *   //   - mcq: answer = option index (0..n-1)
 *   //   - everything else: answer = string
 *   //   - confidence: 'high' | 'medium' | 'low'
 *
 * Cheap tool — Haiku at ~$1/M input, ~$5/M output, with ~300 tokens out per
 * call. Quota is generous because teachers will run this on every imported
 * question.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");
const {assertAndIncrement} = require("./usageMeter");

const SUGGEST_MODEL = process.env.SUGGEST_ANSWER_MODEL || "claude-haiku-4-5";

const ALLOWED_TYPES = new Set([
  "mcq",
  "short_answer",
  "structured",
  "diagram",
  "essay",
  "numeric",
  "true_false",
  "fill_blank",
]);

const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);

function str(v, max) {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function sanitizeInputs(raw = {}) {
  const type = str(raw.type, 24).toLowerCase();
  const text = str(raw.text, 2000);
  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();

  // MCQ options — keep at most 6, each ≤ 240 chars (matches studio UI cap).
  // CRITICAL: we keep the original array indices including blanks, because
  // the studio's correctAnswer field is a 0-based index INTO THE ORIGINAL
  // options array. Filtering out blanks here and reindexing would cause the
  // returned answer to point at the wrong option when a middle option is
  // empty (e.g. ['A','','C','D'] becomes ['A','C','D'] and "C" gets index 1
  // instead of 2). We only filter at prompt-render time below.
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const options = rawOptions
    .slice(0, 6)
    .map((opt) => str(opt, 240));
  // Count of non-empty options for validation purposes only.
  const nonEmptyOptionCount = options.filter((opt) => opt.length > 0).length;

  // Word bank — structured questions sometimes ship one.
  const rawBank = Array.isArray(raw.wordBank) ? raw.wordBank : [];
  const wordBank = rawBank
    .map((w) => str(w, 80))
    .filter((w) => w.length > 0)
    .slice(0, 20);

  return {
    type: ALLOWED_TYPES.has(type) ? type : "short_answer",
    text,
    grade,
    subject,
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    options,
    nonEmptyOptionCount,
    wordBank,
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.text) errs.push("Question text is required.");
  if (inputs.type === "mcq" && inputs.nonEmptyOptionCount < 2) {
    errs.push("MCQs need at least two filled-in options.");
  }
  return errs;
}

const SYSTEM_PROMPT = [
  "You are an expert Zambian CBC examiner.",
  "Your job: predict the correct answer for a single exam question and",
  "give a short rationale. You are NOT generating the question or alternatives —",
  "only answering the one provided.",
  "",
  "Rules:",
  "- Stay strictly within the Zambian CBC (ECE–G12) syllabus.",
  "- If the question is mathematical, do the arithmetic step by step internally,",
  "  but only output the final numeric answer in the structured response.",
  "- For MCQ, you MUST return the 0-based index of the option you believe is correct.",
  "- For short-answer / numeric / fill-blank, return the shortest correct answer",
  "  a teacher would mark as right.",
  "- For structured / diagram / essay, return concise marking notes (1–3 sentences)",
  "  that capture the expected response.",
  "- For true_false, return the literal string \"True\" or \"False\".",
  "- Rationale: one sentence, ≤ 30 words, suitable for a teacher to verify at a glance.",
  "- Confidence: 'high' if you are certain, 'medium' if there is mild ambiguity,",
  "  'low' if the question is ambiguous, off-syllabus, or you had to guess.",
  "- If the question is unanswerable as written (missing data, contradictory),",
  "  set confidence='low' and put the issue in the rationale.",
].join("\n");

function buildUserPrompt(inputs) {
  const lines = [];
  if (inputs.grade) lines.push(`Grade: ${inputs.grade}`);
  if (inputs.subject) lines.push(`Subject: ${inputs.subject.replace(/_/g, " ")}`);
  if (inputs.language && inputs.language !== "english") {
    lines.push(`Language: ${inputs.language}`);
  }
  lines.push(`Question type: ${inputs.type}`);
  lines.push("");
  lines.push("Question:");
  lines.push(inputs.text);

  if (inputs.type === "mcq") {
    lines.push("");
    lines.push(
      "Options (you MUST return the 0-based index of one of these — " +
      "indices match the teacher's option order exactly, and you must NOT " +
      "renumber them):",
    );
    // Only show non-empty options to the model, but keep the ORIGINAL
    // 0-based index from inputs.options. This way the teacher's option
    // layout is preserved when the model's answer index is applied
    // client-side, even if a middle option is blank.
    inputs.options.forEach((opt, i) => {
      if (opt && opt.length > 0) {
        lines.push(`  [${i}] ${opt}`);
      }
    });
  }

  if (inputs.wordBank.length > 0) {
    lines.push("");
    lines.push(`Word bank teacher provided: ${inputs.wordBank.join(", ")}`);
  }

  return lines.join("\n");
}

// Permissive tool schema — the post-call coercion below does the strict
// shape checking against the question type. This keeps the prompt-side
// description as the source of truth and avoids Claude refusing to emit
// when a value is borderline.
const SUGGEST_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    // For MCQ: a 0-based integer. For everything else: a string.
    answer: {
      oneOf: [
        {type: "integer", minimum: 0, maximum: 5},
        {type: "string", maxLength: 800},
      ],
    },
    rationale: {type: "string", maxLength: 300},
    confidence: {type: "string", enum: ["high", "medium", "low"]},
  },
  required: ["answer", "rationale", "confidence"],
};

function coerceResult(parsed, inputs) {
  const rationale = str(parsed && parsed.rationale, 300) ||
    "No rationale provided by the model.";
  const rawConfidence = String(parsed && parsed.confidence || "").toLowerCase();
  const confidence = ["high", "medium", "low"].includes(rawConfidence) ?
    rawConfidence : "low";

  if (inputs.type === "mcq") {
    const idx = Number(parsed && parsed.answer);
    const inBounds = Number.isFinite(idx) && idx >= 0 &&
      idx < inputs.options.length;
    // Reject if the model picked a blank option index (means it ignored
    // the instruction to only choose from non-empty ones).
    const pointsAtFilledOption = inBounds &&
      (inputs.options[Math.floor(idx)] || "").length > 0;
    if (!pointsAtFilledOption) {
      // Pick the first non-empty option's index as a safe fallback;
      // mark low confidence so the UI flags it.
      const fallback = inputs.options.findIndex((o) => o && o.length > 0);
      return {
        answer: fallback >= 0 ? fallback : 0,
        rationale,
        confidence: "low",
      };
    }
    return {answer: Math.floor(idx), rationale, confidence};
  }

  if (inputs.type === "true_false") {
    const val = String(parsed && parsed.answer || "").trim().toLowerCase();
    if (val === "true" || val === "t") {
      return {answer: "True", rationale, confidence};
    }
    if (val === "false" || val === "f") {
      return {answer: "False", rationale, confidence};
    }
    return {answer: "True", rationale, confidence: "low"};
  }

  // Free-form text answer.
  const answer = str(parsed && parsed.answer, 800);
  if (!answer) {
    return {answer: "", rationale, confidence: "low"};
  }
  return {answer, rationale, confidence};
}

async function runSuggestAnswer({uid, inputs, apiKey}) {
  const {parsed} = await callClaude(apiKey, {
    model: SUGGEST_MODEL,
    mode: "tool",
    systemPrompt: SYSTEM_PROMPT,
    messages: [{role: "user", content: buildUserPrompt(inputs)}],
    maxTokens: 400,
    temperature: 0.0,
    toolName: "submit_answer",
    toolDescription:
      "Submit the predicted correct answer, a short rationale, and a confidence rating.",
    toolInputSchema: SUGGEST_TOOL_SCHEMA,
    // Match the other Haiku-based teacher tools (worksheet, rubric,
    // flashcards): no `thinking` field. Haiku 4.5 runs straight-through
    // and adding the field is unnecessary.
  });

  const result = coerceResult(parsed, inputs);
  return {
    uid,
    type: inputs.type,
    ...result,
    model: SUGGEST_MODEL,
  };
}

function createSuggestAnswer(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 45, memory: "256MiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "Please sign in.");
      }
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }

      // Validate BEFORE consuming quota — malformed requests should not
      // burn a teacher's monthly suggest_answer credit.
      const inputs = sanitizeInputs(request.data || {});
      const errs = validateInputs(inputs);
      if (errs.length > 0) {
        throw new HttpsError("invalid-argument", errs.join(" "));
      }

      await assertAndIncrement(uid, "suggest_answer");

      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      return runSuggestAnswer({uid, inputs, apiKey});
    },
  );
}

module.exports = {createSuggestAnswer, runSuggestAnswer};
