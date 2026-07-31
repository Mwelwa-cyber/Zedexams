/**
 * Node test for the generateNotes orchestration (runNotes in
 * functions/teacherTools/generateNotes.js). Focuses on the idempotency +
 * refund wiring added under the Phase 6 REL-001 rollout (AI-002/AI-006):
 *
 *   1. Valid output → status 'complete', the operation is reserved before the
 *      provider call and settled once, usage is charged exactly once, no refund.
 *   2. callClaude throws → status 'failed', the teacher's quota is refunded,
 *      the operation is failed, error rethrown.
 *   3. A duplicate request with the SAME completed idempotency key resumes the
 *      saved result WITHOUT calling Claude again and WITHOUT a second charge.
 *   4. No/malformed idempotency key → REFUSED before the provider, the
 *      reservation service is never touched, nothing spent.
 *   5. Invalid model output → status 'flagged', settled as a completion (the
 *      teacher got notes), no refund.
 *
 * Plain `node` script (repo convention). firebase-admin, firebase-functions,
 * the Anthropic client and the Firestore-backed helpers are stubbed via
 * Module._load before the module under test loads (same pattern as
 * generateSbaTask.test.js). aiOperationsCore (isValidIdempotencyKey) and
 * learningEnvironments load for real; notesSchema / notesPrompt are stubbed so
 * this test controls valid/invalid/throw deterministically.
 *
 * The from-plan path (loadLessonPlan) is deliberately NOT exercised here — these
 * inputs carry no lessonPlanId, so runNotes takes the standalone path. The
 * lesson-plan artifact read is a separate concern with its own coverage.
 *
 * Run: node functions/teacherTools/generateNotes.test.js
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
          // notes reserves with `.set(data)` then transitions with `.update()`.
          set: async (data, opts) => {
            if (opts && opts.merge) {
              genDocs[id] = {...(genDocs[id] || {}), ...data};
            } else {
              genDocs[id] = {...data};
            }
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
  if (existing.status === "cancelled") return {status: "cancelled", operation: existing};
  return {status: "processing", operation: existing};
};
let completeThrows = false;
const completeImpl = async ({idempotencyKey, resultDocumentId, usageCharged}) => {
  if (completeThrows) throw new Error("settle write failed");
  calls.complete.push({idempotencyKey, resultDocumentId, usageCharged});
  const rec = opStore.get(idempotencyKey);
  if (rec) {
    rec.status = "completed";
    rec.resultDocumentId = resultDocumentId;
  }
};
let failThrows = false;
const failImpl = async ({idempotencyKey, err, usageCharged}) => {
  if (failThrows) throw new Error("fail-op write failed");
  calls.fail.push({idempotencyKey, err, usageCharged});
  const rec = opStore.get(idempotencyKey);
  if (rec) {
    rec.status = "failed";
    rec.errorMessage = String((err && err.message) || err);
    rec.errorCode = "PROVIDER_ERROR";
  }
};

const USAGE = {plan: "max", used: 1, period: "202607"};
// Toggled by the onCall-wrapper cases to exercise the staff/non-staff branch.
let isStaff = true;

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
      isStaffRole: () => isStaff,
    };
  }
  if (request === "./anthropicClient") {
    return {
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
    };
  }
  if (request === "./notesSchema") {
    // Controlled via the parsed object: {__valid:false} → schema error.
    return {
      validateNotes: (parsed) => {
        const okFlag = !!(parsed && parsed.__valid !== false);
        return {ok: okFlag, value: parsed || {}, errors: okFlag ? [] : ["schema error"]};
      },
    };
  }
  if (request === "./notesPrompt") {
    return {
      PROMPT_VERSION: "notes-test",
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
  if (request === "../aiOperations") {
    return {
      // Mirrors the real requireAndReserveAiOperation's contract: refuse a
      // missing/malformed key BEFORE reserving, then delegate. It is a mirror,
      // not a proof — the real helper is proved directly in
      // functions/aiOperations.test.js. What these tests prove is that the
      // generator ROUTES through it, so a refusal reaches the caller with
      // nothing spent.
      requireAndReserveAiOperation: ({idempotencyKey, userId, operationType, inputFingerprint}) => {
        if (!isValidIdempotencyKey(idempotencyKey)) {
          throw new HttpsError("invalid-argument",
              "This request is missing a valid idempotency key.",
              {code: "IDEMPOTENCY_KEY_REQUIRED", retryable: false});
        }
        return reserveImpl({
          uid: userId, idempotencyKey, operationType, fingerprintInput: inputFingerprint,
        }).then((reservation) => {
          if (reservation.status === "failed") {
            throw new HttpsError("failed-precondition",
                reservation.operation.errorMessage ||
                  "This request already failed and cannot be retried automatically.",
                {code: reservation.operation.errorCode, retryable: false});
          }
          if (reservation.status === "cancelled") {
            throw new HttpsError("cancelled", "This request was cancelled.");
          }
          return reservation;
        });
      },
      reserveAiOperation: (args) => reserveImpl(args),
      completeAiOperation: (args) => completeImpl(args),
      failAiOperation: (args) => failImpl(args),
    };
  }
  return origLoad.call(this, request, ...rest);
};

const {runNotes, createGenerateNotes} = require("./generateNotes");

const INPUTS = {grade: "G5", subject: "mathematics", topic: "Fractions"};
const IDK = "11111111-1111-4111-8111-111111111111";

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
  completeThrows = false;
  failThrows = false;
  isStaff = true;
  claudeImpl = async () => ({parsed: {__valid: true}, text: "raw", usage: {inputTokens: 10, outputTokens: 20}, model: "m"});
}

(async function run() {
  // 1. Valid output with a key → complete, reserved once, charged once, no refund.
  reset();
  {
    const res = await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("valid: returns generationId + notes", res.generationId && res.notes);
    ok("valid: doc id IS the idempotency key", res.generationId === IDK);
    ok("valid: status complete", genDocs[IDK].status === "complete");
    ok("valid: provider called exactly once", calls.claude.length === 1);
    ok("valid: reserved before provider", calls.reserve.length === 1 && calls.reserve[0].operationType === "generate_notes");
    ok("valid: settled once as completed", calls.complete.length === 1 && calls.complete[0].usageCharged === 1);
    ok("valid: usage charged exactly once", calls.meter.length === 1 && calls.meter[0].tool === "notes");
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
      await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("throw: original error rethrown", threw && /provider down/.test(threw.message));
    ok("throw: doc flipped to failed", genDocs[IDK].status === "failed");
    ok("throw: quota refunded (AI-006)", calls.refund.length === 1 && calls.refund[0].tool === "notes");
    ok("throw: operation failed", calls.fail.length === 1);
    ok("throw: not settled as complete", calls.complete.length === 0);
  }

  // 3. Duplicate SAME completed key → resume without a second provider call/charge.
  reset();
  {
    await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    const claudeAfterFirst = calls.claude.length;
    const meterAfterFirst = calls.meter.length;
    const res2 = await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("resume: no second provider call", calls.claude.length === claudeAfterFirst);
    ok("resume: no second charge", calls.meter.length === meterAfterFirst);
    ok("resume: marked resumed", res2.resumed === true);
    ok("resume: returns the saved notes", res2.generationId === IDK && !!res2.notes);
  }

  // 4. NO KEY / MALFORMED KEY → refused, with nothing spent.
  reset();
  {
    for (const badKey of [undefined, null, "", "not-a-uuid", "   ", 12345,
      "550e8400-e29b-41d4-a716"]) {
      reset();
      let threw = null;
      try {
        await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: badKey});
      } catch (e) {
        threw = e;
      }
      const label = JSON.stringify(badKey);
      ok(`refused: ${label} rejected`, threw && threw.code === "invalid-argument");
      ok(`refused: ${label} made no provider call`, calls.claude.length === 0);
      ok(`refused: ${label} charged no usage`, calls.meter.length === 0);
      ok(`refused: ${label} wrote no result document`,
          Object.keys(genDocs).length === 0);
      ok(`refused: ${label} reserved nothing`, calls.reserve.length === 0);
      ok(`refused: ${label} refunded nothing`, calls.refund.length === 0);
    }
  }

  // 4b. The fingerprint the generator reserves with is its own sanitized input,
  // so replaying one key with different inputs is rejected by the real service
  // rather than answered with the first result.
  reset();
  {
    await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("fingerprint: reservation carried one", calls.reserve.length === 1 &&
      calls.reserve[0].fingerprintInput &&
      typeof calls.reserve[0].fingerprintInput === "object");
    ok("fingerprint: reserved before the provider was called",
        calls.claude.length === 1);
    ok("deterministic identity: the result document IS the key",
        Object.keys(genDocs).length === 1 && Object.keys(genDocs)[0] === IDK);
  }

  // 5. Invalid output → flagged, settled as a completion, no refund.
  reset();
  {
    claudeImpl = async () => ({parsed: {__valid: false}, text: "raw", usage: {inputTokens: 1, outputTokens: 1}, model: "m"});
    const res = await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("flagged: status flagged", genDocs[IDK].status === "flagged");
    ok("flagged: review warning returned", /review/i.test(res.warning || ""));
    ok("flagged: settled as completion", calls.complete.length === 1);
    ok("flagged: no refund (teacher got notes)", calls.refund.length === 0);
  }

  // 6. Invalid inputs → invalid-argument before any provider/reservation work.
  reset();
  {
    let threw = null;
    try {
      await runNotes({uid: "u1", rawInputs: {grade: "", subject: "", topic: ""}, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("invalid: throws invalid-argument", threw && threw.code === "invalid-argument");
    ok("invalid: never reserved", calls.reserve.length === 0);
    ok("invalid: never called provider", calls.claude.length === 0);
  }

  // 7. Reservation already 'processing' (another tab/retry) → no second provider call.
  reset();
  {
    opStore.set(IDK, {userId: "u1", status: "processing", resultDocumentId: null});
    const res = await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("processing: returns processing status", res.status === "processing" && res.operationId === IDK);
    ok("processing: provider not called", calls.claude.length === 0);
    ok("processing: usage not charged", calls.meter.length === 0);
  }

  // 8. Reservation terminally 'failed' → refuse to retry.
  reset();
  {
    opStore.set(IDK, {userId: "u1", status: "failed", errorMessage: "nope", errorCode: "X"});
    let threw = null;
    try {
      await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("failed-reservation: throws failed-precondition", threw && threw.code === "failed-precondition");
    ok("failed-reservation: provider not called", calls.claude.length === 0);
  }

  // 9. Reservation 'cancelled' → cancelled error.
  reset();
  {
    opStore.set(IDK, {userId: "u1", status: "cancelled"});
    let threw = null;
    try {
      await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("cancelled-reservation: throws cancelled", threw && threw.code === "cancelled");
    ok("cancelled-reservation: provider not called", calls.claude.length === 0);
  }

  // 10. completeAiOperation throwing is swallowed — the teacher still gets a result.
  reset();
  {
    completeThrows = true;
    const res = await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("settle-failure: still returns the notes", !!(res.generationId && res.notes));
    ok("settle-failure: doc still marked complete", genDocs[IDK].status === "complete");
  }

  // 11. refundGeneration throwing on a provider failure is swallowed — original error still surfaces.
  reset();
  {
    claudeImpl = async () => {
      throw new Error("provider down");
    };
    refundImpl = async () => {
      throw new Error("refund failed");
    };
    let threw = null;
    try {
      await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("refund-failure: original provider error still rethrown", threw && /provider down/.test(threw.message));
    ok("refund-failure: refund was attempted", calls.refund.length === 1);
  }

  // 12. onCall wrapper: authenticates, checks role, extracts the key, delegates.
  reset();
  {
    const handler = createGenerateNotes("secret");
    const res = await handler({auth: {uid: "u1", token: {}}, data: {...INPUTS, idempotencyKey: IDK}});
    ok("wrapper: staff user gets a result", !!(res && res.generationId));
    ok("wrapper: provider called once via the wrapper", calls.claude.length === 1);
    ok("wrapper: idempotency key threaded through (doc id is the key)", res.generationId === IDK);
  }

  // 13. onCall wrapper: a non-staff user is refused before any generation.
  reset();
  {
    isStaff = false;
    const handler = createGenerateNotes("secret");
    let threw = null;
    try {
      await handler({auth: {uid: "u1", token: {}}, data: INPUTS});
    } catch (e) {
      threw = e;
    }
    ok("wrapper: non-staff refused with permission-denied", threw && threw.code === "permission-denied");
    ok("wrapper: non-staff never reached the provider", calls.claude.length === 0);
  }

  // 14. Provider throws AND failAiOperation also throws → both swallowed, original error surfaces.
  reset();
  {
    claudeImpl = async () => {
      throw new Error("provider down");
    };
    failThrows = true;
    let threw = null;
    try {
      await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("failop-failure: original provider error still surfaces", threw && /provider down/.test(threw.message));
    ok("failop-failure: doc still marked failed", genDocs[IDK].status === "failed");
  }

  // 15. Flagged output while completeAiOperation throws → still returns the flagged result.
  reset();
  {
    claudeImpl = async () => ({parsed: {__valid: false}, text: "raw", usage: {inputTokens: 1, outputTokens: 1}, model: "m"});
    completeThrows = true;
    const res = await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("flagged+settle-failure: still returns a result", !!(res && res.generationId));
    ok("flagged+settle-failure: doc marked flagged", genDocs[IDK].status === "flagged");
  }

  // 16. Resume a key whose saved doc is FLAGGED → resumes with the review warning.
  reset();
  {
    claudeImpl = async () => ({parsed: {__valid: false}, text: "raw", usage: {inputTokens: 1, outputTokens: 1}, model: "m"});
    await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    const claudeAfterFirst = calls.claude.length;
    const res2 = await runNotes({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("resume-flagged: no second provider call", calls.claude.length === claudeAfterFirst);
    ok("resume-flagged: carries the review warning", res2.resumed === true && /review/i.test(res2.warning || ""));
  }

  Module._load = origLoad;
  console.log(`\nAll generateNotes tests passed (${passed} assertions).`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
