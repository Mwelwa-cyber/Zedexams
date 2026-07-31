/**
 * Plain-node tests for studioLessonPlan.js — the Lesson Plan Studio generation
 * core (runStudioLessonPlan).
 *
 * Two concerns in one file:
 *   • The "studio fails to create lesson plans" regression: forced-tool JSON
 *     output with thinking disabled + low effort (otherwise Sonnet 4.6's default
 *     high-effort reasoning eats the token budget and truncates the JSON), plus
 *     the CBC + teacher-plan grounding composition and the stage-key tool schema.
 *   • The Phase 6 REL-001 idempotency + refund wiring: reserve-before-spend,
 *     resume-on-duplicate, keyless refusal, and empty-plan as a refunded failure.
 *     The generation record is now the keyed result of record
 *     (aiGenerations/{idempotencyKey}) rather than a fire-and-forget `.add()`.
 *
 * Run: node functions/teacherTools/studioLessonPlan.test.js
 */

"use strict";

const assert = require("node:assert");
const Module = require("node:module");
const {isValidIdempotencyKey} = require("../aiOperationsCore");

// ── Mutable mock state (closed over by the Module._load stubs) ───────────────
let lastCallClaudeOpts = null;
let callClaudeReturn = null;
let resolveTeacherPlanImpl = async () => "<teacher_plans>BLOCK</teacher_plans>";
let resolveCbcContextImpl = async () => ({
  contextBlock: "<cbc_context>KB</cbc_context>",
  kbMatch: {topic: "Matter"},
  kbWarning: null,
  kbVersion: "v9",
});
let lastCbcContextArgs = null;
let assertAndIncrementCalls = 0;
let refundCalls = [];

// Keyed aiGenerations store.
let genDocs = {};
// aiOperations spies.
const opCalls = {reserve: [], complete: [], fail: []};
let opStore = new Map();
let completeThrows = false;
let failThrows = false;
let isStaff = true;

const HttpsError = class extends Error {
  constructor(code, msg, details) { super(msg); this.code = code; this.details = details; }
};

const originalLoad = Module._load.bind(Module);
Module._load = function(id, parent, isMain) {
  if (id === "firebase-admin") {
    const firestore = () => ({
      collection: (name) => {
        assert.strictEqual(name, "aiGenerations", "only aiGenerations is written");
        return {
          doc: (suppliedId) => {
            const docId = suppliedId || `gen_${Object.keys(genDocs).length + 1}`;
            return {
              id: docId,
              set: async (data, opts) => {
                genDocs[docId] = opts && opts.merge ?
                  {...(genDocs[docId] || {}), ...data} : {...data};
              },
              get: async () => ({exists: docId in genDocs, data: () => genDocs[docId]}),
            };
          },
        };
      },
    });
    firestore.FieldValue = {serverTimestamp: () => "TS"};
    return {firestore};
  }
  if (id === "firebase-functions/v2/https") {
    return {onCall: (_opts, handler) => handler, HttpsError};
  }
  if (id === "../rateLimit") return {assertCallableRateLimit: async () => {}};
  if (id === "../authGuard") return {assertVerifiedAuth: async () => "teacher-1"};
  if (id === "../aiService") {
    return {
      getAnthropicApiKey: () => "test-key",
      getUserRole: async () => "teacher",
      isStaffRole: () => isStaff,
    };
  }
  if (id === "./anthropicClient") {
    return {
      DEFAULT_MODEL: "claude-sonnet-4-6",
      callClaude: async (_key, opts) => {
        lastCallClaudeOpts = opts;
        if (callClaudeReturn instanceof Error) throw callClaudeReturn;
        return callClaudeReturn;
      },
    };
  }
  if (id === "./usageMeter") {
    return {
      assertAndIncrement: async () => {
        assertAndIncrementCalls++;
        return {plan: "free", used: 1, limit: 10};
      },
      refundGeneration: async (uid, usage, tool) => { refundCalls.push({uid, usage, tool}); },
    };
  }
  if (id === "./teacherPlanContext") {
    return {resolveTeacherPlanContext: (...a) => resolveTeacherPlanImpl(...a)};
  }
  if (id === "./cbcKnowledge") {
    return {resolveCbcContext: (args) => {
      lastCbcContextArgs = args;
      return resolveCbcContextImpl(args);
    }};
  }
  if (id === "../aiOperations") {
    return {
      requireAndReserveAiOperation: ({idempotencyKey, userId, operationType, inputFingerprint}) => {
        if (!isValidIdempotencyKey(idempotencyKey)) {
          throw new HttpsError("invalid-argument", "missing key",
              {code: "IDEMPOTENCY_KEY_REQUIRED"});
        }
        opCalls.reserve.push({userId, idempotencyKey, operationType, inputFingerprint});
        const existing = opStore.get(idempotencyKey);
        if (!existing) {
          const rec = {userId, status: "processing", resultDocumentId: null};
          opStore.set(idempotencyKey, rec);
          return Promise.resolve({status: "created", operation: rec});
        }
        if (existing.status === "completed") return Promise.resolve({status: "completed", operation: existing});
        if (existing.status === "failed") {
          throw new HttpsError("failed-precondition", existing.errorMessage || "failed");
        }
        if (existing.status === "cancelled") throw new HttpsError("cancelled", "cancelled");
        return Promise.resolve({status: "processing", operation: existing});
      },
      completeAiOperation: async ({idempotencyKey, resultDocumentId, usageCharged}) => {
        if (completeThrows) throw new Error("settle write failed");
        opCalls.complete.push({idempotencyKey, resultDocumentId, usageCharged});
        const rec = opStore.get(idempotencyKey);
        if (rec) { rec.status = "completed"; rec.resultDocumentId = resultDocumentId; }
      },
      failAiOperation: async ({idempotencyKey, err, usageCharged}) => {
        if (failThrows) throw new Error("fail-op write failed");
        opCalls.fail.push({idempotencyKey, err, usageCharged});
        const rec = opStore.get(idempotencyKey);
        if (rec) rec.status = "failed";
      },
    };
  }
  return originalLoad(id, parent, isMain);
};

