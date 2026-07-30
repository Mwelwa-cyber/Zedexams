/**
 * generateWorksheet — HTTPS callable Cloud Function.
 *
 * Usage from client:
 *   const fn = httpsCallable(functions, 'generateWorksheet');
 *   const result = await fn({
 *     grade: 'G5', subject: 'mathematics', topic: 'Fractions',
 *     count: 10, difficulty: 'mixed', durationMinutes: 30,
 *     language: 'english', includeAnswerKey: true, instructions: ''
 *   });
 *   // result.data -> { generationId, worksheet, usage, warning?, kbGrounded }
 *
 * Architectural mirror of generateLessonPlan — same flow, different
 * prompt/schema. Routes to Haiku by default since worksheets are smaller
 * than lesson plans and don't benefit from Sonnet's deeper reasoning.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");
const {assertGeneratorRateLimit} = require("./generatorRateLimit");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");

const {resolveCbcContext} = require("./cbcKnowledge");
const {validateWorksheet} = require("./worksheetSchema");
const {PROMPT_VERSION, pickSystemPrompt, buildUserPrompt} =
  require("./worksheetPrompt");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {requireAndReserveAiOperation, completeAiOperation, failAiOperation} =
  require("../aiOperations");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");

// Worksheet-specific model. Haiku is ~5× cheaper and plenty capable for
// structured Q&A generation. Teacher can override via an admin toggle later.
const WORKSHEET_MODEL = process.env.WORKSHEET_MODEL || "claude-haiku-4-5";

// Permissive top-level shape — validateWorksheet() does strict checking
// post-call, so the schema's job is just to anchor Claude to a structured
// tool response (no markdown fences, no prose wrapping).
const WORKSHEET_TOOL_SCHEMA = {
  type: "object",
  description: "A complete CBC worksheet matching the v1 schema.",
  additionalProperties: true,
  properties: {
    schemaVersion: {type: "string"},
    header: {
      type: "object",
      additionalProperties: true,
      properties: {
        title: {type: "string"},
        grade: {type: "string"},
        subject: {type: "string"},
        topic: {type: "string"},
        subtopic: {type: "string"},
        duration: {type: "string"},
        instructions: {type: "string"},
        totalMarks: {type: "number"},
      },
      required: ["title", "grade", "subject", "topic"],
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          title: {type: "string"},
          instructions: {type: "string"},
          passageTitle: {type: "string"},
          passage: {type: "string"},
          layout: {type: "string", enum: ["standard", "grid"]},
          columns: {type: "number"},
          questions: {
            type: "array",
            items: {type: "object", additionalProperties: true},
          },
        },
      },
    },
    // answerKey is a single object — the prompt and validator both treat it as
    // { markingNotes, totalMarks }. (It was previously declared as an array,
    // which steered Claude toward the wrong shape and silently dropped the
    // marking guidance whenever the model obeyed the schema over the prose.)
    answerKey: {
      type: "object",
      properties: {
        markingNotes: {type: "string"},
        totalMarks: {type: "number"},
      },
      additionalProperties: true,
    },
  },
  required: ["header", "sections"],
};

// Output scales with question count. 4000 was massive overkill for a 5-question
// worksheet (most fit in ~1500 tokens) and generation time scales with output,
// so a tighter ceiling drops wall-clock for short worksheets without truncating
// long ones. Tunable formula: ~220 tokens per question with answer keys, ~140
// without, plus a fixed header. Capped at 5000 for the 25-question + answer
// key case.
function worksheetMaxTokens({count, includeAnswerKey}) {
  const perQuestion = includeAnswerKey ? 220 : 140;
  const scaled = 500 + Math.round(Number(count || 10) * perQuestion);
  return Math.min(5000, Math.max(1200, scaled));
}

const ALLOWED_GRADES = new Set([
  "ECE", "ECE_N", "ECE_R", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
  "F1", "F2", "F3", "F4",
]);
// Mirrors the frontend TEACHER_SUBJECTS list in src/utils/teacherTools.js.
const ALLOWED_SUBJECTS = new Set([
  "mathematics", "numeracy", "english", "literacy",
  "cinyanja", "zambian_language",
  "integrated_science", "environmental_science",
  "biology", "chemistry", "physics",
  "social_studies", "history", "geography", "civic_education",
  "religious_education",
  "technology_studies", "creative_and_technology_studies",
  "home_economics", "expressive_arts", "physical_education",
  // Senior/vocational subjects the syllabi expose (Forms 1-4) — accepted so the
  // standardized curriculum selector never dead-ends on a real syllabus subject.
  "fashion_fabrics", "food_nutrition", "hospitality_management",
  "travel_tourism", "literature_in_english",
  // The 2013 senior RE split: two separately examined ECZ syllabi.
  "religious_education_2044", "religious_education_2046",
  // 2013-framework subjects exposed by curriculum-data-2013.json
  // (Agricultural Science / Art & Design / Home Management, Grades 10-12).
  "agricultural_science", "art_and_design", "home_management",
  // CBC 2023 Forms 1-4 subjects the Syllabus Studio exposes as their own
  // canonical keys (Art & Design is shared with the 2013 line above).
  "commerce_and_principles_of_accounts", "design_and_technology_studies",
  "music_and_creative_arts",
  // ── The 2026-07 subject split ──────────────────────────────────────────
  // Canonical keys carved out of shared ones, each its own examinable subject
  // with its own numbering (see src/utils/subjectSplitClassifier.js). The
  // pre-split spellings above are kept so a saved pick still passes.
  "commerce", "principles_of_accounts",
  "food_and_nutrition", "fashion_and_fabrics", "mathematics_ii",
]);
const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);
const ALLOWED_DIFFICULTIES = new Set(["easy", "medium", "hard", "mixed"]);
// Teacher-facing worksheet style. "auto" lets the model pick a layout from the
// topic; the rest force a specific layout (see worksheetPrompt styleDirective).
const ALLOWED_STYLES = new Set([
  "auto", "standard", "grid", "comprehension", "working",
  "matching", "word_problems", "true_false",
]);
// Reading-passage length for comprehension worksheets; "" = let the model choose.
const ALLOWED_PASSAGE_LENGTHS = new Set(["", "short", "medium", "long"]);
const LE_VALUES = new Set(LEARNING_ENVIRONMENT_VALUES);

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();
  const difficulty = str(raw.difficulty || "mixed", 10).toLowerCase();
  const style = str(raw.style || "auto", 20).toLowerCase();
  const passageLength = str(raw.passageLength, 10).toLowerCase();
  // Grid column override; 0 (or out of range) means "let the model choose".
  const gridColumns = Math.round(num(raw.gridColumns, 0));

  // Optional curriculum-module selectors. Absent/0 → null so behaviour is
  // unchanged from before this upgrade when they aren't supplied.
  const term = Math.round(num(raw.term, 0));
  const lessonNumber = Math.round(num(raw.lessonNumber, 0));
  const totalLessons = Math.round(num(raw.totalLessons, 0));
  const learningEnvironment = str(raw.learningEnvironment, 40)
    .toLowerCase().replace(/[^a-z_]/g, "_");

  return {
    grade,
    subject,
    topic: str(raw.topic, 120),
    subtopic: str(raw.subtopic, 160),
    term: term >= 1 && term <= 3 ? term : null,
    lessonNumber: lessonNumber >= 1 ? lessonNumber : null,
    totalLessons: totalLessons >= 1 ? totalLessons : null,
    learningEnvironment: LE_VALUES.has(learningEnvironment) ?
      learningEnvironment : "",
    count: Math.min(25, Math.max(3, Math.round(num(raw.count, 10)))),
    difficulty: ALLOWED_DIFFICULTIES.has(difficulty) ? difficulty : "mixed",
    style: ALLOWED_STYLES.has(style) ? style : "auto",
    gridColumns: gridColumns >= 2 && gridColumns <= 4 ? gridColumns : 0,
    passageLength: ALLOWED_PASSAGE_LENGTHS.has(passageLength) ? passageLength : "",
    durationMinutes: Math.min(120, Math.max(10, Math.round(num(raw.durationMinutes, 30)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    includeAnswerKey: raw.includeAnswerKey !== false,
    instructions: str(raw.instructions, 500),
    // Optional link back to the lesson plan this worksheet was created from
    // (Lesson Plan → Worksheet inheritance). Persisted in `inputs` so the
    // library can detect an existing linked worksheet + show a back-reference —
    // mirrors the notes `inputs.lessonPlanId` convention. '' when standalone.
    sourceLessonPlanId: str(raw.sourceLessonPlanId, 60),
    // Explicit curriculum chosen by the teacher — drives CBC vs Previous
    // prompt/terminology + framework-aware KB grounding.
    framework: String(raw.framework) === "2013" ? "2013" : "2023",
    curriculum: String(raw.curriculum || "").toLowerCase() === "previous" ?
      "previous" : "cbc",
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.grade || !ALLOWED_GRADES.has(inputs.grade)) {
    errs.push("Please select a grade from ECE–G12.");
  }
  if (!inputs.subject || !ALLOWED_SUBJECTS.has(inputs.subject)) {
    errs.push("Please select a supported subject.");
  }
  if (!inputs.topic) {
    errs.push("Please enter a topic.");
  }
  return errs;
}

/**
 * Reconstruct the client-facing response for an idempotency key that already
 * completed (§7 — a duplicate/retried request must return the existing result,
 * never call the provider again). Reads the persisted aiGenerations doc rather
 * than re-deriving anything. Mirrors generateHomework's resume path.
 */
