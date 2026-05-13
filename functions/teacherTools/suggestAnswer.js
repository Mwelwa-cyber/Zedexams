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
  "matching",
  "sequence",
]);

const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);

function str(v, max) {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function sanitizeInputs(raw = {}) {
  // ALLOWED_TYPES' longest entry is "true_false" (10 chars); 16 is a safe
  // cap that leaves headroom without being silly.
  const type = str(raw.type, 16).toLowerCase();
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

  // Numeric-only fields. Both are optional. `unit` is a short label
  // ("kg", "m/s") that we forward to the model so it returns a value in
  // the right physical quantity. `tolerance` is informational — the model
  // returns a single point estimate; the studio handles the ± range.
  const unit = str(raw.unit, 12);
  const toleranceRaw = Number(raw.tolerance);
  const tolerance = Number.isFinite(toleranceRaw) && toleranceRaw >= 0 ? toleranceRaw : 0;

  // Matching-only fields. Two parallel arrays of short strings (≤ 10 each).
  // We keep blanks in place so the indices match what the studio stores,
  // but the prompt renderer filters them out before sending to Claude.
  const rawLeft = Array.isArray(raw.matchingLeft) ? raw.matchingLeft : [];
  const matchingLeft = rawLeft
    .slice(0, 10)
    .map((v) => str(v, 200));
  const rawRight = Array.isArray(raw.matchingRight) ? raw.matchingRight : [];
  const matchingRight = rawRight
    .slice(0, 10)
    .map((v) => str(v, 200));

  // Sequence items — one column the student reorders. Same length cap +
  // blank-preserving policy as matching.
  const rawItems = Array.isArray(raw.sequenceItems) ? raw.sequenceItems : [];
  const sequenceItems = rawItems
    .slice(0, 10)
    .map((v) => str(v, 200));

  return {
    type: ALLOWED_TYPES.has(type) ? type : "short_answer",
    text,
    grade,
    subject,
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    options,
    nonEmptyOptionCount,
    wordBank,
    unit,
    tolerance,
    matchingLeft,
    matchingRight,
    sequenceItems,
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.text) errs.push("Question text is required.");
  if (inputs.type === "mcq" && inputs.nonEmptyOptionCount < 2) {
    errs.push("MCQs need at least two filled-in options.");
  }
  if (inputs.type === "matching") {
    const leftFilled = inputs.matchingLeft.filter((s) => s.length > 0).length;
    const rightFilled = inputs.matchingRight.filter((s) => s.length > 0).length;
    if (leftFilled < 2 || rightFilled < 2) {
      errs.push(
        "Matching needs at least two filled-in items on each side before " +
        "AI can suggest answers.",
      );
    }
  }
  if (inputs.type === "sequence") {
    const filled = inputs.sequenceItems.filter((s) => s.length > 0).length;
    if (filled < 2) {
      errs.push(
        "Sequence needs at least two filled-in items before AI can " +
        "suggest the order.",
      );
    }
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
  "- For matching, return an array of 0-based integers — one per left-column",
  "  row — pointing at the right-column entry that pairs with each left item.",
  "  The array length MUST equal the number of left-column items shown.",
  "- For sequence, return an array of 1-based positions — one per item in",
  "  the displayed order. position[i] is where item[i] should land in the",
  "  correct sequence (1 = first, N = last). The array MUST be a permutation",
  "  of 1..N (every position used exactly once).",
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

  // Sequence guidance — show items in their display order with their
  // index and ask the model for a permutation of 1..N giving each item's
  // correct position. We're explicit about the permutation invariant so
  // the model doesn't reuse positions.
  if (inputs.type === "sequence") {
    const items = inputs.sequenceItems;
    lines.push("");
    lines.push("Items (in display order — return one position per item):");
    items.forEach((item, i) => {
      lines.push(`  [${i + 1}] ${item || "(blank)"}`);
    });
    lines.push("");
    lines.push(
      `Return an array of exactly ${items.length} integers, each between 1 ` +
      `and ${items.length}. position[i] is the correct 1-based position of ` +
      "the item at display index i. The array MUST be a permutation of " +
      `1..${items.length} (every position used exactly once).`,
    );
  }

  // Matching guidance — render the two columns side-by-side using the
  // ORIGINAL indices so blanks stay aligned with the studio's data model.
  // We tell the model exactly how long the answer array must be.
  if (inputs.type === "matching") {
    lines.push("");
    lines.push("Left column (return one right-column index per row, in order):");
    inputs.matchingLeft.forEach((item, i) => {
      lines.push(`  [${i}] ${item || "(blank)"}`);
    });
    lines.push("");
    lines.push("Right column (use these 0-based indices):");
    inputs.matchingRight.forEach((item, i) => {
      lines.push(`  [${i}] ${item || "(blank)"}`);
    });
    lines.push("");
    lines.push(
      `Return an array of exactly ${inputs.matchingLeft.length} integers — ` +
      "one for each left-column row above, in the order shown. Each integer " +
      "is the right-column index that correctly pairs with that left item.",
    );
  }

  // Numeric guidance — only relevant when the teacher tagged this as a
  // numeric question. We tell the model the expected unit so it returns a
  // value compatible with what the studio will render on the paper.
  // Tolerance is included for context only; the model still returns a
  // single point estimate.
  if (inputs.type === "numeric") {
    lines.push("");
    if (inputs.unit) {
      lines.push(`Expected unit: ${inputs.unit}`);
    }
    if (inputs.tolerance > 0) {
      lines.push(`Acceptable tolerance: ±${inputs.tolerance}`);
    }
    lines.push(
      "Return JUST the numeric value (no unit, no formula, no commas) — " +
      "the studio appends the unit when printing the paper.",
    );
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
    // Allowed shapes:
    //   - MCQ                      : integer 0..5
    //   - numeric / short_answer   : integer or string
    //   - matching                 : array of integers, one per left-column
    //                                row, each = the chosen right-column index.
    answer: {
      oneOf: [
        {type: "integer", minimum: 0, maximum: 9},
        {type: "string", maxLength: 800},
        {type: "array", items: {type: "integer", minimum: 0, maximum: 9}, maxItems: 10},
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

  if (inputs.type === "matching") {
    const raw = parsed && parsed.answer;
    const leftLen = inputs.matchingLeft.length;
    const rightLen = inputs.matchingRight.length;
    if (!Array.isArray(raw)) {
      // Wrong shape — return all -1 with low confidence so the client
      // shows the badge as a warning.
      return {
        answer: Array(leftLen).fill(-1),
        rationale,
        confidence: "low",
      };
    }
    // Coerce + pad/truncate to leftLen. Each entry must be an integer
    // 0..rightLen-1; otherwise we mark it as -1 (no match).
    const coerced = Array.from({length: leftLen}, (_, i) => {
      const v = Number(raw[i]);
      if (!Number.isInteger(v) || v < 0 || v >= rightLen) return -1;
      return v;
    });
    const anyMissing = coerced.some((v) => v < 0);
    return {
      answer: coerced,
      rationale,
      confidence: anyMissing ? "low" : confidence,
    };
  }

  if (inputs.type === "sequence") {
    const raw = parsed && parsed.answer;
    const n = inputs.sequenceItems.length;
    if (!Array.isArray(raw)) {
      return {
        answer: Array(n).fill(0),
        rationale,
        confidence: "low",
      };
    }
    // Each position must be a 1-based integer in [1..n] and the array
    // must be a permutation (every position used exactly once). If any
    // entry is invalid or duplicated, we replace it with 0 and downgrade
    // confidence — the studio will show the badge as a warning.
    const used = new Set();
    const coerced = Array.from({length: n}, (_, i) => {
      const v = Number(raw[i]);
      if (!Number.isInteger(v) || v < 1 || v > n) return 0;
      if (used.has(v)) return 0;
      used.add(v);
      return v;
    });
    const anyZero = coerced.some((v) => v === 0);
    return {
      answer: coerced,
      rationale,
      confidence: anyZero ? "low" : confidence,
    };
  }

  // Free-form text answer. Note: the tool schema allows `answer` to be
  // either a string OR an integer, because Claude often returns numeric
  // answers as actual numbers for arithmetic prompts (e.g. {answer: 56}
  // for "What is 7 x 8?"). We coerce numbers to their string form here
  // so the studio can write them into `correctAnswer` unchanged. If we
  // didn't, str() would return "" for numeric inputs and we'd silently
  // wipe whatever the teacher already had in the answer field.
  const raw = parsed && parsed.answer;
  let answer = "";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    answer = String(raw).slice(0, 800);
  } else {
    answer = str(raw, 800);
  }
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
