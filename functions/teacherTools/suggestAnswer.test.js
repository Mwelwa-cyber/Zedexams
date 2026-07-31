/**
 * Node test for the suggestAnswer orchestration (runSuggestAnswer +
 * createSuggestAnswer). A TRANSFORMATION generator, so alongside the idempotency
 * + refund wiring it covers source-curriculum PRESERVATION:
 *
 *   • The predicted answer is pinned to the question's OWN curriculum — a
 *     2013/previous question is not answered against CBC — and a request that
 *     cannot name its curriculum is REFUSED fail-closed before any spend, in the
 *     runner as well as the callable (no direct bypass).
 *   • Idempotency: reserve-once / charge-once / settle-once, resume, keyless refusal.
 *   • AI-006 refund: a provider failure refunds + settles the operation as failed.
 *     (The Gemini-vision path falls back to Claude; only a Claude failure is fatal.)
 *
 * sourceCurriculum + suggestAnswer's own inline logic load for real. Everything
 * else is stubbed.
 *
 * Run: node functions/teacherTools/suggestAnswer.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");
const {isValidIdempotencyKey} = require("../aiOperationsCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const SERVER_TS = Symbol("serverTimestamp");
let genDocs = {};

const firestoreFn = () => ({
  collection: (name) => {
    assert.strictEqual(name, "aiGenerations", "only aiGenerations is written");
    return {
      doc: (suppliedId) => {
        const id = suppliedId || `gen_${Object.keys(genDocs).length + 1}`;
        return {
          id,
          set: async (data, opts) => {
            genDocs[id] = opts && opts.merge ? {...(genDocs[id] || {}), ...data} : {...data};
          },
          get: async () => ({exists: id in genDocs, data: () => genDocs[id]}),
        };
      },
    };
  },
});
firestoreFn.FieldValue = {serverTimestamp: () => SERVER_TS};

class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

const calls = {claude: [], gemini: [], refund: [], meter: [], reserve: [], complete: [], fail: []};
let claudeImpl = async () => ({parsed: {answer: "Independence in 1964.", rationale: "History fact.", confidence: "high"}});
let geminiImpl = async () => JSON.stringify({answer: "from image", rationale: "vision", confidence: "high"});

let opStore = new Map();
const reserveImpl = async ({uid, idempotencyKey, operationType, fingerprintInput}) => {
  calls.reserve.push({uid, idempotencyKey, operationType, fingerprintInput});
  const existing = opStore.get(idempotencyKey);
  if (!existing) {
    const rec = {userId: uid, status: "processing", resultDocumentId: null};
    opStore.set(idempotencyKey, rec);
    return {status: "created", operation: rec};
  }
  if (existing.status === "completed") return {status: "completed", operation: existing};
  return {status: "processing", operation: existing};
};
const completeImpl = async ({idempotencyKey, resultDocumentId, usageCharged}) => {
  calls.complete.push({idempotencyKey, resultDocumentId, usageCharged});
  const rec = opStore.get(idempotencyKey);
  if (rec) { rec.status = "completed"; rec.resultDocumentId = resultDocumentId; }
};
const failImpl = async ({idempotencyKey, err, usageCharged}) => {
  calls.fail.push({idempotencyKey, err, usageCharged});
  const rec = opStore.get(idempotencyKey);
  if (rec) rec.status = "failed";
};

let isStaff = true;

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return {firestore: firestoreFn};
  if (request === "firebase-functions/v2/https") {
    return {HttpsError, onCall: (opts, handler) => handler};
  }
  if (request === "../rateLimit") return {assertCallableRateLimit: async () => {}};
  if (request === "../authGuard") return {assertVerifiedAuth: async () => "u1"};
  if (request === "../aiService") {
    return {
      getAnthropicApiKey: () => "test-key",
      getUserRole: async () => "teacher",
      isStaffRole: () => isStaff,
    };
  }
  if (request === "./anthropicClient") {
    return {callClaude: (apiKey, opts) => { calls.claude.push({apiKey, opts}); return claudeImpl(apiKey, opts); }};
  }
  if (request === "../geminiClient") {
    return {callGemini: (key, opts) => { calls.gemini.push({key, opts}); return geminiImpl(key, opts); }};
  }
  if (request === "./usageMeter") {
    return {
      assertAndIncrement: async (uid, tool) => { calls.meter.push({uid, tool}); return {plan: "free", used: 1}; },
      refundGeneration: async (uid, usage, tool) => { calls.refund.push({uid, usage, tool}); },
    };
  }
  if (request === "../aiOperations") {
    return {
      requireAndReserveAiOperation: ({idempotencyKey, userId, operationType, inputFingerprint}) => {
        if (!isValidIdempotencyKey(idempotencyKey)) {
          throw new HttpsError("invalid-argument", "missing key", {code: "IDEMPOTENCY_KEY_REQUIRED"});
        }
        return reserveImpl({uid: userId, idempotencyKey, operationType, fingerprintInput: inputFingerprint});
      },
      completeAiOperation: (a) => completeImpl(a),
      failAiOperation: (a) => failImpl(a),
    };
  }
  return origLoad.call(this, request, ...rest);
};

const {runSuggestAnswer, createSuggestAnswer} = require("./suggestAnswer");

const IDK = "11111111-1111-4111-8111-111111111111";
// A PREVIOUS (2013) history question. The pre-migration system prompt said
// "Zambian CBC" — so answering it as CBC was cross-curriculum drift.
const INPUTS = {
  type: "short_answer",
  text: "When did Zambia gain independence?",
  grade: "G7", subject: "history", curriculum: "previous", language: "english",
  options: [], nonEmptyOptionCount: 0, wordBank: [],
  unit: "", tolerance: 0, matchingLeft: [], matchingRight: [], sequenceItems: [], imageUrl: "",
};

function reset() {
  genDocs = {};
  for (const k of Object.keys(calls)) calls[k].length = 0;
  opStore = new Map();
  isStaff = true;
  claudeImpl = async () => ({parsed: {answer: "Independence in 1964.", rationale: "History fact.", confidence: "high"}});
  geminiImpl = async () => JSON.stringify({answer: "from image", rationale: "vision", confidence: "high"});
}

(async function run() {
  // 1. Valid → complete, reserved once, charged once, no refund; result stored.
  reset();
  {
    const res = await runSuggestAnswer({uid: "u1", inputs: INPUTS, apiKey: "k", geminiKey: "", idempotencyKey: IDK});
    ok("valid: returns an answer + confidence", res.answer && res.confidence);
    ok("valid: result doc IS the key + complete", genDocs[IDK] && genDocs[IDK].status === "complete");
    ok("valid: reserved as suggest_answer", calls.reserve.length === 1 && calls.reserve[0].operationType === "suggest_answer");
    ok("valid: settled once, charged once", calls.complete.length === 1 && calls.meter.length === 1 && calls.meter[0].tool === "suggest_answer");
    ok("valid: no refund, not failed", calls.refund.length === 0 && calls.fail.length === 0);
  }

  // 2. CURRICULUM PRESERVED — the Claude prompt names the SOURCE (2013/previous)
  //    curriculum, not CBC.
  reset();
  {
    await runSuggestAnswer({uid: "u1", inputs: INPUTS, apiKey: "k", geminiKey: "", idempotencyKey: IDK});
    const prompt = calls.claude[0].opts.messages[0].content;
    ok("preserve: prompt names the source (2013/previous) syllabus", /2013 \(previous/i.test(prompt));
    ok("preserve: prompt does NOT reframe it as CBC", !/CBC \(2023\)/.test(prompt));
    ok("preserve: source curriculum recorded on the audit doc", genDocs[IDK].sourceCurriculum === "previous");
    ok("preserve: a CBC question instead names CBC", await (async () => {
      reset();
      await runSuggestAnswer({uid: "u1", inputs: {...INPUTS, curriculum: "cbc"}, apiKey: "k", geminiKey: "", idempotencyKey: IDK});
      return /CBC \(2023\)/.test(calls.claude[0].opts.messages[0].content);
    })());
  }

  // 3. FAIL-CLOSED on a missing curriculum — refused before any spend, even on a
  //    direct runner call.
  reset();
  {
    let threw = null;
    try {
      await runSuggestAnswer({uid: "u1", inputs: {...INPUTS, curriculum: ""}, apiKey: "k", geminiKey: "", idempotencyKey: IDK});
    } catch (e) { threw = e; }
    ok("fail-closed: missing curriculum rejected", threw && threw.code === "invalid-argument");
    ok("fail-closed: nothing reserved / charged / called",
      calls.reserve.length === 0 && calls.meter.length === 0 && calls.claude.length === 0);
  }

  // 4. Keyless / malformed key → refused before the provider, nothing spent.
  reset();
  {
    for (const badKey of [undefined, null, "", "not-a-uuid"]) {
      reset();
      let threw = null;
      try { await runSuggestAnswer({uid: "u1", inputs: INPUTS, apiKey: "k", geminiKey: "", idempotencyKey: badKey}); } catch (e) { threw = e; }
      ok(`keyless ${JSON.stringify(badKey)}: refused before spend`,
        threw && threw.code === "invalid-argument" && calls.claude.length === 0 && calls.meter.length === 0);
    }
  }

  // 5. Duplicate completed key → resume without a second provider call / charge.
  reset();
  {
    await runSuggestAnswer({uid: "u1", inputs: INPUTS, apiKey: "k", geminiKey: "", idempotencyKey: IDK});
    const claudeAfter = calls.claude.length; const meterAfter = calls.meter.length;
    const res2 = await runSuggestAnswer({uid: "u1", inputs: INPUTS, apiKey: "k", geminiKey: "", idempotencyKey: IDK});
    ok("resume: no second provider call / charge", calls.claude.length === claudeAfter && calls.meter.length === meterAfter);
    ok("resume: marked resumed with the saved answer", res2.resumed === true && !!res2.answer);
  }

  // 6. Claude throws → refund + fail-op, error rethrown, doc failed.
  reset();
  {
    claudeImpl = async () => { throw new Error("provider down"); };
    let threw = null;
    try { await runSuggestAnswer({uid: "u1", inputs: INPUTS, apiKey: "k", geminiKey: "", idempotencyKey: IDK}); } catch (e) { threw = e; }
    ok("throw: rethrown", threw && /provider down/.test(threw.message));
    ok("throw: refunded + failed, not completed", calls.refund.length === 1 && calls.fail.length === 1 && calls.complete.length === 0);
    ok("throw: doc marked failed", genDocs[IDK].status === "failed");
  }

  // 7. Gemini-vision path: an image question routes to Gemini, and the directive
  //    still pins the source curriculum on that path.
  reset();
  {
    const res = await runSuggestAnswer({
      uid: "u1", inputs: {...INPUTS, imageUrl: "https://x/y.png"},
      apiKey: "k", geminiKey: "gkey", idempotencyKey: IDK,
    });
    ok("gemini: routed to gemini-vision", res.routedTo === "gemini-vision" && calls.gemini.length === 1);
    ok("gemini: Claude not called when vision succeeds", calls.claude.length === 0);
    ok("gemini: the vision prompt names the source (2013/previous) syllabus",
      /2013 \(previous/i.test(calls.gemini[0].opts.userPrompt));
    ok("gemini: still charged + settled once", calls.meter.length === 1 && calls.complete.length === 1);
  }

  // 8. onCall wrapper: staff threads the key; missing curriculum refused before spend.
  reset();
  {
    const handler = createSuggestAnswer("secret");
    const res = await handler({auth: {uid: "u1", token: {}}, data: {...INPUTS, idempotencyKey: IDK}});
    ok("wrapper: staff gets an answer, key threaded", res.answer && IDK in genDocs);

    reset();
    let threw = null;
    try {
      await handler({auth: {uid: "u1", token: {}}, data: {...INPUTS, curriculum: "", idempotencyKey: IDK}});
    } catch (e) { threw = e; }
    ok("wrapper: missing curriculum refused before any spend",
      threw && threw.code === "invalid-argument" && calls.claude.length === 0 && calls.meter.length === 0);
  }

  // 9. onCall wrapper: non-staff refused.
  reset();
  {
    isStaff = false;
    const handler = createSuggestAnswer("secret");
    let threw = null;
    try { await handler({auth: {uid: "u1", token: {}}, data: INPUTS}); } catch (e) { threw = e; }
    ok("wrapper: non-staff refused with permission-denied", threw && threw.code === "permission-denied");
  }

  Module._load = origLoad;
  console.log(`\nAll suggestAnswer tests passed (${passed} assertions).`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
