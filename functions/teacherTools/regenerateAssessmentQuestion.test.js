/**
 * Node test for the regenerateAssessmentQuestion orchestration
 * (runRegenerateQuestion). Focuses on the Phase 6 REL-001 idempotency + refund
 * wiring, adapted for an INLINE-return generator:
 *
 *   1. Valid output → the operation is reserved before the provider call and
 *      settled once, usage charged once, no refund, and the question is
 *      persisted to aiGenerations/{idempotencyKey} purely so a duplicate can
 *      resume it.
 *   2. callClaude throws → refund + failAiOperation, error rethrown.
 *   3. A duplicate SAME completed key resumes the saved question WITHOUT a
 *      second provider call or charge.
 *   4. No/malformed idempotency key → REFUSED before the provider, nothing spent.
 *   5. Invalid model output → this generator treats it as a FAILURE (refund +
 *      failAiOperation + throw), NOT a billable completion — a bad rewrite must
 *      leave the paper and the quota exactly as they were.
 *
 * Plain `node` script (repo convention). Everything the runner pulls in is
 * stubbed via Module._load; aiOperationsCore (isValidIdempotencyKey) loads for
 * real. regenerateQuestionCore is stubbed so this test controls
 * valid/invalid/throw deterministically (its own logic is tested separately in
 * regenerateQuestionCore.test.js).
 *
 * Run: node functions/teacherTools/regenerateAssessmentQuestion.test.js
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
          set: async (data, opts) => {
            if (opts && opts.merge) {
              genDocs[id] = {...(genDocs[id] || {}), ...data};
            } else {
              genDocs[id] = {...data};
            }
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
firestoreFn.FieldValue = {serverTimestamp: () => SERVER_TS};

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const calls = {claude: [], refund: [], meter: [], reserve: [], complete: [], fail: []};
let claudeImpl = async () => ({parsed: {__valid: true}, model: "m"});
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
let isStaff = true;
// Controls the regenerateQuestionCore stubs.
let inputsValid = true;
let extractOk = true;

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
    return {
      callClaude: (apiKey, opts) => {
        calls.claude.push({apiKey, opts});
        return claudeImpl(apiKey, opts);
      },
    };
  }
  if (request === "./cbcKnowledge") {
    return {resolveCbcContext: async () => ({contextBlock: "CBC CONTEXT"})};
  }
  if (request === "./assessmentSchema") {
    return {validateAssessment: () => ({ok: true})};
  }
  if (request === "./assessmentPromptV10") {
    return {SYSTEM_PROMPT: "SYSTEM"};
  }
  if (request === "./assessmentBands") {
    // null band → the band gate is skipped, keeping the happy path focused on
    // the idempotency wiring (the gate has its own coverage).
    return {bandForGrade: async () => null, bandPermitsActivity: () => true};
  }
  if (request === "./assessmentLabels") {
    return {gradeLabelFor: () => "Grade 5", subjectLabelFor: () => "Mathematics"};
  }
  if (request === "./misconceptions") {
    return {buildMisconceptionContext: async () => ""};
  }
  if (request === "./regenerateQuestionCore") {
    return {
      sanitizeRegenerateInputs: (raw) => ({
        grade: raw.grade, subject: raw.subject, framework: raw.framework,
        assessmentType: raw.assessmentType, currentText: raw.currentText,
        avoid: raw.avoid || [], slot: raw.slot,
      }),
      validateRegenerateInputs: () => (inputsValid ? [] : ["Please choose a question to rewrite."]),
      buildRegeneratePrompt: () => "USER",
      extractSingleQuestion: () => (extractOk ?
        {ok: true, question: {id: "q1", text: "new question", marks: 2}} :
        {ok: false, errors: ["schema error"]}),
      QUESTION_TOOL_SCHEMA: {type: "object"},
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
                reservation.operation.errorMessage || "already failed",
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

const {runRegenerateQuestion, createRegenerateAssessmentQuestion} =
  require("./regenerateAssessmentQuestion");

const INPUTS = {
  grade: "G5", subject: "mathematics", framework: "2023",
  assessmentType: "topic_test", currentText: "old text", avoid: [],
  slot: {topic: "Fractions", marks: 2, activityType: "mcq"},
};
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
  inputsValid = true;
  extractOk = true;
  claudeImpl = async () => ({parsed: {__valid: true}, model: "m"});
}

(async function run() {
  // 1. Valid → complete, reserved once, charged once, no refund; question inline.
  reset();
  {
    const res = await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("valid: returns the question + slot", res.question && res.slot);
    ok("valid: result doc IS the idempotency key", IDK in genDocs && genDocs[IDK].status === "complete");
    ok("valid: doc stores the question for resume", genDocs[IDK].output && genDocs[IDK].output.question);
    ok("valid: provider called exactly once", calls.claude.length === 1);
    ok("valid: reserved before provider", calls.reserve.length === 1 && calls.reserve[0].operationType === "regenerate_assessment_question");
    ok("valid: settled once as completed", calls.complete.length === 1 && calls.complete[0].usageCharged === 1);
    ok("valid: usage charged exactly once", calls.meter.length === 1 && calls.meter[0].tool === "revise_question");
    ok("valid: no refund on success", calls.refund.length === 0);
    ok("valid: not failed", calls.fail.length === 0);
  }

  // 2. Provider throws → doc failed + refund + fail-op, error rethrown.
  reset();
  {
    claudeImpl = async () => {
      throw new Error("provider down");
    };
    let threw = null;
    try {
      await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("throw: original error rethrown", threw && /provider down/.test(threw.message));
    ok("throw: doc flipped to failed", genDocs[IDK].status === "failed");
    ok("throw: quota refunded", calls.refund.length === 1 && calls.refund[0].tool === "revise_question");
    ok("throw: operation failed", calls.fail.length === 1);
    ok("throw: not settled as complete", calls.complete.length === 0);
  }

  // 3. Duplicate SAME completed key → resume without a second provider call/charge.
  reset();
  {
    await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    const claudeAfterFirst = calls.claude.length;
    const meterAfterFirst = calls.meter.length;
    const res2 = await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("resume: no second provider call", calls.claude.length === claudeAfterFirst);
    ok("resume: no second charge", calls.meter.length === meterAfterFirst);
    ok("resume: marked resumed", res2.resumed === true);
    ok("resume: returns the saved question + slot", !!(res2.question && res2.slot));
  }

  // 4. NO KEY / MALFORMED KEY → refused, nothing spent.
  reset();
  {
    for (const badKey of [undefined, null, "", "not-a-uuid", "   ", 12345,
      "550e8400-e29b-41d4-a716"]) {
      reset();
      let threw = null;
      try {
        await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: badKey});
      } catch (e) {
        threw = e;
      }
      const label = JSON.stringify(badKey);
      ok(`refused: ${label} rejected`, threw && threw.code === "invalid-argument");
      ok(`refused: ${label} made no provider call`, calls.claude.length === 0);
      ok(`refused: ${label} charged no usage`, calls.meter.length === 0);
      ok(`refused: ${label} wrote no result document`, Object.keys(genDocs).length === 0);
      ok(`refused: ${label} reserved nothing`, calls.reserve.length === 0);
      ok(`refused: ${label} refunded nothing`, calls.refund.length === 0);
    }
  }

  // 4b. Fingerprint carried; the result document IS the key.
  reset();
  {
    await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("fingerprint: reservation carried one", calls.reserve.length === 1 &&
      calls.reserve[0].fingerprintInput && typeof calls.reserve[0].fingerprintInput === "object");
    ok("deterministic identity: the result document IS the key",
        Object.keys(genDocs).length === 1 && Object.keys(genDocs)[0] === IDK);
  }

  // 5. Invalid output → FAILURE (refund + fail-op + throw), never a billed completion.
  reset();
  {
    extractOk = false;
    let threw = null;
    try {
      await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("invalid-output: throws internal", threw && threw.code === "internal");
    ok("invalid-output: message says the question is left as-was", /left as it was/i.test(threw.message));
    ok("invalid-output: doc marked failed", genDocs[IDK].status === "failed");
    ok("invalid-output: refunded (not billed for an unusable rewrite)", calls.refund.length === 1);
    ok("invalid-output: operation failed", calls.fail.length === 1);
    ok("invalid-output: NOT settled as complete", calls.complete.length === 0);
  }

  // 6. Invalid inputs → invalid-argument before any provider/reservation work.
  reset();
  {
    inputsValid = false;
    let threw = null;
    try {
      await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("invalid-inputs: throws invalid-argument", threw && threw.code === "invalid-argument");
    ok("invalid-inputs: never reserved", calls.reserve.length === 0);
    ok("invalid-inputs: never called provider", calls.claude.length === 0);
  }

  // 7. Reservation already 'processing' → no second provider call.
  reset();
  {
    opStore.set(IDK, {userId: "u1", status: "processing", resultDocumentId: null});
    const res = await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
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
      await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
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
      await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
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
    const res = await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    ok("settle-failure: still returns the question", !!(res && res.question));
    ok("settle-failure: doc still marked complete", genDocs[IDK].status === "complete");
  }

  // 11. refundGeneration throwing on a provider failure is swallowed.
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
      await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("refund-failure: original provider error still rethrown", threw && /provider down/.test(threw.message));
    ok("refund-failure: refund was attempted", calls.refund.length === 1);
  }

  // 12. onCall wrapper: authenticates, checks role, extracts the key, delegates.
  reset();
  {
    const handler = createRegenerateAssessmentQuestion("secret");
    const res = await handler({auth: {uid: "u1", token: {}}, data: {...INPUTS, idempotencyKey: IDK}});
    ok("wrapper: staff user gets a question", !!(res && res.question));
    ok("wrapper: provider called once via the wrapper", calls.claude.length === 1);
    ok("wrapper: idempotency key threaded through (doc id is the key)", IDK in genDocs);
  }

  // 13. onCall wrapper: a non-staff user is refused before any generation.
  reset();
  {
    isStaff = false;
    const handler = createRegenerateAssessmentQuestion("secret");
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
      await runRegenerateQuestion({uid: "u1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
    } catch (e) {
      threw = e;
    }
    ok("failop-failure: original provider error still surfaces", threw && /provider down/.test(threw.message));
    ok("failop-failure: doc still marked failed", genDocs[IDK].status === "failed");
  }

  Module._load = origLoad;
  console.log(`\nAll regenerateAssessmentQuestion tests passed (${passed} assertions).`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
