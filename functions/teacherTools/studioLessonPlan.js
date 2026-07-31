/**
 * studioGenerateLessonPlan — HTTPS callable for the Lesson Plan Studio.
 *
 * Unlike generateLessonPlan (which uses a structured schema + CBC KB lookup),
 * the studio sends its own system prompt and user prompt directly, giving the
 * studio full control over format (modern / classic / classic2).
 *
 * The function:
 *   1. Authenticates + checks teacher role.
 *   2. Grounds the plan on the teacher's OWN saved Scheme of Work / Weekly
 *      Forecast (resolveTeacherPlanContext) when the studio sends lesson
 *      coordinates in `context`.
 *   3. Meters usage under the existing `lesson_plan` tool quota.
 *   4. Calls Claude with forced-tool JSON output (mode: "tool") so the model
 *      can never wrap the plan in prose / markdown fences, and with thinking
 *      disabled + low effort so Sonnet 4.6's default high-effort reasoning
 *      does not eat the token budget and truncate the JSON.
 *   5. Returns { text } — the plan as a clean JSON string (studio parses it).
 *
 * Why mode "tool" + thinking off (the fix for "studio fails to create plans"):
 * Sonnet 4.6 defaults to effort "high" when `outputConfig` is unset, so a
 * plain `mode: "json"` call spent most of its 6144-token budget thinking and
 * truncated the JSON object. The truncated text failed the studio's
 * `JSON.parse`, surfacing as a generic "Something went wrong". Forcing a tool
 * call guarantees a well-formed object, and pinning thinking off + effort low
 * (the same settings the structured generateLessonPlan uses) keeps the whole
 * token budget available for the plan itself. Lesson-plan generation is
 * structured template-fill, not multi-step reasoning, so low effort is the
 * right call here as it is for the schema-based generator.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertCallableRateLimit} = require("../rateLimit");
const {assertVerifiedAuth} = require("../authGuard");
const {getAnthropicApiKey, getUserRole, isStaffRole} = require("../aiService");
const {callClaude, DEFAULT_MODEL} = require("./anthropicClient");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {requireAndReserveAiOperation, completeAiOperation, failAiOperation} =
  require("../aiOperations");
const {resolveTeacherPlanContext} = require("./teacherPlanContext");
const {resolveCbcContext} = require("./cbcKnowledge");

// Pinned reasoning controls — see the file header. Mirrors generateLessonPlan.
const STUDIO_THINKING = {type: "disabled"};
const STUDIO_OUTPUT_CONFIG = {effort: "low"};

// 8000 (was 6144 in the old mode:"json" path): a "Detailed" plan in the modern
// format can be large; with thinking off the full budget goes to the plan, so
// give it room rather than risk a truncated tool call.
const STUDIO_MAX_TOKENS = 8000;

// Permissive top-level shape. Its job is to anchor Claude to an object response
// and force tool use (which eliminates JSON-parse failures) — the studio's own
// renderer does the real shaping. `additionalProperties: true` keeps it
// forward-compatible with both the CBC and Previous-curriculum shapes the
// studio system prompts describe, and with future prompt tweaks. Only the two
// fields common to BOTH curriculum modes are required.
const STUDIO_TOOL_SCHEMA = {
  type: "object",
  description: "A complete Zambian lesson plan as a single JSON object, in " +
    "the structure described by the system and user prompts.",
  additionalProperties: true,
  properties: {
    header: {type: "object", additionalProperties: true},
    generalCompetences: {type: "array", items: {type: "string"}},
    specificCompetence: {type: "string"},
    specificOutcome: {type: "string"},
    lessonGoal: {type: "string"},
    rationale: {type: "string"},
    priorKnowledge: {type: "string"},
    references: {type: "array", items: {type: "string"}},
    learningEnvironment: {type: "object", additionalProperties: true},
    materials: {type: "array", items: {type: "string"}},
    expectedStandard: {type: "string"},
    stages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        // The stage keys MUST match the studio system prompt's documented
        // contract (teacher / pupils / assessment / duration) — the same keys
        // renderPlanHtml reads. The prompt (studioSystemPrompt.js) explicitly
        // instructs the model to use these and FORBIDS the
        // teacherActivities/learnerActivities/assessmentCriteria family. A tool
        // schema that named the forbidden family contradicted the prompt, and
        // under forced tool_choice that contradiction made the model emit a
        // degenerate, near-empty tool call — every plan rendered as an empty
        // table skeleton. Keeping schema + prompt in lock-step is what makes
        // the model actually fill the plan. (normalizePlanShape on the client
        // still tolerates the array family if a future model drifts.)
        properties: {
          name: {type: "string"},
          duration: {type: "string"},
          teacher: {type: "string"},
          pupils: {type: "string"},
          assessment: {type: "string"},
        },
      },
    },
  },
  required: ["lessonGoal", "stages"],
};

function sanitize(v, max) {
  return typeof v === "string" ? v.replace(/^@/g, "").trim().slice(0, max) : "";
}

/**
 * The studio builds its own prompts, so "valid input" is simply having both.
 * Factored out of the callable so the one check runs on the runner's path too
 * (a keyless/direct invocation is validated before it can reserve or spend).
 */
