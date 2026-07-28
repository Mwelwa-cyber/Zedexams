/**
 * The one lesson-plan generation. Three doors, one room.
 *
 * ## Why this exists
 *
 * ZedExams had TWO lesson-plan generators. `generateLessonPlan` (schema-based,
 * CBC-grounded, validated) and `studioGenerateLessonPlan` (client-prompted,
 * studio-shaped) were separate pipelines: two reservations, two quota charges,
 * two auto-ID generation records, two provider calls, two failure paths, two
 * things to keep correct. They are not two products. They are one user
 * intention — "create a lesson plan" — that grew a second implementation.
 *
 * So they become adapters. `generateLessonPlan` (legacy callable),
 * `apiGenerateLessonPlan` (legacy SSE) and `studioGenerateLessonPlan` all reach
 * this function, and all three declare `operationType: "generate_lesson_plan"`.
 * That matters more than tidiness: a shared operation type means one
 * idempotency namespace, so the same logical request cannot be reserved twice
 * because it arrived through a different door.
 *
 * `entryPoint` is recorded for telemetry — which surface a plan came from is
 * worth knowing, and is needed to decide when the legacy doors can close. It
 * is NOT part of the fingerprint, deliberately: including it would give each
 * door its own namespace and undo the consolidation.
 *
 * ## What each parent contributed
 *
 * From `generateLessonPlan`: server-owned sanitisation and validation, CBC
 * knowledge grounding, structured output, deterministic identity, settlement.
 * Its auto-ID document and charge-before-reserve ordering did not survive.
 *
 * From `studioLessonPlan`: the studio experience — both curricula, layout
 * preferences, Scheme of Work and Weekly Forecast grounding, lesson-series
 * context, resource level, teacher preferences. Its client-supplied prompts and
 * second generation record did not survive.
 */

const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");

const {callClaude, DEFAULT_MODEL} = require("../anthropicClient");
const {resolveCbcContext} = require("../cbcKnowledge");
const {resolveTeacherPlanContext} = require("../teacherPlanContext");
const {assertAndIncrement, refundGeneration} = require("../usageMeter");
const {
  requireAndReserveAiOperation, completeAiOperation, failAiOperation,
} = require("../../aiOperations");

const {sanitizeLessonPlanRequest, assertValidLessonPlanRequest} = require("./lessonPlanRequest");
const {buildLessonPlanUserPrompt} = require("./buildLessonPlanUserPrompt");
const {
  STUDIO_SYSTEM_PROMPT_CBC, STUDIO_SYSTEM_PROMPT_PREVIOUS,
} = require("./studioSystemPrompts");
const {LESSON_PLAN_TOOL_SCHEMA} = require("./lessonPlanToolSchema");

/** Which surface a request arrived through. Telemetry only — never fingerprint. */
const ENTRY_POINTS = Object.freeze({
  legacyCallable: "legacy-callable",
  legacySse: "legacy-sse",
  studio: "lesson-plan-studio",
});

/** Entry points that should stop being used. Logged so the decision to remove
 * them can rest on traffic rather than on assuming nobody is out there. */
const DEPRECATED_ENTRY_POINTS = Object.freeze([
  ENTRY_POINTS.legacyCallable,
  ENTRY_POINTS.legacySse,
]);

// Mirrors the pinned reasoning controls both parents used. Lesson planning is
// structured template-fill, not multi-step reasoning; with thinking disabled
// the whole budget goes to the plan instead of being spent deliberating and
// truncating the JSON.
const THINKING = {type: "disabled"};
const OUTPUT_CONFIG = {effort: "low"};
const MAX_TOKENS = 8000;

/** The approved system prompt for a curriculum. Server-selected, always. */
function systemPromptFor(curriculumMode) {
  return curriculumMode === "previous" ?
    STUDIO_SYSTEM_PROMPT_PREVIOUS : STUDIO_SYSTEM_PROMPT_CBC;
}

/** Rebuild the caller's response from a completed operation, without the model. */
async function buildResumedLessonPlanResponse(operation) {
  const id = operation && operation.resultDocumentId;
  if (!id) {
    throw new HttpsError("internal", "This generation completed but its result is missing.");
  }
  const snap = await admin.firestore().collection("aiGenerations").doc(id).get();
  const data = snap.exists ? snap.data() : null;
  if (!data) {
    throw new HttpsError("internal", "This generation completed but its result is missing.");
  }
  return {
    generationId: id,
    lessonPlan: data.output || null,
    text: JSON.stringify(data.output || {}),
    usage: data.usage || null,
    kbWarning: data.kbWarning || null,
    kbGrounded: Boolean(data.kbGrounded),
    resumed: true,
  };
}

/**
 * Generate one lesson plan.
 *
 * @param {Object} args
 * @param {string} args.uid              Authenticated caller.
 * @param {string} args.idempotencyKey   Required — a keyless request is refused.
 * @param {Object} args.inputs           Raw typed request; sanitized here.
 * @param {string} args.apiKey
 * @param {Function} [args.onProgress]   SSE progress callback.
 * @param {string} args.entryPoint       One of ENTRY_POINTS.
 */
