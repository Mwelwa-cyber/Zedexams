/**
 * Node test for the quota-refund wiring on the three generators that were
 * still missing it: studioLessonPlan, generateNotes and generateSbaTask.
 *
 * The gap (production-readiness AI-006, already closed for worksheet /
 * homework / scheme / rubric / flashcards / assessment): each of these three
 * increments the teacher's monthly meter BEFORE the provider call, and then
 * threw straight out of the catch block without rolling it back. Any model
 * failure, timeout or malformed response cost the teacher a document they
 * never received. Lesson Plan Studio is the free tier's entry point, so it is
 * the highest-traffic path in the product.
 *
 * studioLessonPlan carries a second defect: a degenerate tool call (an empty
 * or non-object `parsed`) fell through to `{}`, which the studio rendered as
 * the empty table skeleton and reported as status "done" — a blank lesson plan
 * that the teacher paid for. It now refunds and throws a retryable error.
 *
 * What is asserted, per generator:
 *   1. callClaude throws  → refundGeneration called once with the SAME usage
 *      object the meter returned and the right tool key, and the original
 *      error is rethrown unmasked.
 *   2. a refund that itself throws is swallowed (best-effort) and the ORIGINAL
 *      error still reaches the caller.
 *   3. a successful generation never refunds.
 * plus, for studioLessonPlan only:
 *   4. an empty plan object refunds and throws instead of reporting success.
 *
 * Plain `node` script (repo convention). firebase-admin, firebase-functions,
 * the Anthropic client and the Firestore-backed helpers are stubbed via
 * Module._load before the modules under test load — same pattern as
 * generateWorksheet.test.js.
 *
 * Run: node functions/teacherTools/generationRefunds.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── In-memory aiGenerations store ────────────────────────────────────────
const SERVER_TS = Symbol("serverTimestamp");
let genDocs = {};
let genSeq = 0;

const docApi = (id) => ({
  id,
  set: async (data, opts) => {
    genDocs[id] = opts && opts.merge ? {...(genDocs[id] || {}), ...data} : {...data};
  },
  update: async (data) => {
    genDocs[id] = {...(genDocs[id] || {}), ...data};
  },
  get: async () => ({exists: id in genDocs, data: () => genDocs[id]}),
});

const firestoreFn = () => ({
  collection: () => ({
    doc: (suppliedId) => docApi(suppliedId || `gen_${++genSeq}`),
    add: async (data) => {
      const id = `gen_${++genSeq}`;
      genDocs[id] = {...data};
      return docApi(id);
    },
  }),
  doc: (path) => docApi(path),
});
firestoreFn.FieldValue = {
  serverTimestamp: () => SERVER_TS,
  increment: (n) => ({__inc: n}),
};

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const calls = {claude: [], refund: [], meter: []};
let claudeImpl = async () => ({
  parsed: {__valid: true, title: "A plan"},
  text: "raw",
  usage: {inputTokens: 10, outputTokens: 20},
  model: "m",
});
let refundImpl = async () => {};

const USAGE = {plan: "free", used: 1, period: "202607"};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return {firestore: firestoreFn};
  if (request === "firebase-functions/v2/https") {
    return {HttpsError, onCall: (opts, handler) => handler};
  }
  if (request === "../authGuard") return {assertVerifiedAuth: async () => "u1"};
  if (request === "../rateLimit") return {assertCallableRateLimit: async () => {}};
  if (request === "./generatorRateLimit") return {assertGeneratorRateLimit: async () => {}};
  if (request === "../aiService") {
    return {
      getAnthropicApiKey: () => "test-key",
      getUserRole: async () => "teacher",
      isStaffRole: () => false,
    };
  }
  if (request === "./anthropicClient") {
    return {
      DEFAULT_MODEL: "claude-test",
      callClaude: (apiKey, opts) => {
        calls.claude.push({apiKey, opts});
        return claudeImpl(apiKey, opts);
      },
    };
  }
  if (request === "./cbcKnowledge") {
    return {
      resolveCbcContext: async () => ({
        contextBlock: "CBC CONTEXT", kbMatch: true, kbWarning: null, kbVersion: "kb-test",
      }),
    };
  }
  if (request === "./teacherPlanContext") {
    return {resolveTeacherPlanContext: async () => ""};
  }
  if (request === "./notesSchema") {
    return {validateNotes: (parsed) => ({ok: true, value: parsed || {}, errors: []})};
  }
  if (request === "./sbaTaskSchema") {
    return {validateSbaTask: (parsed) => ({ok: true, value: parsed || {}, errors: []})};
  }
  if (request === "./usageMeter") {
    return {
      assertAndIncrement: async (uid, tool) => {
        calls.meter.push({uid, tool});
        return {...USAGE};
      },
      refundGeneration: async (uid, usage, tool) => {
        calls.refund.push({uid, usage, tool});
        return refundImpl(uid, usage, tool);
      },
    };
  }
  if (request === "../aiOperations") {
    // generateSbaTask now reserves an operation unconditionally (Phase 6
    // REL-001). This test is about refunds, not idempotency, so the reservation
    // is a stateless "always created" — every run reaches the provider, which
    // is what the refund assertions expect. The unmigrated generators in this
    // suite (studioLessonPlan, generateNotes) don't import this module, so the
    // stub is inert for them. Idempotency itself is proved in
    // generateSbaTask.test.js / aiOperations.test.js.
    return {
      requireAndReserveAiOperation: async () => ({status: "created", operation: {}}),
      completeAiOperation: async () => {},
      failAiOperation: async () => {},
    };
  }
  return origLoad.call(this, request, ...rest);
};

const {runStudioLessonPlan} = require("./studioLessonPlan");
const {runNotes} = require("./generateNotes");
const {runSbaTask} = require("./generateSbaTask");

function reset() {
  genDocs = {};
  genSeq = 0;
  calls.claude.length = 0;
  calls.refund.length = 0;
  calls.meter.length = 0;
  refundImpl = async () => {};
  claudeImpl = async () => ({
    parsed: {__valid: true, title: "A plan"},
    text: "raw",
    usage: {inputTokens: 10, outputTokens: 20},
    model: "m",
  });
}

// One invocation per generator, with the minimum valid inputs each one
// demands, and the tool key each must refund against.
const GENERATORS = [
  {
    name: "studioLessonPlan",
    tool: "lesson_plan",
    run: () => runStudioLessonPlan({
      uid: "u1",
      systemPrompt: "SYSTEM",
      userPrompt: "USER",
      context: {grade: "G4", subject: "mathematics", topic: "Fractions"},
      apiKey: "test-key",
    }),
  },
  {
    name: "generateNotes",
    tool: "notes",
    run: () => runNotes({
      uid: "u1",
      rawInputs: {grade: "G4", subject: "mathematics", topic: "Fractions"},
      apiKey: "test-key",
    }),
  },
  {
    name: "generateSbaTask",
    tool: "sba_task",
    run: () => runSbaTask({
      uid: "u1",
      rawInputs: {
        grade: "G5", subject: "mathematics", taskType: "topic_task",
        term: "1", topic: "Fractions",
      },
      apiKey: "test-key",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    }),
  },
];

async function expectRejection(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, got a resolved value");
}

(async function run() {
  console.log("\nfailed generations refund the teacher's quota");

  for (const gen of GENERATORS) {
    // 1. A provider failure refunds exactly once, against the same usage
    //    object the meter handed back, and rethrows the original error.
    reset();
    const boom = new Error("model overloaded");
    claudeImpl = async () => {
      throw boom;
    };
    const err = await expectRejection(gen.run);
    ok(`${gen.name}: the original provider error is rethrown unmasked`, err === boom);
    ok(`${gen.name}: refunds exactly once`, calls.refund.length === 1);
    ok(
        `${gen.name}: refunds the '${gen.tool}' counter with the metered usage`,
        calls.refund[0].uid === "u1" &&
      calls.refund[0].tool === gen.tool &&
      calls.refund[0].usage.period === USAGE.period &&
      calls.refund[0].usage.plan === USAGE.plan,
    );

    // 2. A refund that itself fails must not mask the original error — the
    //    teacher still sees why their generation failed.
    reset();
    claudeImpl = async () => {
      throw boom;
    };
    refundImpl = async () => {
      throw new Error("refund write failed");
    };
    const err2 = await expectRejection(gen.run);
    ok(`${gen.name}: a failing refund is swallowed, original error survives`, err2 === boom);

    // 3. A successful generation never refunds.
    reset();
    await gen.run();
    ok(`${gen.name}: a successful generation does not refund`, calls.refund.length === 0);
    ok(`${gen.name}: the meter was charged once`, calls.meter.length === 1);
  }

  // 4. studioLessonPlan only — a degenerate tool call is a failure, not a
  //    silently-empty success. This is the incident the file header documents.
  for (const parsed of [{}, null, "not an object"]) {
    reset();
    claudeImpl = async () => ({
      parsed, text: "", usage: {inputTokens: 1, outputTokens: 1}, model: "m",
    });
    const err = await expectRejection(GENERATORS[0].run);
    ok(
        `studioLessonPlan: parsed=${JSON.stringify(parsed)} throws instead of reporting success`,
        err instanceof HttpsError && err.code === "internal",
    );
    ok(
        `studioLessonPlan: parsed=${JSON.stringify(parsed)} refunds the lesson_plan counter`,
        calls.refund.length === 1 && calls.refund[0].tool === "lesson_plan",
    );
    ok(
        `studioLessonPlan: parsed=${JSON.stringify(parsed)} error is teacher-readable`,
        /came back empty/i.test(err.message) && !/parsed|tool_use|schema/i.test(err.message),
    );
  }

  // A real plan still comes back serialised, so the studio's JSON.parse
  // contract is untouched by the guard above.
  reset();
  const good = await GENERATORS[0].run();
  ok(
      "studioLessonPlan: a real plan is still returned as serialised JSON",
      JSON.parse(good.text).title === "A plan",
  );

  console.log(`\n─── ${passed} assertions passed ───`);
})().catch((err) => {
  console.error("\nFAILED:", err && err.message);
  console.error(err);
  process.exit(1);
});