function validateInputs({systemPrompt, userPrompt}) {
  const errs = [];
  if (!systemPrompt || !userPrompt) {
    errs.push("systemPrompt and userPrompt are required.");
  }
  return errs;
}

/**
 * Reconstruct the client-facing response for an idempotency key that already
 * completed (§7). This generator returns its plan INLINE, so the result is
 * persisted to aiGenerations/{idempotencyKey} purely to make the resume
 * possible — a duplicate/retry returns the same plan without a second call.
 */
async function buildResumedStudioPlanResponse(operation) {
  const genId = operation.resultDocumentId;
  const genSnap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const out = genSnap && genSnap.exists ? (genSnap.data().output || {}) : {};
  return {
    text: out.text || null,
    usage: null,
    kbWarning: out.kbWarning || null,
    resumed: true,
  };
}

/**
 * Core studio lesson-plan generation. Auth + role are checked by the caller;
 * this function takes already-trusted inputs so it can be unit tested without
 * the onCall/firebase-functions plumbing.
 *
 * @param {object} args
 *   uid (required), systemPrompt, userPrompt — studio prompts
 *   context — { grade, subject, term, week, topic, subtopic } lesson coords
 *   apiKey — resolved Anthropic key
 * @returns {Promise<{text: string, usage: object}>}
 */
