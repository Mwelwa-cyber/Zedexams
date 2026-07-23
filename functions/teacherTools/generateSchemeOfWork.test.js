/**
 * Node test for the generateSchemeOfWork orchestration (runSchemeOfWork in
 * functions/teacherTools/generateSchemeOfWork.js). Focuses on the idempotency +
 * refund wiring (AI-002/AI-006), mirroring generateHomework.test.js:
 *
 *   1. Valid output → status 'complete', the operation is reserved before the
 *      provider call and settled once, usage is charged exactly once, no refund.
 *   2. callClaude throws → status 'failed', the teacher's quota is refunded,
 *      the operation is failed, error rethrown.
 *   3. A duplicate request with the SAME completed idempotency key resumes the
 *      saved result WITHOUT calling Claude again and WITHOUT a second charge.
 *   4. No idempotency key (legacy caller) → still works end-to-end, the
 *      reservation service is never touched, but a hard failure STILL refunds.
 *   5. Invalid model output → status 'flagged', settled as a completion (the
 *      teacher got a scheme), no refund.
 *
 * Plain `node` script (repo convention). firebase-admin, firebase-functions,
 * the Anthropic client and the Firestore-backed helpers are stubbed via
 * Module._load before the module under test loads (same pattern as
 * generateHomework.test.js). aiOperationsCore (isValidIdempotencyKey) loads for
 * real; schemeOfWorkSchema / schemeOfWorkPrompt and the scheme helper modules
 * are stubbed so this test controls valid/invalid/throw deterministically.
 *
 * Run: node functions/teacherTools/generateSchemeOfWork.test.js
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

const firestoreFn = () => ({
  collection: (name) => {
    assert.strictEqual(name, "aiGenerations", "only aiGenerations is written");
    return {
      doc: (suppliedId) => {
        const id = suppliedId || `gen_${++genSeq}`;
        return {
          id,
          set: async (data) => {
            genDocs[id] = {...data};
          },
          update: async (data) => {
            genDocs[id] = {...(genDocs[id] || {}), ...data};
          },
          get: async () => ({
            exists: id in genDocs,
            data: () => genDocs[id],
          }),
        };
      },
    };
  },
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

const calls = {claude: [], refund: [], meter: [], reserve: [], complete: [], fail: []};
let claudeImpl = async () => ({parsed: {__valid: true}, text: "raw", usage: {inputTokens: 10, outputTokens: 20}, model: "m"});
let refundImpl = async () => {};

// ── Fake aiOperations service (in-memory, keyed by idempotencyKey) ─────────
let opStore = new Map();
const reserveImpl = async ({uid, idempotencyKey, operationType, fingerprintInput}) => {
  calls.reserve.push({uid, idempotencyKey, operationType, fingerprintInput});
  const existing = opStore.get(idempotencyKey);
  if (!existing) {
    const record = {userId: uid, status: "processing", resultDocumentId: null, errorMessage: null, errorCode: null};
    opStore.set(idempotencyKey, record);
    return {status: "created", operation: record};
  }
  if (existing.status === "completed") return {status: "completed", operation: existing};
  if (existing.status === "failed") return {status: "failed", operation: existing};
  return {status: "processing", operation: existing};
};
const completeImpl = async ({idempotencyKey, resultDocumentId, usageCharged}) => {
  calls.complete.push({idempotencyKey, resultDocumentId, usageCharged});
  const rec = opStore.get(idempotencyKey);
  if (rec) {
    rec.status = "completed";
    rec.resultDocumentId = resultDocumentId;
  }
};
const failImpl = async ({idempotencyKey, err, usageCharged}) => {
  calls.fail.push({idempotencyKey, err, usageCharged});
  const rec = opStore.get(idempotencyKey);
  if (rec) {
    rec.status = "failed";
    rec.errorMessage = String((err && err.message) || err);
    rec.errorCode = "PROVIDER_ERROR";
  }
};

const USAGE = {plan: "max", used: 1, period: "202607"};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return {firestore: firestoreFn};
  if (request === "firebase-functions/v2/https") {
    return {HttpsError, onCall: (opts, handler) => handler};
  }
  if (request === "../authGuard") return {assertVerifiedAuth: async () => "u1"};
  if (request === "./generatorRateLimit") return {assertGeneratorRateLimit: async () => {}};
  if (request === "../aiService") {
    return {
      getAnthropicApiKey: () => "test-key",
      getUserRole: async () => "teacher",
      isStaffRole: () => true,
    };
  }
  if (request === "./anthropicClient") {
    return {
      DEFAULT_MODEL: "claude-sonnet-4-6",
      callClaude: (apiKey, opts) => {
        calls.claude.push({apiKey, opts});
        return claudeImpl(apiKey, opts);
      },
    };
  }
  if (request === "./cbcKnowledge") {
    return {
      resolveCbcContext: async () => ({
        contextBlock: "CBC CONTEXT",
        kbMatch: true,
        kbWarning: null,
        kbVersion: "kb-test",
      }),
      resolveTermModuleOutline: async () => null,
      classifySubjectForGrade: () => "core",
      getOfficialSubjectsForGrade: () => [],
    };
  }
  if (request === "./schemeOfWorkSchema") {
    // Controlled via the parsed object: {__valid:false} → schema error. Always
    // yields a value carrying a `header` object because runSchemeOfWork mutates
    // scheme.header.* after validation.
    return {
      validateSchemeOfWork: (parsed) => {
        const okFlag = !!(parsed && parsed.__valid !== false);
        const value = {...(parsed || {})};
        if (!value.header || typeof value.header !== "object") value.header = {};
        return {ok: okFlag, value, errors: okFlag ? [] : ["schema error"]};
      },
    };
  }
  if (request === "./schemeQualityCheck") {
    return {buildSchemeQualityChecks: () => ({checks: []})};
  }
  if (request === "./schemeOfWorkPrompt") {
    return {
      PROMPT_VERSION: "sow-test",
      pickSystemPrompt: () => "SYSTEM",
      buildUserPrompt: () => "USER",
    };
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
  if (request === "./teacherPlans") {
    return {FREE_PREVIEW_LIMITS: {schemePreviewWeeks: 4}};
  }
  if (request === "./freePreview") {
    return {clampSchemePreview: (scheme) => ({scheme, truncated: false})};
  }
  if (request === "./schemeCurriculumOutline") {
    return {
      resolveSchemeOutline: async () => ({block: "", topicCount: 0}),
      normalizeSource: (s) => s,
    };
  }
  if (request === "./schemeTermDivision") {
    return {sliceOutlineToTerm: (o) => o};
  }
  if (request === "./schemeTimetable") {
    return {
      sanitizeTimetableInput: () => null,
      summarizeTimetableForSubject: () => null,
    };
  }
  if (request === "./schemeAdvisories") {
    return {buildSchemeAdvisories: () => []};
  }
  if (request === "../aiOperations") {
    return {
      reserveAiOperation: (args) => reserveImpl(args),
      completeAiOperation: (args) => completeImpl(args),
      failAiOperation: (args) => failImpl(args),
    };
  }
  return origLoad.call(this, request, ...rest);
};

const {runSchemeOfWork} = require("./generateSchemeOfWork");

const INPUTS = {grade: "G7", subject: "mathematics", term: 2, numberOfWeeks: 12};
const IDK = "22222222-2222-4222-8222-222222222222";

function reset() {
  genDocs = {};
  genSeq = 0;
  calls.claude.length = 0;
  calls.refund.length = 0;
  calls.meter.length = 0;
  calls.reserve.length = 0;
  calls.complete.length = 0;
  calls.fail.length = 0;
  opStore = new Map();
  refundImpl = async () => {};
  claudeImpl = async () => ({parsed: {__valid: true}, text: "raw", usage: {inputTokens: 10, outputTokens: 20}, model: "m"});
}

(async function run() {
  // 1. Valid output with a key → complete, reserved once, charged once, no refund.
  reset();
  {
    const res = await runSchemeOfWork({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("valid: returns generationId + schemeOfWork", res.generationId && res.schemeOfWork);
    ok("valid: doc id IS the idempotency key", res.generationId === IDK);
    ok("valid: status complete", genDocs[IDK].status === "complete");
    ok("valid: provider called exactly once", calls.claude.length === 1);
    ok("valid: reserved before provider", calls.reserve.length === 1 && calls.reserve[0].operationType === "generate_scheme_of_work");
    ok("valid: settled once as completed", calls.complete.length === 1 && calls.complete[0].usageCharged === 1);
    ok("valid: usage charged exactly once", calls.meter.length === 1 && calls.meter[0].tool === "scheme_of_work");
    ok("valid: no refund on success", calls.refund.length === 0);
    ok("valid: not failed", calls.fail.length === 0);
  }

  // 2. Provider throws → failed + refund + fail-op, error rethrown.
  reset();
  {
    claudeImpl = async () => {
      throw new Error("provider down");
    };
    let threw = null;
    try {
      await runSchemeOfWork({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("throw: original error rethrown", threw && /provider down/.test(threw.message));
    ok("throw: doc flipped to failed", genDocs[IDK].status === "failed");
    ok("throw: quota refunded (AI-006)", calls.refund.length === 1 && calls.refund[0].tool === "scheme_of_work");
    ok("throw: operation failed", calls.fail.length === 1);
    ok("throw: not settled as complete", calls.complete.length === 0);
  }

  // 3. Duplicate SAME completed key → resume without a second provider call/charge.
  reset();
  {
    await runSchemeOfWork({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    const claudeAfterFirst = calls.claude.length;
    const meterAfterFirst = calls.meter.length;
    const res2 = await runSchemeOfWork({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("resume: no second provider call", calls.claude.length === claudeAfterFirst);
    ok("resume: no second charge", calls.meter.length === meterAfterFirst);
    ok("resume: marked resumed", res2.resumed === true);
    ok("resume: returns the saved scheme", res2.generationId === IDK && !!res2.schemeOfWork);
  }

  // 4. Legacy caller (no key) → works; reservation untouched; failure still refunds.
  reset();
  {
    const res = await runSchemeOfWork({uid: "u1", rawInputs: INPUTS, apiKey: "k"});
    ok("legacy: succeeds without a key", res.generationId && res.schemeOfWork);
    ok("legacy: random doc id (not a key)", res.generationId.startsWith("gen_"));
    ok("legacy: reservation never touched", calls.reserve.length === 0 && calls.complete.length === 0);

    claudeImpl = async () => {
      throw new Error("boom");
    };
    let threw = null;
    try {
      await runSchemeOfWork({uid: "u1", rawInputs: INPUTS, apiKey: "k"});
    } catch (e) {
      threw = e;
    }
    ok("legacy: hard failure still rethrows", threw && /boom/.test(threw.message));
    ok("legacy: hard failure still refunds (AI-006)", calls.refund.length === 1);
    ok("legacy: fail-op never touched without a key", calls.fail.length === 0);
  }

  // 5. Invalid output → flagged, settled as a completion, no refund.
  reset();
  {
    claudeImpl = async () => ({parsed: {__valid: false}, text: "raw", usage: {inputTokens: 1, outputTokens: 1}, model: "m"});
    const res = await runSchemeOfWork({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("flagged: status flagged", genDocs[IDK].status === "flagged");
    ok("flagged: review warning returned", /review/i.test(res.warning || ""));
    ok("flagged: settled as completion", calls.complete.length === 1);
    ok("flagged: no refund (teacher got a scheme)", calls.refund.length === 0);
  }

  Module._load = origLoad;
  console.log(`\nAll generateSchemeOfWork tests passed (${passed} assertions).`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