async function runLessonPlanOperation({
  uid, idempotencyKey, inputs: rawInputs, apiKey, onProgress, entryPoint,
}) {
  const inputs = sanitizeLessonPlanRequest(rawInputs);
  assertValidLessonPlanRequest(inputs);

  if (DEPRECATED_ENTRY_POINTS.includes(entryPoint)) {
    // Not an error — a stale client must keep working. A record of who is still
    // knocking is what turns "remove the legacy door" from a guess into a
    // decision, so this logs on every call rather than sampling.
    console.warn("[lessonPlan] deprecated entry point used", {entryPoint, uid});
  }

  // Reservation FIRST — before the usage meter, before the provider, before any
  // document exists. Both parents charged usage before reserving anything.
  const reservation = await requireAndReserveAiOperation({
    idempotencyKey,
    userId: uid,
    operationType: "generate_lesson_plan",
    // The sanitized request, and nothing else. `entryPoint` is excluded so the
    // same lesson requested from the studio and from a legacy client is ONE
    // operation rather than two.
    inputFingerprint: inputs,
  });
  if (reservation.status === "completed") {
    return buildResumedLessonPlanResponse(reservation.operation);
  }
  if (reservation.status === "processing") {
    return {status: "processing", operationId: idempotencyKey};
  }

  if (onProgress) onProgress({phase: "queued"});

  // Two complementary groundings, both fail-open so a lookup error never blocks
  // a teacher's plan: the CBC knowledge base, and the teacher's OWN saved
  // Scheme of Work / Weekly Forecast for this grade+subject+term+week.
  const [cbcResult, teacherPlansBlock, usage] = await Promise.all([
    resolveCbcContext({
      ownerUid: uid,
      grade: inputs.grade,
      subject: inputs.subject,
      topic: inputs.topic,
      subtopic: inputs.subtopic,
      term: inputs.term,
      lessonNumber: inputs.lessonNumber,
      totalLessons: inputs.totalLessons,
      learningEnvironment: inputs.learningEnvironments[0] || "",
    }).catch((err) => {
      console.warn("[lessonPlan] CBC KB context lookup failed", err);
      return null;
    }),
    resolveTeacherPlanContext({
      ownerUid: uid,
      grade: inputs.grade,
      subject: inputs.subject,
      term: inputs.term,
      week: inputs.week,
      topic: inputs.topic,
      subtopic: inputs.subtopic,
    }).catch((err) => {
      console.warn("[lessonPlan] teacher-plan context lookup failed", err);
      return "";
    }),
    assertAndIncrement(uid, "lesson_plan"),
  ]);

  // KB block first — it is shareable across teachers of the same
  // grade/subject/topic, so the prompt-cache prefix stays stable — with the
  // per-teacher pacing block last.
  const contextBlock = [
    cbcResult && cbcResult.contextBlock,
    teacherPlansBlock,
  ].filter(Boolean).join("\n\n") || null;

  // ONE deterministic record. Both parents wrote auto-ID documents; a
  // reservation that settles onto an auto-ID document cannot resume.
  const genRef = admin.firestore().collection("aiGenerations").doc(idempotencyKey);
  await genRef.set({
    ownerUid: uid,
    tool: "lesson_plan",
    entryPoint,
    inputs,
    status: "generating",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  let response;
  try {
    if (onProgress) onProgress({phase: "claude_started"});
    response = await callClaude(apiKey, {
      track: {uid, tool: "lesson_plan", generationId: genRef.id},
      systemPrompt: systemPromptFor(inputs.curriculumMode),
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: buildLessonPlanUserPrompt(inputs)}],
      maxTokens: MAX_TOKENS,
      temperature: 0.3,
      thinking: THINKING,
      outputConfig: OUTPUT_CONFIG,
      mode: "tool",
      toolName: "emit_lesson_plan",
      toolDescription: "Emit the complete Zambian lesson plan as a single " +
        "structured JSON object, matching the format described in the system " +
        "and user prompts. Do not include any prose or commentary outside " +
        "this tool call.",
      toolInputSchema: LESSON_PLAN_TOOL_SCHEMA,
      onToken: onProgress ? (n) => onProgress({phase: "token", approxOutputTokens: n}) : undefined,
    });
    if (onProgress) onProgress({phase: "claude_done"});
  } catch (err) {
    await genRef.set({
      status: "failed",
      errorMessage: String((err && err.message) || err).slice(0, 500),
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    // The teacher did not get a plan, so the quota unit goes back. Both are
    // best-effort: neither may mask the provider error the caller needs to see.
    try {
      await refundGeneration(uid, usage, "lesson_plan");
    } catch (refundErr) {
      console.error("[lessonPlan] refund failed after generation error",
          {uid, generationId: genRef.id}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      console.error("[lessonPlan] failAiOperation failed after generation error",
          {uid, generationId: genRef.id}, opErr);
    }
    throw err;
  }

  const plan = response && response.parsed && typeof response.parsed === "object" ?
    response.parsed : {};
  const usageInfo = (response && response.usage) || {};

  await genRef.set({
    status: "complete",
    output: plan,
    usage: usageInfo,
    modelUsed: (response && response.model) || DEFAULT_MODEL,
    tokensIn: Number(usageInfo.inputTokens || 0),
    tokensOut: Number(usageInfo.outputTokens || 0),
    kbVersion: (cbcResult && cbcResult.kbVersion) || null,
    kbGrounded: Boolean(cbcResult && cbcResult.kbMatch),
    kbWarning: (cbcResult && cbcResult.kbWarning) || null,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  try {
    await completeAiOperation({
      idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1,
    });
  } catch (opErr) {
    console.error("[lessonPlan] completeAiOperation failed",
        {uid, generationId: genRef.id}, opErr);
  }

  return {
    generationId: genRef.id,
    lessonPlan: plan,
    // The studio parses `text`; keeping it means the consolidation is invisible
    // to the renderer rather than a coordinated client change.
    text: JSON.stringify(plan),
    usage: usageInfo,
    kbWarning: (cbcResult && cbcResult.kbWarning) || null,
    kbGrounded: Boolean(cbcResult && cbcResult.kbMatch),
  };
}

module.exports = {
  ENTRY_POINTS,
  DEPRECATED_ENTRY_POINTS,
  systemPromptFor,
  runLessonPlanOperation,
};