const {runStudioLessonPlan, createStudioGenerateLessonPlan, STUDIO_TOOL_SCHEMA} =
  require("./studioLessonPlan");

// ── Helpers ─────────────────────────────────────────────────────────────────
let passed = 0;
function ok(name, cond) {
  assert.ok(cond, `FAIL: ${name}`);
  passed++;
  console.log(`  ok  ${name}`);
}

const IDK = "11111111-1111-4111-8111-111111111111";

function resetMocks() {
  lastCallClaudeOpts = null;
  callClaudeReturn = {
    parsed: {lessonGoal: "Learners identify states of matter.", stages: [{name: "INTRODUCTION"}]},
    text: "",
    usage: {inputTokens: 100, outputTokens: 200},
    model: "claude-sonnet-4-6",
  };
  resolveTeacherPlanImpl = async () => "<teacher_plans>BLOCK</teacher_plans>";
  resolveCbcContextImpl = async () => ({
    contextBlock: "<cbc_context>KB</cbc_context>",
    kbMatch: {topic: "Matter"},
    kbWarning: null,
    kbVersion: "v9",
  });
  lastCbcContextArgs = null;
  assertAndIncrementCalls = 0;
  refundCalls = [];
  genDocs = {};
  opStore = new Map();
  opCalls.reserve.length = 0;
  opCalls.complete.length = 0;
  opCalls.fail.length = 0;
  completeThrows = false;
  failThrows = false;
  isStaff = true;
}

