/**
 * Node test for functions/teacherTrial/existingTeacherOffer.js — the
 * Firestore-transaction shim around teacherTrialCore's pure activation
 * decision. Same in-memory Firestore stub + Module._load interception
 * convention as functions/aiOperations.test.js (functions/node_modules —
 * and firebase-admin — does not exist in CI's `npm ci` at the repo root).
 *
 * The stub's `runTransaction` serialises concurrent calls (a FIFO queue) so
 * the "two simultaneous requests" test asserts the SECOND transaction only
 * ever sees the FIRST one's already-committed write — the same guarantee
 * real Firestore gives via optimistic-concurrency retries, without the
 * emulator.
 *
 * Run: node functions/teacherTrial/existingTeacherOffer.test.js
 */

"use strict";

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok — ${name}`);
}
async function rejects(name, fn, match) {
  try {
    await fn();
    assert.fail(`expected ${name} to throw`);
  } catch (err) {
    if (match) assert.ok(match(err), `${name}: error did not match — ${err && err.message}`);
    passed += 1;
    console.log(`  ok — ${name}`);
  }
}

// ── In-memory Firestore stub, serialised transactions ──────────────────────
let store = {};
let queue = Promise.resolve();
let auditWrites = [];

const k = (col, id) => `${col}/${id}`;
const snapFor = (col, id) => {
  const data = store[k(col, id)];
  return {exists: data !== undefined, id, data: () => data};
};

function applyUpdate(col, id, data) {
  const key = k(col, id);
  store[key] = {...(store[key] || {}), ...data};
}

const db = {
  collection: (col) => ({
    doc: (id) => ({__col: col, __id: id}),
    add: async (data) => {
      auditWrites.push(data);
      return {id: `audit_${auditWrites.length}`};
    },
  }),
  // Each transaction body runs to completion before the next starts —
  // mirrors Firestore's guarantee that two transactions never interleave
  // their commits on the same doc, without needing real optimistic retry.
  runTransaction: (fn) => {
    const run = () => {
      const writes = [];
      const tx = {
        get: async (ref) => snapFor(ref.__col, ref.__id),
        update: (ref, data) => {
          writes.push(() => applyUpdate(ref.__col, ref.__id, data));
        },
      };
      return Promise.resolve(fn(tx)).then((result) => {
        writes.forEach((w) => w());
        return result;
      });
    };
    const result = queue.then(run, run);
    queue = result.then(() => {}, () => {});
    return result;
  },
};

const SERVER_TS = "SERVER_TIMESTAMP";
const firestoreFn = () => db;
firestoreFn.FieldValue = {serverTimestamp: () => SERVER_TS};
firestoreFn.Timestamp = {fromMillis: (ms) => ({__ms: ms, toMillis: () => ms})};

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

let capturedHandler = null;
function onCall(_opts, handler) {
  capturedHandler = handler;
  return handler;
}

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return {firestore: firestoreFn};
  if (request === "firebase-functions/v2/https") return {onCall, HttpsError};
  if (request === "../authGuard") {
    return {
      assertVerifiedAuth: async (request2) => {
        if (!request2.auth || !request2.auth.uid) throw new HttpsError("unauthenticated", "Please sign in first.");
        return request2.auth.uid;
      },
    };
  }
  if (request === "../auditLog") {
    return {
      writeAuditLog: async (fields) => {
        auditWrites.push(fields);
        return {written: true};
      },
    };
  }
  return origLoad.call(this, request, ...rest);
};

// NOT restored here — existingTeacherOffer.js requires "../authGuard" and
// "../auditLog" LAZILY, inside the handler body, so the mock must still be
// active on every call, not just at require-time. Restored at the very end.
const {activateExistingTeacherTrialOffer} = require("./existingTeacherOffer");

async function main() {
  const NOW_MS = Date.parse("2026-09-03T09:00:00Z");
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ── unauthenticated ──────────────────────────────────────────────────
  await rejects(
      "no auth throws unauthenticated",
      () => activateExistingTeacherTrialOffer({auth: null, data: {}}),
      (e) => e.code === "unauthenticated",
  );

  // ── eligible teacher ─────────────────────────────────────────────────
  store = {"users/t1": {role: "teacher"}};
  auditWrites = [];
  {
    const before = Date.now();
    const res = await activateExistingTeacherTrialOffer({auth: {uid: "t1"}, data: {}});
    const after = Date.now();
    ok("grants the trial", res.ok === true && res.alreadyActive === false);
    ok("teacherPlan is written as trial", store["users/t1"].teacherPlan === "trial");
    ok(
        "expiry is ~7 days out, computed server-side (not from any client input)",
        res.teacherTrialEndsAtMs >= before + 7 * DAY_MS && res.teacherTrialEndsAtMs <= after + 7 * DAY_MS,
    );
    ok("teacherTrialOffer is written with status active + the offer source", (() => {
      const offer = store["users/t1"].teacherTrialOffer;
      return offer && offer.status === "active" && offer.source === "existing_teacher_offer";
    })());
    ok("an audit record was written for a real grant", auditWrites.some((w) => w.action === "existing_teacher_trial_activated"));
  }

  // ── idempotency: repeated taps / retried transactions ────────────────
  {
    const firstExpiry = store["users/t1"].teacherTrialEndsAt.toMillis();
    const [a, b] = await Promise.all([
      activateExistingTeacherTrialOffer({auth: {uid: "t1"}, data: {}}),
      activateExistingTeacherTrialOffer({auth: {uid: "t1"}, data: {}}),
    ]);
    ok("both concurrent re-taps report already active", a.alreadyActive === true && b.alreadyActive === true);
    ok("neither re-tap changed the recorded expiry", a.teacherTrialEndsAtMs === firstExpiry && b.teacherTrialEndsAtMs === firstExpiry);
    ok("the stored expiry itself is unchanged", store["users/t1"].teacherTrialEndsAt.toMillis() === firstExpiry);
  }

  // ── ineligible: never had a profile ──────────────────────────────────
  store = {};
  await rejects(
      "missing user doc is refused, never granted",
      () => activateExistingTeacherTrialOffer({auth: {uid: "ghost"}, data: {}}),
      (e) => e.code === "failed-precondition",
  );
  ok("nothing was written for the missing profile", store["users/ghost"] === undefined);

  // ── ineligible: already used a trial ─────────────────────────────────
  store = {"users/t2": {role: "teacher", teacherTrialStartedAt: {toDate: () => new Date(NOW_MS - DAY_MS)}}};
  await rejects(
      "a teacher who already had a trial is refused",
      () => activateExistingTeacherTrialOffer({auth: {uid: "t2"}, data: {}}),
      (e) => e.code === "failed-precondition" && e.details.reason === "trial-already-used",
  );
  ok("teacherPlan was never touched for the refused teacher", store["users/t2"].teacherPlan === undefined);

  // ── ineligible: paying subscriber is unaffected ──────────────────────
  store = {
    "users/t3": {
      role: "teacher", teacherPlan: "pro",
      teacherPlanActivatedAt: {toDate: () => new Date(NOW_MS - 30 * DAY_MS)},
      teacherPlanExpiresAt: {toDate: () => new Date(NOW_MS + 10 * DAY_MS)},
    },
  };
  const before3 = JSON.stringify(store["users/t3"]);
  await rejects(
      "an active paid subscriber is refused",
      () => activateExistingTeacherTrialOffer({auth: {uid: "t3"}, data: {}}),
      (e) => e.code === "failed-precondition",
  );
  ok("the paid subscriber's document is completely untouched", JSON.stringify(store["users/t3"]) === before3);

  // ── ineligible: learner role, even if somehow called ─────────────────
  store = {"users/l1": {role: "learner"}};
  await rejects(
      "a learner account is refused",
      () => activateExistingTeacherTrialOffer({auth: {uid: "l1"}, data: {}}),
      (e) => e.code === "failed-precondition" && e.details.reason === "not-a-teacher",
  );

  console.log(`\nexistingTeacherOffer: ${passed} tests passed`);
}

main().then(() => {
  Module._load = origLoad;
}).catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