async function runStudioLessonPlan({uid, systemPrompt, userPrompt, context, apiKey, idempotencyKey}) {
  const inputErrors = validateInputs({systemPrompt, userPrompt});
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  // Idempotency reservation (§6/§7/§8), UNCONDITIONAL, before the usage meter
  // and the provider. The studio's own prompts + lesson coordinates are the
  // fingerprint, so a double-click / refresh / second tab reuses the key while a
  // genuinely different plan gets a fresh one. This studio is the free tier's
  // entry point, which is exactly where a double-charge hurts most.
  const reservation = await requireAndReserveAiOperation({
    idempotencyKey,
    userId: uid,
    operationType: "studio_lesson_plan",
    inputFingerprint: {systemPrompt, userPrompt, context: context || {}},
  });
  if (reservation.status === "completed") {
    return buildResumedStudioPlanResponse(reservation.operation);
  }
  if (reservation.status === "processing") {
    return {status: "processing", operationId: idempotencyKey};
  }

  // Ground the studio plan on two complementary sources, both fail-open so a
  // lookup error never blocks a generation:
  //   1. The server-side CBC knowledge base (resolveCbcContext) — stored
  //      sub-topic curriculum modules, private RAG, editable topic KB, plus
  //      prior-coverage dedup against the teacher's earlier plans. This is the
  //      same authoritative grounding the schema-based generateLessonPlan has
  //      always had; the studio previously relied only on its client-side
  //      syllabus block and missed all of it.
  //   2. The teacher's OWN saved Scheme of Work / Weekly Forecast
  //      (resolveTeacherPlanContext) for this grade+subject+term+week. The
  //      resolver is vocabulary-tolerant (matches on grade digits + normalised
  //      subject + topic overlap), so the studio's "Grade 4" / "Form 1" labels
  //      work without translation.
  const ctx = context || {};
  const grade = typeof ctx.grade === "string" ? ctx.grade.slice(0, 40) : ctx.grade;
  const subject = typeof ctx.subject === "string" ? ctx.subject.slice(0, 80) : ctx.subject;
  const topic = typeof ctx.topic === "string" ? ctx.topic.slice(0, 200) : "";
  const subtopic = typeof ctx.subtopic === "string" ? ctx.subtopic.slice(0, 200) : "";
  const [cbcResult, teacherPlansBlock, usage] = await Promise.all([
    resolveCbcContext({
      ownerUid: uid,
      grade,
      subject,
      topic,
      subtopic,
      term: ctx.term,
      lessonNumber: ctx.lessonNumber,
      totalLessons: ctx.totalLessons,
      framework: ctx.framework,
    }).catch((err) => {
      console.warn("[studioLessonPlan] CBC KB context lookup failed", err);
      return null;
    }),
    resolveTeacherPlanContext({
      ownerUid: uid,
      grade,
      subject,
      term: ctx.term,
      week: ctx.week,
      topic,
      subtopic,
    }).catch((err) => {
      console.warn("[studioLessonPlan] teacher-plan context lookup failed", err);
      return "";
    }),
    // Meter usage — shares the lesson_plan quota with the existing generator.
    assertAndIncrement(uid, "lesson_plan"),
  ]);

  // KB block first (shareable across teachers of the same grade/subject/topic,
  // so the prompt-cache prefix stays stable), the per-teacher pacing block last.
  const contextBlock = [
    cbcResult && cbcResult.contextBlock,
    teacherPlansBlock,
  ].filter(Boolean).join("\n\n");

  // The meter was incremented above, inside the Promise.all, so the quota check
  // fails fast. That means every failure from here on has ALREADY cost the
  // teacher a lesson plan they never received — so each exit path below
  // refunds. This studio is the free tier's entry point.
  let response;
  try {
    response = await callClaude(apiKey, {
      track: {uid, tool: "lesson_plan"},
      systemPrompt,
      cbcContextBlock: contextBlock || null,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: STUDIO_MAX_TOKENS,
      temperature: 0.3,
      thinking: STUDIO_THINKING,
      outputConfig: STUDIO_OUTPUT_CONFIG,
      mode: "tool",
      toolName: "emit_lesson_plan",
      toolDescription: "Emit the complete Zambian lesson plan as a single " +
        "structured JSON object, matching the format described in the system " +
        "and user prompts. Do not include any prose or commentary outside this " +
        "tool call.",
      toolInputSchema: STUDIO_TOOL_SCHEMA,
    });
  } catch (err) {
    // Best-effort: must not mask the original error.
    try {
      await refundGeneration(uid, usage, "lesson_plan");
    } catch (refundErr) {
      console.error("[studioLessonPlan] refund failed after generation error",
          {uid, usage}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      console.error("[studioLessonPlan] failAiOperation failed after generation error",
          {uid}, opErr);
    }
    throw err;
  }

  // mode:"tool" returns the parsed object on `parsed` (callClaudeTool throws on
  // a missing/invalid tool_use block, so we get a well-formed object here).
  const planJson = response && response.parsed &&
    typeof response.parsed === "object" ? response.parsed : null;

  // A degenerate tool call ({} or a non-object) used to fall through to `{}`,
  // render as the empty table skeleton, and report status "done" with the quota
  // spent — the teacher got a blank lesson plan and paid for it. Treat it as
  // the failure it is: refund, then surface a retryable error.
  if (!planJson || Object.keys(planJson).length === 0) {
    const emptyErr = new HttpsError(
        "internal",
        "The lesson plan came back empty. Please try again.",
    );
    try {
      await refundGeneration(uid, usage, "lesson_plan");
    } catch (refundErr) {
      console.error("[studioLessonPlan] refund failed after empty plan",
          {uid, usage}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err: emptyErr, usageCharged: 0});
    } catch (opErr) {
      console.error("[studioLessonPlan] failAiOperation failed after empty plan",
          {uid}, opErr);
    }
    console.error("[studioLessonPlan] model returned an empty plan object",
        {uid, grade, subject, topic, model: response && response.model});
    throw emptyErr;
  }

  // Re-serialise to keep the studio's existing JSON.parse contract.
  const text = JSON.stringify(planJson);
  const kbWarning = (cbcResult && cbcResult.kbWarning) || null;

  // The generation record is now the idempotency result of record, keyed by the
  // operation, so a duplicate/retry resumes THIS plan (`output.text`) rather
  // than paying for a second one. It replaces the old fire-and-forget `.add()`
  // log — same fields, plus the plan itself, at a deterministic id.
  await admin.firestore().collection("aiGenerations").doc(idempotencyKey).set({
    ownerUid: uid,
    tool: "lesson_plan_studio",
    status: "complete",
    output: {text, kbWarning},
    modelUsed: (response && response.model) || DEFAULT_MODEL,
    tokensIn: Number(response && response.usage && response.usage.inputTokens || 0),
    tokensOut: Number(response && response.usage && response.usage.outputTokens || 0),
    kbVersion: (cbcResult && cbcResult.kbVersion) || null,
    kbGrounded: Boolean(cbcResult && cbcResult.kbMatch),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => {
    console.warn("[studioLessonPlan] result doc write failed", err);
  });
  try {
    await completeAiOperation({idempotencyKey, resultDocumentId: idempotencyKey, usageCharged: 1});
  } catch (opErr) {
    console.error("[studioLessonPlan] completeAiOperation failed", {uid}, opErr);
  }

  return {
    text,
    usage: response.usage || usage,
    // Additive: surfaced so the studio can show the same "used general CBC
    // knowledge" notice the schema-based generator shows. Null when grounded.
    kbWarning,
  };
}

function createStudioGenerateLessonPlan(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 120, memory: "512MiB"},
    async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      await assertCallableRateLimit(request, {action: "studioGenerateLessonPlan", userPerMin: 8});

      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }

      const systemPrompt = sanitize(request.data && request.data.systemPrompt, 20000);
      // 9000 (was 4000): the studio now appends Style-control and (for
      // Maths/Science) Diagram-spec blocks to the user prompt on top of the
      // syllabus-topic context, which can push a single-lesson prompt past
      // 4000 chars. A tighter cap silently truncated the trailing
      // "Return JSON only" instruction.
      const userPrompt = sanitize(request.data && request.data.userPrompt, 9000);

      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      const idempotencyKey = request.data && request.data.idempotencyKey;

      // Input validation (systemPrompt/userPrompt required) now runs inside
      // runStudioLessonPlan via validateInputs, so it fires before the
      // reservation on every path into the runner.
      return runStudioLessonPlan({
        uid,
        systemPrompt,
        userPrompt,
        context: (request.data && request.data.context) || {},
        apiKey,
        idempotencyKey,
      });
    },
  );
}

module.exports = {
  createStudioGenerateLessonPlan,
  // Exported for unit tests of the generation core.
  runStudioLessonPlan,
  STUDIO_TOOL_SCHEMA,
};