const baseArgs = (overrides = {}) => ({
  uid: "teacher-1",
  systemPrompt: "You are a Zambian teacher.",
  userPrompt: "Generate a lesson plan.",
  context: {grade: "Grade 5", subject: "integrated_science", term: "1", topic: "Matter", subtopic: "States"},
  apiKey: "test-key",
  idempotencyKey: IDK,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────
(async () => {
  // ═══ Regression guard (forced-tool / thinking off / low effort) ═══════════
  resetMocks();
  await runStudioLessonPlan(baseArgs());
  ok("uses forced-tool mode", lastCallClaudeOpts.mode === "tool");
  ok("passes a tool input schema", lastCallClaudeOpts.toolInputSchema &&
    lastCallClaudeOpts.toolInputSchema.type === "object");
  ok("disables thinking (no high-effort token burn)",
    lastCallClaudeOpts.thinking && lastCallClaudeOpts.thinking.type === "disabled");
  ok("pins effort low",
    lastCallClaudeOpts.outputConfig && lastCallClaudeOpts.outputConfig.effort === "low");
  ok("gives the plan a generous token budget", lastCallClaudeOpts.maxTokens >= 8000);

  // Returns clean, parseable JSON (the studio frontend JSON.parses this).
  resetMocks();
  const res = await runStudioLessonPlan(baseArgs());
  const parsed = JSON.parse(res.text);
  ok("returns JSON that round-trips", parsed.lessonGoal === "Learners identify states of matter.");
  ok("returns usage", res.usage && res.usage.outputTokens === 200);
  ok("meters the lesson_plan quota once", assertAndIncrementCalls === 1);
  ok("writes the keyed result row (tool lesson_plan_studio, status complete)",
    genDocs[IDK] && genDocs[IDK].tool === "lesson_plan_studio" && genDocs[IDK].status === "complete");
  ok("the keyed row stores the plan text for resume",
    genDocs[IDK].output && typeof genDocs[IDK].output.text === "string");

  // Grounding: KB block + teacher-plan block BOTH passed, composed KB-first.
  resetMocks();
  await runStudioLessonPlan(baseArgs());
  ok("composes KB + teacher-plan blocks, KB first",
    lastCallClaudeOpts.cbcContextBlock ===
      "<cbc_context>KB</cbc_context>\n\n<teacher_plans>BLOCK</teacher_plans>");
  ok("drives the KB resolver with the lesson coordinates",
    lastCbcContextArgs && lastCbcContextArgs.ownerUid === "teacher-1" &&
    lastCbcContextArgs.subject === "integrated_science" &&
    lastCbcContextArgs.subtopic === "States" && lastCbcContextArgs.term === "1");
  ok("stamps kbVersion + kbGrounded on the row",
    genDocs[IDK].kbVersion === "v9" && genDocs[IDK].kbGrounded === true);

  // Fail-open: grounding lookup errors must NOT block generation.
  resetMocks();
  resolveTeacherPlanImpl = async () => { throw new Error("firestore down"); };
  resolveCbcContextImpl = async () => { throw new Error("kb down"); };
  const res4 = await runStudioLessonPlan(baseArgs());
  ok("still generates when both grounding lookups throw", JSON.parse(res4.text).stages.length === 1);
  ok("sends null context block on grounding failure",
    lastCallClaudeOpts.cbcContextBlock === null);

  // One source failing still delivers the other.
  resetMocks();
  resolveCbcContextImpl = async () => { throw new Error("kb down"); };
  await runStudioLessonPlan(baseArgs());
  ok("teacher-plan block survives a KB failure",
    lastCallClaudeOpts.cbcContextBlock === "<teacher_plans>BLOCK</teacher_plans>");

  // No grounding found anywhere → null context block, still generates.
  resetMocks();
  resolveTeacherPlanImpl = async () => "";
  resolveCbcContextImpl = async () => null;
  const res5 = await runStudioLessonPlan(baseArgs());
  ok("generates with no grounding at all", Boolean(JSON.parse(res5.text).lessonGoal));
  ok("null context block when nothing matches", lastCallClaudeOpts.cbcContextBlock === null);

  // kbWarning is surfaced (additive).
  resetMocks();
  resolveCbcContextImpl = async () => ({
    contextBlock: "<general_cbc/>", kbMatch: null,
    kbWarning: "Used general CBC knowledge.", kbVersion: "v9",
  });
  const res5b = await runStudioLessonPlan(baseArgs());
  ok("returns kbWarning when the KB fell back", res5b.kbWarning === "Used general CBC knowledge.");
  ok("kbGrounded false on fallback", genDocs[IDK].kbGrounded === false);

  // Tool schema must not contradict the studio prompt's stage-key contract.
  const stageProps = STUDIO_TOOL_SCHEMA.properties.stages.items.properties || {};
  ok("stage schema uses the prompt's teacher/pupils/assessment keys",
    "teacher" in stageProps && "pupils" in stageProps && "assessment" in stageProps);
  ok("stage schema does NOT name the prompt-forbidden activity-array keys",
    !("teacherActivities" in stageProps) &&
    !("learnerActivities" in stageProps) &&
    !("assessmentCriteria" in stageProps));

  // ═══ Idempotency + refund wiring (REL-001) ════════════════════════════════
  // Reserve before the provider, settle once, charge once, no refund.
  resetMocks();
  await runStudioLessonPlan(baseArgs());
  ok("reserved before provider (operationType studio_lesson_plan)",
    opCalls.reserve.length === 1 && opCalls.reserve[0].operationType === "studio_lesson_plan");
  ok("settled once as completed", opCalls.complete.length === 1 && opCalls.complete[0].usageCharged === 1);
  ok("result doc IS the idempotency key", opCalls.complete[0].resultDocumentId === IDK);
  ok("no refund on success", refundCalls.length === 0);

  // Duplicate SAME completed key → resume without a second provider call/charge.
  resetMocks();
  await runStudioLessonPlan(baseArgs());
  const claudeSeen = lastCallClaudeOpts;
  lastCallClaudeOpts = null;
  const meterAfterFirst = assertAndIncrementCalls;
  const resume = await runStudioLessonPlan(baseArgs());
  ok("resume: no second provider call", lastCallClaudeOpts === null && claudeSeen !== null);
  ok("resume: no second charge", assertAndIncrementCalls === meterAfterFirst);
  ok("resume: marked resumed with the saved text", resume.resumed === true && typeof resume.text === "string");

  // Provider throws → refund + fail, error rethrown, no completion, no doc.
  resetMocks();
  callClaudeReturn = new Error("provider down");
  let threw = null;
  try { await runStudioLessonPlan(baseArgs()); } catch (e) { threw = e; }
  ok("throw: original error rethrown", threw && /provider down/.test(threw.message));
  ok("throw: quota refunded", refundCalls.length === 1 && refundCalls[0].tool === "lesson_plan");
  ok("throw: operation failed, not completed", opCalls.fail.length === 1 && opCalls.complete.length === 0);
  ok("throw: no result document written", !(IDK in genDocs));

  // Empty plan object → refunded FAILURE, never a billed completion.
  resetMocks();
  callClaudeReturn = {parsed: {}, text: "", usage: {inputTokens: 1, outputTokens: 1}, model: "m"};
  threw = null;
  try { await runStudioLessonPlan(baseArgs()); } catch (e) { threw = e; }
  ok("empty: throws internal", threw && threw.code === "internal");
  ok("empty: refunded + failed, not completed",
    refundCalls.length === 1 && opCalls.fail.length === 1 && opCalls.complete.length === 0);

  // Keyless / malformed key → refused before the provider, nothing spent.
  for (const badKey of [undefined, null, "", "not-a-uuid"]) {
    resetMocks();
    threw = null;
    try { await runStudioLessonPlan(baseArgs({idempotencyKey: badKey})); } catch (e) { threw = e; }
    ok(`refused: ${JSON.stringify(badKey)} rejected before spend`,
      threw && threw.code === "invalid-argument" &&
      lastCallClaudeOpts === null && assertAndIncrementCalls === 0 && opCalls.reserve.length === 0);
  }

  // Missing prompt → invalid-argument before reservation.
  resetMocks();
  threw = null;
  try { await runStudioLessonPlan(baseArgs({systemPrompt: ""})); } catch (e) { threw = e; }
  ok("invalid-inputs: throws invalid-argument before reservation",
    threw && threw.code === "invalid-argument" && opCalls.reserve.length === 0);

  // onCall wrapper: staff threads the key; non-staff is refused.
  resetMocks();
  const handler = createStudioGenerateLessonPlan("secret");
  const wres = await handler({auth: {uid: "teacher-1", token: {}}, data: {
    systemPrompt: "SYS", userPrompt: "USER", context: {}, idempotencyKey: IDK,
  }});
  ok("wrapper: staff gets a plan, key threaded (doc id is the key)",
    wres && wres.text && IDK in genDocs);

  resetMocks();
  isStaff = false;
  const handler2 = createStudioGenerateLessonPlan("secret");
  threw = null;
  try {
    await handler2({auth: {uid: "teacher-1", token: {}}, data: {systemPrompt: "SYS", userPrompt: "USER"}});
  } catch (e) { threw = e; }
  ok("wrapper: non-staff refused with permission-denied", threw && threw.code === "permission-denied");

  // completeAiOperation throwing is swallowed — still returns the plan.
  resetMocks();
  completeThrows = true;
  const resSettle = await runStudioLessonPlan(baseArgs());
  ok("settle-failure: still returns the plan text", typeof resSettle.text === "string" && resSettle.text.length > 0);

  console.log(`\n${passed} assertions passed.`);
  Module._load = originalLoad;
})().catch((err) => {
  Module._load = originalLoad;
  console.error(err);
  process.exit(1);
});
