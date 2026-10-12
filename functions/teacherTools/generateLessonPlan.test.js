/**
 * generateLessonPlan — regression tests for input sanitising and quota refunds.
 *   node functions/teacherTools/generateLessonPlan.test.js
 */
const assert = require("node:assert");
const Module = require("node:module");

const state = {refunds: [], claudeFails: true};
const originalLoad = Module._load.bind(Module);
Module._load = function(id, parent, isMain) {
  if (id === "firebase-admin/firestore") {
    const doc = () => ({id: "gen1", set: async () => {}});
    return {
      FieldValue: {serverTimestamp: () => "ts"},
      getFirestore: () => ({collection: () => ({doc})}),
    };
  }
  if (id === "firebase-functions/v2/https") {
    return {onCall: () => () => {}, HttpsError: class extends Error {
      constructor(code, msg) {
        super(msg);
        this.code = code;
      }
    }};
  }
  if (id === "../authGuard") return {assertVerifiedAuth: async () => "u1"};
  if (id === "./generatorRateLimit") return {assertGeneratorRateLimit: async () => {}};
  if (id === "../aiService") {
    return {getAnthropicApiKey: () => "", getUserRole: async () => "teacher", isStaffRole: () => true};
  }
  if (id === "./anthropicClient") {
    return {callClaude: async () => {
      if (state.claudeFails) throw new Error("anthropic down");
      return {parsed: {}, text: "", usage: {}};
    }};
  }
  if (id === "./cbcKnowledge") {
    return {resolveCbcContext: async () => ({contextBlock: "", kbMatch: null, kbWarning: null, kbVersion: "0"})};
  }
  if (id === "./lessonPlanSchema") {
    return {validateLessonPlan: (p) => ({ok: true, value: p, errors: []})};
  }
  if (id === "./usageMeter") {
    return {
      assertAndIncrement: async () => ({plan: "free", used: 1, limit: 10, period: "2026-10"}),
      refundGeneration: async (uid, usage, tool) => {
        state.refunds.push({uid, tool, usage});
      },
    };
  }
  return originalLoad(id, parent, isMain);
};

const {sanitizeInputs, validateInputs, runLessonPlan} = require("./generateLessonPlan");

(async () => {
  // Digits in canonical subject keys must survive sanitising.
  for (const subject of ["religious_education_2044", "religious_education_2046"]) {
    const inputs = sanitizeInputs({grade: "G7", subject, topic: "x"});
    assert.strictEqual(inputs.subject, subject);
    assert.deepStrictEqual(validateInputs(inputs), []);
  }
  assert.ok(validateInputs(sanitizeInputs({grade: "G7", subject: "nope_9", topic: "x"})).length > 0);

  // A failed model call must refund the quota it charged, once, then rethrow.
  await assert.rejects(
      runLessonPlan({uid: "u1", rawInputs: {grade: "G7", subject: "mathematics", topic: "Fractions"}, apiKey: "k"}),
      /anthropic down/,
  );
  assert.strictEqual(state.refunds.length, 1);
  assert.strictEqual(state.refunds[0].uid, "u1");
  assert.strictEqual(state.refunds[0].tool, "lesson_plan");
  assert.strictEqual(state.refunds[0].usage.period, "2026-10");

  // A successful generation must not refund.
  state.refunds.length = 0;
  state.claudeFails = false;
  await runLessonPlan({uid: "u1", rawInputs: {grade: "G7", subject: "mathematics", topic: "Fractions"}, apiKey: "k"});
  assert.strictEqual(state.refunds.length, 0);

  console.log("generateLessonPlan tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
