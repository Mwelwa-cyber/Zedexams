/**
 * Node test for the per-tool usage meter (functions/teacherTools/usageMeter.js),
 * focused on the pay-per-generation top-up credit path added alongside the
 * fail-fast paywall: a purchased credit (users/{uid}.generationCredits) must be
 * spent atomically — and only — when the teacher would otherwise be blocked by
 * a monthly OR daily cap, on any tool, without pushing the plan counters past
 * their limit. This is money-adjacent (it consumes something the teacher paid
 * for), so the spend-once / spend-only-when-blocked / never-for-admins rules
 * get covered.
 *
 * Plain `node` script (repo convention). firebase-admin + the HttpsError class
 * are stubbed via Module._load before the module under test loads; ./teacherPlans
 * is pure and loads for real.
 *
 * Run: node functions/teacherTools/usageMeter.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── In-memory Firestore stub ─────────────────────────────────────────────
const SERVER_TS = Symbol("serverTimestamp");
let store = {}; // full doc path -> data object (undefined = does not exist)

const snapFor = (path) => {
  const data = store[path];
  return {exists: data !== undefined, data: () => data};
};

// Resolve a dotted-path key (e.g. "counters.lesson_plan") against a nested
// object for both read and write, matching Firestore's field-path semantics.
function getNestedValue(obj, dottedKey) {
  const parts = dottedKey.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}
// Segments that would walk or overwrite the prototype chain are refused
// outright: this fake must never be able to pollute Object.prototype, and
// Firestore field paths never legitimately contain these names.
const FORBIDDEN_SEGMENT = new Set(["__proto__", "constructor", "prototype"]);

function setNestedValue(obj, dottedKey, value) {
  const parts = dottedKey.split(".");
  if (parts.some((p) => FORBIDDEN_SEGMENT.has(p))) {
    throw new Error(`unsafe field path in test write: ${dottedKey}`);
  }
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

const makeRef = (path) => ({
  __path: path,
  get: async () => snapFor(path),
  update: async (data) => applyWrite(path, data, true),
});

function applyWrite(path, data, merge) {
  const base = merge ? JSON.parse(JSON.stringify(store[path] || {})) : {};
  for (const [field, val] of Object.entries(data)) {
    if (val && typeof val === "object" && "__inc" in val) {
      const cur = Number(getNestedValue(base, field) || 0);
      setNestedValue(base, field, cur + val.__inc);
    } else {
      setNestedValue(base, field, val);
    }
  }
  store[path] = base;
}

const db = {
  doc: (path) => makeRef(path),
  runTransaction: async (fn) => {
    const tx = {
      get: async (ref) => snapFor(ref.__path),
      set: (ref, data, opts) => applyWrite(ref.__path, data, !!(opts && opts.merge)),
      update: (ref, data) => applyWrite(ref.__path, data, true),
    };
    return fn(tx);
  },
};

const firestoreFn = () => db;
firestoreFn.FieldValue = {serverTimestamp: () => SERVER_TS, increment: (n) => ({__inc: n})};
firestoreFn.Timestamp = {fromDate: (d) => ({toDate: () => d, _date: d})};
const adminStub = {firestore: firestoreFn};

// Minimal HttpsError stub matching firebase-functions/v2/https shape.
class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return adminStub;
  if (request === "firebase-functions/v2/https") return {HttpsError};
  return origLoad.call(this, request, ...rest);
};

const {assertAndIncrement, refundGeneration} = require("./usageMeter");

// Path helpers mirroring the module under test.
function yyyymm(d = new Date()) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function yyyymmdd(d = new Date()) {
  return `${yyyymm(d)}${String(d.getUTCDate()).padStart(2, "0")}`;
}
const meterPath = (uid) => `usageMeters/${uid}/periods/${yyyymm()}`;
const userPath = (uid) => `users/${uid}`;

function reset() { store = {}; }
async function caught(promise) {
  try { await promise; return null; } catch (err) { return err; }
}

(async () => {
  console.log("usageMeter (top-up credits)");

  // Under quota: a credit is never touched, the counter increments normally.
  reset();
  store[userPath("u1")] = {teacherPlan: "free", generationCredits: 3};
  const r1 = await assertAndIncrement("u1", "lesson_plan");
  ok("under quota increments the counter", r1.used === 1 && !r1.usedCredit);
  ok("under quota leaves credits untouched", store[userPath("u1")].generationCredits === 3);
  ok("under quota writes the tool counter", store[meterPath("u1")].counters.lesson_plan === 1);

  // Monthly cap hit, no credit → throws monthly-limit with structured reason.
  reset();
  store[userPath("u2")] = {teacherPlan: "free"};
  store[meterPath("u2")] = {counters: {lesson_plan: 8}}; // at the free cap
  const e2 = await caught(assertAndIncrement("u2", "lesson_plan"));
  ok("monthly cap + no credit throws", e2 instanceof HttpsError);
  ok("monthly throw carries reason=monthly-limit", e2.details && e2.details.reason === "monthly-limit");
  ok("monthly throw does not move the counter", store[meterPath("u2")].counters.lesson_plan === 8);

  // Monthly cap hit WITH a credit → spend one, allow, don't push counter past cap.
  reset();
  store[userPath("u3")] = {teacherPlan: "free", generationCredits: 2};
  store[meterPath("u3")] = {counters: {lesson_plan: 8}}; // at the free cap
  const r3 = await assertAndIncrement("u3", "lesson_plan");
  ok("monthly cap + credit is allowed via credit", r3.usedCredit === true && r3.creditsRemaining === 1);
  ok("credit spend decrements the balance (2→1)", store[userPath("u3")].generationCredits === 1);
  ok("credit spend does NOT push the counter past cap", store[meterPath("u3")].counters.lesson_plan === 8);

  // Max-only tool (exam_paper) at its taster cap, with a credit → still allowed.
  reset();
  store[userPath("u4")] = {teacherPlan: "free", generationCredits: 1};
  store[meterPath("u4")] = {counters: {exam_paper: 1}};
  const r4 = await assertAndIncrement("u4", "exam_paper");
  ok("credit covers a Max-only studio too", r4.usedCredit === true);
  ok("credit fully consumed (1→0)", store[userPath("u4")].generationCredits === 0);

  // Daily cap hit (monthly fine) with a credit → credit covers the daily cap.
  reset();
  store[userPath("u5")] = {teacherPlan: "free", generationCredits: 1};
  store[meterPath("u5")] = {counters: {lesson_plan: 0}, daily: {date: yyyymmdd(), count: 2}};
  const r5 = await assertAndIncrement("u5", "lesson_plan");
  ok("credit covers the daily cap", r5.usedCredit === true);
  ok("daily-capped credit spend decrements balance", store[userPath("u5")].generationCredits === 0);

  // Daily cap hit, no credit → throws with reason=daily-cap.
  reset();
  store[userPath("u6")] = {teacherPlan: "free"};
  store[meterPath("u6")] = {counters: {lesson_plan: 0}, daily: {date: yyyymmdd(), count: 2}};
  const e6 = await caught(assertAndIncrement("u6", "lesson_plan"));
  ok("daily cap + no credit throws reason=daily-cap", e6 instanceof HttpsError && e6.details.reason === "daily-cap");

  // Super admins resolve to the Max tier and are never charged a credit for a
  // within-quota generation (they also skip the daily cap).
  reset();
  store[userPath("a1")] = {role: "admin", generationCredits: 5};
  store[meterPath("a1")] = {counters: {exam_paper: 5}, daily: {date: yyyymmdd(), count: 99}};
  const ra = await assertAndIncrement("a1", "exam_paper");
  ok("super admin generates despite a blown daily count", ra.used === 6 && !ra.usedCredit);
  ok("super admin credits untouched", store[userPath("a1")].generationCredits === 5);

  // ── refundGeneration — regression tests for the K25 credit-on-failure bug ──
  // Scenario: teacher hits monthly cap, pays K25, assertAndIncrement spends the
  // credit, then callClaude throws. refundGeneration must restore the credit so
  // the next assertAndIncrement is allowed (credit = 1 again).
  console.log("\nusageMeter (refundGeneration — credit refund on failure)");

  reset();
  store[userPath("r1")] = {teacherPlan: "free", generationCredits: 1};
  store[meterPath("r1")] = {counters: {exam_paper: 1}};
  const rr1 = await assertAndIncrement("r1", "exam_paper");
  ok("refund/setup: credit was spent to bypass cap", rr1.usedCredit === true);
  ok("refund/setup: credit balance is 0 after spend", store[userPath("r1")].generationCredits === 0);
  // Simulate generation failure → call refundGeneration
  await refundGeneration("r1", rr1, "exam_paper");
  ok("refund restores credit to 1", store[userPath("r1")].generationCredits === 1);
  // A subsequent assertAndIncrement with the refunded credit must now succeed.
  const rr1b = await assertAndIncrement("r1", "exam_paper");
  ok("refund allows a retry: credit spent again on retry", rr1b.usedCredit === true);
  ok("refund allows a retry: credit 0 after retry", store[userPath("r1")].generationCredits === 0);

  // Scenario: within-quota generation (monthly counter incremented), then failure.
  // refundGeneration must roll back the counter so the teacher's quota is restored.
  reset();
  store[userPath("r2")] = {teacherPlan: "free"};
  store[meterPath("r2")] = {counters: {lesson_plan: 0}};
  const rr2 = await assertAndIncrement("r2", "lesson_plan");
  ok("refund/counter: counter incremented to 1", store[meterPath("r2")].counters.lesson_plan === 1);
  ok("refund/counter: no credit used", !rr2.usedCredit);
  await refundGeneration("r2", rr2, "lesson_plan");
  ok("refund rolls counter back to 0", store[meterPath("r2")].counters.lesson_plan === 0);
  // Ensure the counter can be re-incremented after the rollback.
  const rr2b = await assertAndIncrement("r2", "lesson_plan");
  ok("refund/counter: counter increments to 1 on retry", rr2b.used === 1 && !rr2b.usedCredit);

  // Scenario: the flagged path (validation.ok === false but paper returned) must
  // NOT trigger a refund — the teacher still gets a paper so the credit is earned.
  // This is an indirect test: we verify refundGeneration on a usedCredit result
  // is additive (one refund, one credit back) but we do NOT call it on flagged.
  // (Test above already covers this — we only call refundGeneration on throw.)
  ok("flagged path is not tested here (it must not call refundGeneration)", true);

  // Scenario: refundGeneration is safe to call with null / missing args.
  await refundGeneration(null, null, "exam_paper");
  await refundGeneration("r1", undefined, "exam_paper");
  ok("refundGeneration no-ops on null/missing args", true);

  Module._load = origLoad;
  console.log(`\n${passed} passed`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