async function buildResumedWorksheetResponse(operation) {
  const genId = operation.resultDocumentId;
  const genSnap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const genData = genSnap && genSnap.exists ? genSnap.data() : null;
  return {
    generationId: genId,
    worksheet: genData ? genData.output : null,
    usage: null,
    warning: genData && genData.status === "flagged" ?
      "Some fields were incomplete — please review carefully." : null,
    kbGrounded: Boolean(genData && genData.kbVersion),
    resumed: true,
  };
}

/**
 * Core worksheet generation. Used by both `createGenerateWorksheet` and
 * the SSE-streaming HTTP endpoint. See generateLessonPlan.js for the
 * onProgress contract.
 */
async function runWorksheet({uid, rawInputs, apiKey, onProgress, idempotencyKey}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  // Idempotency reservation (§6/§7/§8), UNCONDITIONAL. A request without a
  // valid key is refused here — before the usage meter, before the provider,
  // before any result document exists.
  //
  // This used to sit behind `isValidIdempotencyKey`, which made the protection
  // a client courtesy: a caller that omitted the key silently got the old
  // unprotected path with a random doc id, and nothing recorded that it had.
  // Both doors into this runner now carry a key — the callable takes it from
  // the request payload, the SSE endpoint from the request body.
  //
  // `inputs` is the canonical fingerprint (every teacher-changeable field is
  // already in there), so replaying one key with different inputs is rejected
  // rather than quietly answered with the first result.
  const reservation = await requireAndReserveAiOperation({
    idempotencyKey,
    userId: uid,
    operationType: "generate_worksheet",
    inputFingerprint: inputs,
  });
  if (reservation.status === "completed") {
    return buildResumedWorksheetResponse(reservation.operation);
  }
  if (reservation.status === "processing") {
    return {status: "processing", operationId: idempotencyKey};
  }
  // "created" or "retrying" — exactly one provider call happens below.
  // "failed" and "cancelled" already threw inside the helper.

  const [{contextBlock, kbMatch, kbWarning, kbVersion}, usage] = await Promise.all([
    resolveCbcContext({
      grade: inputs.grade,
      subject: inputs.subject,
      topic: inputs.topic,
      subtopic: inputs.subtopic,
      term: inputs.term,
      lessonNumber: inputs.lessonNumber,
      totalLessons: inputs.totalLessons,
      learningEnvironment: inputs.learningEnvironment,
      framework: inputs.framework,
      ownerUid: uid,
    }),
    assertAndIncrement(uid, "worksheet"),
  ]);

  if (onProgress) onProgress({phase: "queued"});

  // Deterministic doc id (= the idempotency key), always. A retry of the SAME
  // logical request re-set()s this exact doc instead of creating a sibling, and
  // the resumed-completed path reads it straight back by id. The auto-id branch
  // that used to sit here is deleted rather than bypassed: a reservation that
  // settles onto an auto-id document cannot be resumed, because the retry
  // carries the key but has no way back to what the first attempt wrote.
  const genRef = admin.firestore().collection("aiGenerations").doc(idempotencyKey);
  const reservePromise = genRef.set({
    ownerUid: uid,
    tool: "worksheet",
    inputs,
    output: null,
    outputText: "",
    modelUsed: WORKSHEET_MODEL,
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
  }).catch((err) => {
    console.warn("Failed to reserve generation doc", err);
  });

  if (onProgress) onProgress({phase: "claude_started"});

  const userPrompt = buildUserPrompt(inputs);
  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = WORKSHEET_MODEL;

  try {
    const baseClaudeArgs = {
      track: {uid, tool: "worksheet"},
      systemPrompt: pickSystemPrompt(inputs),
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: worksheetMaxTokens({
        count: inputs.count,
        includeAnswerKey: inputs.includeAnswerKey,
      }),
      temperature: 0.4,
      model: WORKSHEET_MODEL,
      toolName: "emit_worksheet",
      toolDescription:
        "Emit the complete worksheet as a single structured object. " +
        "Do not include any prose or commentary outside this tool call.",
      toolInputSchema: WORKSHEET_TOOL_SCHEMA,
    };

    const claudePromise = onProgress ?
      callClaude(apiKey, {
        ...baseClaudeArgs,
        mode: "stream",
        onToken: makeTokenCounter(onProgress),
      }) :
      callClaude(apiKey, {...baseClaudeArgs, mode: "tool"});

    const [response] = await Promise.all([claudePromise, reservePromise]);
    parsed = response.parsed;
    raw = response.text || "";
    usageInfo = response.usage || usageInfo;
    modelUsed = response.model || modelUsed;
  } catch (err) {
    await reservePromise;
    await genRef.set({
      status: "failed",
      errorMessage: String(err && err.message || err).slice(0, 500),
    }, {merge: true}).catch(() => {});
    // Hard throw from the AI call — no usable worksheet was returned. Refund the
    // credit / roll back the counter so the teacher is not charged for a
    // transient failure (AI-006). Best-effort: must not mask the original error.
    try {
      await refundGeneration(uid, usage, "worksheet");
    } catch (refundErr) {
      console.error("[generateWorksheet] refund failed after generation error",
          {uid, generationId: genRef.id, usage}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      console.error("[generateWorksheet] failAiOperation failed after generation error",
          {uid, generationId: genRef.id}, opErr);
    }
    throw err;
  }

  if (onProgress) onProgress({phase: "claude_done"});

  const validation = validateWorksheet(parsed);
  const worksheet = validation.value;
  // The notation ladder (Phase 5): repair computer-style maths into the
  // contract markup the worksheet renderers now draw as stacked fractions and
  // column sums (toolNotationRender), then floor anything still broken to
  // clean plain text. String work only — no model calls, no extra charge.
  try {
    const {enforceNotation, applyPlainTextFloor, WORKSHEET_FIELDS} =
      require("./notationEnforcement");
    const notationOpts = {subject: inputs.subject, fields: WORKSHEET_FIELDS};
    const notationReport = await enforceNotation(worksheet, notationOpts);
    if (notationReport.applied) {
      const {flattened} = await applyPlainTextFloor(worksheet, notationOpts);
      if (notationReport.repaired || flattened) {
        console.info("[generateWorksheet] notation:", {
          repaired: notationReport.repaired, flattened,
          violations: notationReport.violations.length,
        });
      }
    }
  } catch (err) {
    console.error("[generateWorksheet] notation enforcement failed", err);
  }
  if (!validation.ok) {
    await genRef.set({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: worksheet,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn: Number(usageInfo.inputTokens || 0),
      tokensOut: Number(usageInfo.outputTokens || 0),
      modelUsed,
    }, {merge: true});
    // A "flagged" worksheet is still a real result the teacher already got and
    // was billed for — a completion for idempotency purposes, not a failure.
    try {
      await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
    } catch (opErr) {
      console.error("[generateWorksheet] completeAiOperation failed (flagged)",
          {uid, generationId: genRef.id}, opErr);
    }
    return {
      generationId: genRef.id,
      worksheet,
      usage,
      warning: [
        "Some fields were incomplete — please review carefully.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
    };
  }

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  // Haiku 4.5 approx pricing: $1/M input, $5/M output (~5× cheaper than Sonnet).
  const costUsdCents = Math.round(
    ((tokensIn / 1e6) * 100) + ((tokensOut / 1e6) * 500),
  );
  await genRef.set({
    status: "complete",
    output: worksheet,
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  try {
    await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
  } catch (opErr) {
    console.error("[generateWorksheet] completeAiOperation failed",
        {uid, generationId: genRef.id}, opErr);
  }

  return {
    generationId: genRef.id,
    worksheet,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
  };
}

function makeTokenCounter(onProgress) {
  let approxOutputTokens = 0;
  let lastReported = 0;
  return (chunk) => {
    approxOutputTokens += Math.max(1, Math.round((chunk || "").length / 4));
    if (approxOutputTokens - lastReported >= 50) {
      lastReported = approxOutputTokens;
      try {
        onProgress({phase: "token", approxOutputTokens});
      } catch (err) {
        console.warn("onProgress threw", err);
      }
    }
  };
}

function createGenerateWorksheet(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 120, memory: "512MiB"},
    async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      await assertGeneratorRateLimit(request, "worksheet");
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      const idempotencyKey = request.data && request.data.idempotencyKey;
      return runWorksheet({uid, rawInputs: request.data, apiKey, idempotencyKey});
    },
  );
}

module.exports = {createGenerateWorksheet, runWorksheet};
