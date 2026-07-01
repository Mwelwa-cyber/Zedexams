/**
 * Plain-node tests for studioLessonPlan.js — the Lesson Plan Studio generation
 * core (runStudioLessonPlan).
 *
 * Guards the "studio fails to create lesson plans" regression: the studio must
 * call Claude with forced-tool JSON output and with thinking disabled + low
 * effort, otherwise Sonnet 4.6's default high-effort reasoning eats the token
 * budget and truncates the JSON, breaking the studio's JSON.parse.
 *
 * Run: node functions/teacherTools/studioLessonPlan.test.js
 */

"use strict";

const assert = require("node:assert");

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
let loggedDocs = [];

// ── Stub dependencies that studioLessonPlan.js pulls in ─────────────────────
const Module = require("node:module");
const originalLoad = Module._load.bind(Module);
Module._load = function(id, parent, isMain) {
  if (id === "firebase-admin") {
    return {
      firestore: Object.assign(
        () => ({collection: () => ({add: async (d) => { loggedDocs.push(d); }})}),
        {FieldValue: {serverTimestamp: () => "TS"}},
      ),
    };
  }
  if (id === "firebase-functions/v2/https") {
    const HttpsError = class extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    };
    return {onCall: (_opts, handler) => handler, HttpsError};
  }
  if (id === "../aiService") {
    return {
      getAnthropicApiKey: () => "test-key",
      getUserRole: async () => "teacher",
      isStaffRole: () => true,
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
  return originalLoad(id, parent, isMain);
};

const {runStudioLessonPlan, STUDIO_TOOL_SCHEMA} = require("./studioLessonPlan");

// ── Helpers ─────────────────────────────────────────────────────────────────
let passed = 0;
function ok(name, cond) {
  assert.ok(cond, `FAIL: ${name}`);
  passed++;
  console.log(`  ok  ${name}`);
}

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
  loggedDocs = [];
}

const baseArgs = (overrides = {}) => ({
  uid: "teacher-1",
  systemPrompt: "You are a Zambian teacher.",
  userPrompt: "Generate a lesson plan.",
  context: {grade: "Grade 5", subject: "integrated_science", term: "1", topic: "Matter", subtopic: "States"},
  apiKey: "test-key",
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────
(async () => {
  // 1. The regression guard: forced-tool mode + thinking off + low effort.
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

  // 2. Returns clean, parseable JSON (the studio frontend JSON.parses this).
  resetMocks();
  const res = await runStudioLessonPlan(baseArgs());
  const parsed = JSON.parse(res.text);
  ok("returns JSON that round-trips", parsed.lessonGoal === "Learners identify states of matter.");
  ok("returns usage", res.usage && res.usage.outputTokens === 200);
  ok("meters the lesson_plan quota once", assertAndIncrementCalls === 1);
  ok("logs an aiGenerations row", loggedDocs.length === 1 &&
    loggedDocs[0].tool === "lesson_plan_studio");

  // 3. Grounding: the KB block and the teacher-plan block are BOTH passed,
  //    composed KB-first (shareable prompt-cache prefix) + teacher-plans last.
  resetMocks();
  await runStudioLessonPlan(baseArgs());
  ok("composes KB + teacher-plan blocks, KB first",
    lastCallClaudeOpts.cbcContextBlock ===
      "<cbc_context>KB</cbc_context>\n\n<teacher_plans>BLOCK</teacher_plans>");
  ok("drives the KB resolver with the lesson coordinates",
    lastCbcContextArgs && lastCbcContextArgs.ownerUid === "teacher-1" &&
    lastCbcContextArgs.subject === "integrated_science" &&
    lastCbcContextArgs.subtopic === "States" && lastCbcContextArgs.term === "1");
  ok("stamps kbVersion + kbGrounded on the log row",
    loggedDocs[0].kbVersion === "v9" && loggedDocs[0].kbGrounded === true);

  // 4. Fail-open: grounding lookup errors must NOT block generation.
  resetMocks();
  resolveTeacherPlanImpl = async () => { throw new Error("firestore down"); };
  resolveCbcContextImpl = async () => { throw new Error("kb down"); };
  const res4 = await runStudioLessonPlan(baseArgs());
  ok("still generates when both grounding lookups throw", JSON.parse(res4.text).stages.length === 1);
  ok("sends null context block on grounding failure",
    lastCallClaudeOpts.cbcContextBlock === null);

  // 4b. One source failing still delivers the other.
  resetMocks();
  resolveCbcContextImpl = async () => { throw new Error("kb down"); };
  await runStudioLessonPlan(baseArgs());
  ok("teacher-plan block survives a KB failure",
    lastCallClaudeOpts.cbcContextBlock === "<teacher_plans>BLOCK</teacher_plans>");

  // 5. No grounding found anywhere → null context block, still generates.
  resetMocks();
  resolveTeacherPlanImpl = async () => "";
  resolveCbcContextImpl = async () => null;
  const res5 = await runStudioLessonPlan(baseArgs());
  ok("generates with no grounding at all", Boolean(JSON.parse(res5.text).lessonGoal));
  ok("null context block when nothing matches", lastCallClaudeOpts.cbcContextBlock === null);

  // 5b. kbWarning is surfaced (additive) so the studio can show the same
  //     "used general CBC knowledge" notice the schema generator shows.
  resetMocks();
  resolveCbcContextImpl = async () => ({
    contextBlock: "<general_cbc/>", kbMatch: null,
    kbWarning: "Used general CBC knowledge.", kbVersion: "v9",
  });
  const res5b = await runStudioLessonPlan(baseArgs());
  ok("returns kbWarning when the KB fell back", res5b.kbWarning === "Used general CBC knowledge.");
  ok("kbGrounded false on fallback", loggedDocs[0].kbGrounded === false);

  // 6. Tool schema must NOT contradict the studio system prompt's stage-key
  //    contract. The prompt (src/.../studioSystemPrompt.js) instructs the model
  //    to emit stage keys teacher/pupils/assessment/duration and explicitly
  //    FORBIDS teacherActivities/learnerActivities/assessmentCriteria. A tool
  //    schema that named the forbidden family contradicted the prompt and, under
  //    forced tool_choice, made the model emit an empty tool call — every plan
  //    rendered as a hollow table skeleton. Guard against re-introducing that.
  const stageProps =
    STUDIO_TOOL_SCHEMA.properties.stages.items.properties || {};
  ok("stage schema uses the prompt's teacher/pupils/assessment keys",
    "teacher" in stageProps && "pupils" in stageProps && "assessment" in stageProps);
  ok("stage schema does NOT name the prompt-forbidden activity-array keys",
    !("teacherActivities" in stageProps) &&
    !("learnerActivities" in stageProps) &&
    !("assessmentCriteria" in stageProps));

  console.log(`\n${passed} assertions passed.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
