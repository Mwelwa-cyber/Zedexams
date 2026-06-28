/**
 * generateExamPaper — HTTPS callable Cloud Function ("Exam Studio").
 *
 * Generates fresh practice questions in the authentic ECZ Grade 7 PSLE style,
 * grounded on the verified curriculum module for the selected grade + subject
 * (+ optional topic/sub-topic). Persists to `aiGenerations` with
 * `tool: 'exam_paper'`.
 *
 * Distinct from:
 *   - generateQuiz       — a short (≤25 item) formative quiz.
 *   - structureScannedQuiz — TRANSCRIBES an existing scanned paper (answers
 *     left blank). This generator INVENTS new items and always fills the key.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");

const {resolveCbcContext} = require("./cbcKnowledge");
const {validateExamPaper} = require("./examPaperSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./examPaperPrompt");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {sourceExamPaperFromBank} = require("./masterBankSourcing");
const {buildAvoidNote} = require("./masterBankSourcingCore");

const EXAM_PAPER_MODEL = process.env.EXAM_PAPER_MODEL || "claude-sonnet-4-6";

// Permissive tool shape — the prompt describes the schema in full and the
// post-call validateExamPaper() does the strict checks. The win is that
// Claude can't wrap output in prose/markdown.
const EXAM_PAPER_TOOL_SCHEMA = {
  type: "object",
  description: "A set of ECZ Grade 7-style multiple-choice exam questions.",
  additionalProperties: true,
  properties: {
    header: {type: "object", additionalProperties: true},
    questions: {type: "array", items: {type: "object"}},
  },
};

const ALLOWED_GRADES = new Set([
  "ECE", "ECE_N", "ECE_R", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
]);
const ALLOWED_SUBJECTS = new Set([
  "mathematics", "english", "integrated_science", "social_studies",
  "literacy", "numeracy", "cinyanja", "zambian_language",
  "creative_and_technology_studies",
  "physical_education", "religious_education", "civic_education",
  "biology", "chemistry", "physics", "geography", "history",
  "environmental_science", "technology_studies", "home_economics",
  "expressive_arts",
]);
const ALLOWED_DIFFICULTY = new Set(["mixed", "easy", "medium", "hard"]);
const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const difficulty = str(raw.difficulty || "mixed", 10).toLowerCase();
  const language = str(raw.language || "english", 20).toLowerCase();

  return {
    grade,
    subject,
    topic: str(raw.topic, 160),
    subtopic: str(raw.subtopic, 200),
    count: Math.min(60, Math.max(5, Math.round(num(raw.count, 40)))),
    optionCount: Math.min(5, Math.max(3, Math.round(num(raw.optionCount, 4)))),
    difficulty: ALLOWED_DIFFICULTY.has(difficulty) ? difficulty : "mixed",
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    instructions: str(raw.instructions, 500),
    // Smart sourcing is on by default; a client can opt out ("fresh
    // questions only") by sending useQuestionBank: false.
    useQuestionBank: raw.useQuestionBank !== false,
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.grade || !ALLOWED_GRADES.has(inputs.grade)) {
    errs.push("Please select a valid grade.");
  }
  if (!inputs.subject || !ALLOWED_SUBJECTS.has(inputs.subject)) {
    errs.push("Please select a supported subject.");
  }
  return errs;
}

async function runExamPaper({uid, rawInputs, apiKey}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  const [{contextBlock, kbMatch, kbWarning, kbVersion}, usage] =
    await Promise.all([
      resolveCbcContext({
        grade: inputs.grade,
        subject: inputs.subject,
        topic: inputs.topic,
        subtopic: inputs.subtopic,
        ownerUid: uid,
      }),
      assertAndIncrement(uid, "exam_paper"),
    ]);

  const genRef = admin.firestore().collection("aiGenerations").doc();
  await genRef.set({
    ownerUid: uid,
    tool: "exam_paper",
    inputs,
    output: null,
    outputText: "",
    modelUsed: EXAM_PAPER_MODEL,
    promptVersion: PROMPT_VERSION,
    kbVersion,
    tokensIn: 0,
    tokensOut: 0,
    costUsdCents: 0,
    status: "generating",
    errorMessage: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: null,
    teacherEdited: false,
    exportedFormats: [],
    visibility: "private",
  });

  // Smart Paper Generation — reuse approved MCQs from the Master Bank first,
  // then ask the AI for only the remainder. Best-effort: an empty/unmatched
  // bank sources nothing and the flow is identical to before.
  let sourced = {questions: [], fromBank: 0, scanned: 0};
  if (inputs.useQuestionBank) {
    sourced = await sourceExamPaperFromBank({
      grade: inputs.grade,
      subject: inputs.subject,
      topic: inputs.topic,
      count: inputs.count,
      optionCount: inputs.optionCount,
    });
  }
  const gap = Math.max(0, inputs.count - sourced.questions.length);

  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = EXAM_PAPER_MODEL;
  let aiCalled = false;

  // Only call the model when the bank didn't fully cover the paper.
  if (gap > 0) {
    aiCalled = true;
    const userPrompt = buildUserPrompt({...inputs, count: gap}) +
      buildAvoidNote(sourced.questions);
    try {
      const response = await callClaude(apiKey, {
        systemPrompt: SYSTEM_PROMPT,
        cbcContextBlock: contextBlock,
        messages: [{role: "user", content: userPrompt}],
        // Up to 60 items with options + explanations needs generous headroom.
        maxTokens: 8000,
        temperature: 0.6,
        model: EXAM_PAPER_MODEL,
        mode: "tool",
        toolName: "emit_exam_paper",
        toolDescription:
          "Emit the complete set of exam questions as a single structured " +
          "object. Do not include any prose or commentary outside this call.",
        toolInputSchema: EXAM_PAPER_TOOL_SCHEMA,
      });
      parsed = response.parsed;
      raw = response.text || "";
      usageInfo = response.usage || usageInfo;
      modelUsed = response.model || modelUsed;
    } catch (err) {
      await genRef.update({
        status: "failed",
        errorMessage: String(err && err.message || err).slice(0, 500),
      });
      // The AI call failed with a hard throw — no usable paper was returned to
      // the teacher. Refund the credit or roll back the counter so a K25 top-up
      // credit (or free-plan taster) is not permanently lost on a transient error.
      // This must not throw over the original error — it is strictly best-effort.
      try { await refundGeneration(uid, usage, "exam_paper"); } catch (_) {}
      throw err;
    }
  } else {
    modelUsed = "master_bank";
  }

  // Merge: Master Bank questions first, then any AI-generated ones.
  const generatedQuestions = parsed && Array.isArray(parsed.questions) ?
    parsed.questions : [];
  const parsedHeader = (parsed && parsed.header) || {};
  const mergedInput = {
    header: {
      title: parsedHeader.title || `${inputs.subject} practice exam`,
      grade: parsedHeader.grade || inputs.grade,
      subject: parsedHeader.subject || inputs.subject,
      topic: parsedHeader.topic || inputs.topic,
      subtopic: parsedHeader.subtopic || inputs.subtopic,
      optionCount: inputs.optionCount,
      instructions: parsedHeader.instructions,
    },
    questions: [...sourced.questions, ...generatedQuestions],
    answerKey: (parsed && parsed.answerKey) || {},
  };

  const validation = validateExamPaper(mergedInput, {optionCount: inputs.optionCount});
  const examPaper = validation.value;
  const sourcing = {
    fromBank: sourced.fromBank,
    generated: examPaper.questions.length - sourced.fromBank,
    scanned: sourced.scanned,
    aiCalled,
  };

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  const costUsdCents = Math.round(
      ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
  );

  if (!validation.ok) {
    await genRef.update({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: examPaper,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn,
      tokensOut,
      costUsdCents,
      modelUsed,
      sourcing,
    });
    return {
      generationId: genRef.id,
      examPaper,
      usage,
      warning: [
        "Some questions need review (an answer or option count looked off).",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
      sourcing,
    };
  }

  await genRef.update({
    status: "complete",
    output: examPaper,
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    sourcing,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    generationId: genRef.id,
    examPaper,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
    sourcing,
  };
}

function createGenerateExamPaper(anthropicApiKeySecret) {
  return onCall(
      {secrets: [anthropicApiKeySecret], timeoutSeconds: 180,
        memory: "512MiB"},
      async (request) => {
        const uid = request.auth && request.auth.uid;
        if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Teacher tools are available to approved teachers only.",
          );
        }
        const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
        return runExamPaper({uid, rawInputs: request.data, apiKey});
      },
  );
}

module.exports = {createGenerateExamPaper, runExamPaper, sanitizeInputs};
