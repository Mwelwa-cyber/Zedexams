/**
 * Node test for the reviseLessonSection orchestration (runReviseLessonSection +
 * createReviseLessonSection). A TRANSFORMATION generator — it edits ONE section
 * of an existing lesson plan — so it covers, on top of idempotency + refund:
 *
 *   • Source-curriculum PRESERVATION — the prompt carries the plan's OWN
 *     curriculum (a 2013/previous plan is not edited with CBC framing), and a
 *     request whose curriculum mode is missing/invalid is REFUSED fail-closed
 *     before any spend, in the runner as well as the callable (no direct bypass).
 *     Its curriculum previously DEFAULTED to CBC — the drift this closes.
 *   • Idempotency — reserve/charge/settle-once, resume, keyless refusal.
 *   • AI-006 refund — a provider failure / empty revision refunds + settles.
 *
 * reviseLessonSectionLogic + sourceCurriculum load for real. Covers both the
 * `text` and `list` section kinds.
 *
 * Run: node functions/teacherTools/reviseLessonSectionRunner.test.js
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

const calls = {claude: [], refund: [], meter: [], reserve: [], complete: [], fail: []};
let claudeImpl = async () => ({parsed: {text: "Revised prose section."}, model: "m"});

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

const {runReviseLessonSection, createReviseLessonSection} = require("./reviseLessonSection");
const {sanitizeInputs} = require("./reviseLessonSectionLogic");

const IDK = "11111111-1111-4111-8111-111111111111";
// A PREVIOUS (2013) plan section. The pre-migration prompt hard-coded CBC and
// the mode silently defaulted to CBC.
const RAW = {
  sectionLabel: "Rationale", kind: "text", curriculumMode: "previous",
  current: "This lesson helps pupils understand fractions.",
  modifier: "simpler", instruction: "",
  context: {grade: "G7", subject: "mathematics", topic: "Fractions"},
};
const INPUTS = sanitizeInputs(RAW);

function reset() {
  genDocs = {};
  for (const k of Object.keys(calls)) calls[k].length = 0;
  opStore = new Map();
  isStaff = true;
  claudeImpl = async () => ({parsed: {text: "Revised prose section."}, model: "m"});
}

(async function run() {
  // 1. Valid text → complete, reserved once, charged once, no refund; stored.
  reset();
  {
    const res = await runReviseLessonSection({uid: "u1", inputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("valid: returns the revised text", res.text === "Revised prose section.");
    ok("valid: result doc IS the key + complete", genDocs[IDK] && genDocs[IDK].status === "complete");
    ok("valid: reserved as revise_lesson_section", calls.reserve.length === 1 && calls.reserve[0].operationType === "revise_lesson_section");
    ok("valid: settled once, charged once", calls.complete.length === 1 && calls.meter.length === 1 && calls.meter[0].tool === "revise_lesson_section");
    ok("valid: no refund, not failed", calls.refund.length === 0 && calls.fail.length === 0);
  }

  // 2. CURRICULUM PRESERVED — the prompt carries the SOURCE (2013/previous)
  //    curriculum, not CBC, and uses "pupils" (2013 terminology).
  reset();
  {
    await runReviseLessonSection({uid: "u1", inputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    const prompt = calls.claude[0].opts.messages[0].content;
    ok("preserve: prompt names the source (2013/previous) syllabus", /2013 \(previous/i.test(prompt));
    ok("preserve: prompt does NOT reframe it as CBC", !/CBC \(2023\)/.test(prompt));
    ok("preserve: uses 2013 'pupils' terminology", /pupils/.test(prompt));
    ok("preserve: source curriculum recorded on the audit doc", genDocs[IDK].sourceCurriculum === "previous");
    ok("preserve: a CBC section instead names CBC + 'learners'", await (async () => {
      reset();
      await runReviseLessonSection({uid: "u1", inputs: sanitizeInputs({...RAW, curriculumMode: "cbc"}), apiKey: "k", idempotencyKey: IDK});
      const p = calls.claude[0].opts.messages[0].content;
      return /CBC \(2023\)/.test(p) && /learners/.test(p);
    })());
  }

  // 3. FAIL-CLOSED on a missing/invalid curriculum mode — refused before any
  //    spend, on a DIRECT runner call (the default-to-CBC drift is gone).
  reset();
  {
    let threw = null;
    try {
      await runReviseLessonSection({uid: "u1", inputs: sanitizeInputs({...RAW, curriculumMode: "nope"}), apiKey: "k", idempotencyKey: IDK});
    } catch (e) { threw = e; }
    ok("fail-closed: missing/invalid mode rejected", threw && threw.code === "invalid-argument");
    ok("fail-closed: nothing reserved / charged / called", calls.reserve.length === 0 && calls.meter.length === 0 && calls.claude.length === 0);
  }

  // 4. Keyless / malformed key → refused before the provider, nothing spent.
  reset();
  {
    for (const badKey of [undefined, null, "", "not-a-uuid"]) {
      reset();
      let threw = null;
      try { await runReviseLessonSection({uid: "u1", inputs: INPUTS, apiKey: "k", idempotencyKey: badKey}); } catch (e) { threw = e; }
      ok(`keyless ${JSON.stringify(badKey)}: refused before spend`,
        threw && threw.code === "invalid-argument" && calls.claude.length === 0 && calls.meter.length === 0);
    }
  }

  // 5. Duplicate completed key → resume without a second provider call / charge.
  reset();
  {
    await runReviseLessonSection({uid: "u1", inputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    const claudeAfter = calls.claude.length; const meterAfter = calls.meter.length;
    const res2 = await runReviseLessonSection({uid: "u1", inputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("resume: no second provider call / charge", calls.claude.length === claudeAfter && calls.meter.length === meterAfter);
    ok("resume: marked resumed with the saved text", res2.resumed === true && res2.text === "Revised prose section.");
  }

  // 6. List kind → returns items; a valid list is stored + resumable.
  reset();
  {
    claudeImpl = async () => ({parsed: {items: ["Ask a question.", "Guide the discussion."]}, model: "m"});
    const listInputs = sanitizeInputs({...RAW, kind: "list", current: ["Do a thing."]});
    const res = await runReviseLessonSection({uid: "u1", inputs: listInputs, apiKey: "k", idempotencyKey: IDK});
    ok("list: returns items", Array.isArray(res.items) && res.items.length === 2);
    ok("list: stored + settled once", genDocs[IDK].output && Array.isArray(genDocs[IDK].output.items) && calls.complete.length === 1);
  }

  // 7. Provider throws → refund + fail-op, error rethrown, doc failed.
  reset();
  {
    claudeImpl = async () => { throw new Error("provider down"); };
    let threw = null;
    try { await runReviseLessonSection({uid: "u1", inputs: INPUTS, apiKey: "k", idempotencyKey: IDK}); } catch (e) { threw = e; }
    ok("throw: rethrown", threw && /provider down/.test(threw.message));
    ok("throw: refunded + failed, not completed", calls.refund.length === 1 && calls.fail.length === 1 && calls.complete.length === 0);
    ok("throw: doc marked failed", genDocs[IDK].status === "failed");
  }

  // 8. Empty revision → refunded failure.
  reset();
  {
    claudeImpl = async () => ({parsed: {text: "   "}, model: "m"});
    let threw = null;
    try { await runReviseLessonSection({uid: "u1", inputs: INPUTS, apiKey: "k", idempotencyKey: IDK}); } catch (e) { threw = e; }
    ok("empty: throws internal", threw && threw.code === "internal");
    ok("empty: refunded + failed, not completed", calls.refund.length === 1 && calls.fail.length === 1 && calls.complete.length === 0);
  }

  // 9. onCall wrapper: staff threads the key; missing curriculum refused before spend.
  reset();
  {
    const handler = createReviseLessonSection("secret");
    const res = await handler({auth: {uid: "u1", token: {}}, data: {...RAW, idempotencyKey: IDK}});
    ok("wrapper: staff gets revised text, key threaded", res.text && IDK in genDocs);

    reset();
    let threw = null;
    try {
      await handler({auth: {uid: "u1", token: {}}, data: {...RAW, curriculumMode: "", idempotencyKey: IDK}});
    } catch (e) { threw = e; }
    ok("wrapper: missing curriculum refused before any spend",
      threw && threw.code === "invalid-argument" && calls.claude.length === 0 && calls.meter.length === 0);
  }

  // 10. onCall wrapper: non-staff refused.
  reset();
  {
    isStaff = false;
    const handler = createReviseLessonSection("secret");
    let threw = null;
    try { await handler({auth: {uid: "u1", token: {}}, data: RAW}); } catch (e) { threw = e; }
    ok("wrapper: non-staff refused with permission-denied", threw && threw.code === "permission-denied");
  }

  Module._load = origLoad;
  console.log(`\nAll reviseLessonSection runner tests passed (${passed} assertions).`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
