"use strict";

/**
 * paymentConsent — the transaction that records a parent's approval.
 *
 * The in-memory store stands in for Firestore, and the admin SDK is stubbed
 * through Module._load (as subscriptionActivation.test.js does) so this runs
 * on a root-only install too.
 *
 * Run: node functions/guardianConsent/paymentConsent.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

const SERVER_TS = Symbol("serverTimestamp");
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin/firestore") {
    return {FieldValue: {serverTimestamp: () => SERVER_TS}};
  }
  return origLoad.call(this, request, ...rest);
};
const {recordPaymentConsent} = require("./paymentConsent");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** Firestore stand-in: users/{uid} with merge-set, in a transaction. */
function makeDb(users) {
  const writes = [];
  const db = {
    collection: (col) => ({doc: (id) => ({__path: `${col}/${id}`, id})}),
    runTransaction: async (fn) => {
      const tx = {
        get: async (ref) => {
          const data = users[ref.id];
          return {exists: data !== undefined, data: () => data};
        },
        set: (ref, data, opts) => {
          writes.push({id: ref.id, data, opts});
          // Deep-merge one level (guardian map), as {merge:true} does.
          const cur = users[ref.id] || {};
          const next = {...cur, ...data};
          if (data.guardian) next.guardian = {...(cur.guardian || {}), ...data.guardian};
          users[ref.id] = next;
        },
      };
      return fn(tx);
    },
  };
  return {db, writes};
}

const PAY = {paymentId: "pay_1", phoneNumber: "260977740465", operator: "airtel"};

(async () => {
  console.log("paymentConsent");

  await test("a pending minor is granted, with payment evidence and no raw number", async () => {
    const users = {kid: {role: "learner", isMinor: true, guardian: {consentStatus: "pending", contact: "keep-me"}}};
    const {db, writes} = makeDb(users);
    const refreshed = [];
    const out = await recordPaymentConsent(db, {learnerUid: "kid", ...PAY, refreshEffective: async (_d, uid) => refreshed.push(uid)});

    assert.deepStrictEqual(out, {recorded: true, reason: "was-pending"});
    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(writes[0].opts, {merge: true}, "must merge, never replace the user document");
    const g = users.kid.guardian;
    assert.strictEqual(g.consentStatus, "granted");
    assert.strictEqual(g.decidedAt, SERVER_TS);
    assert.deepStrictEqual(g.evidence, {
      via: "payment", ip: "", userAgent: "", paymentId: "pay_1", payerPhoneLast4: "0465", operator: "airtel",
    });
    assert.strictEqual(g.contact, "keep-me", "existing guardian fields survive the merge");
    assert.ok(!JSON.stringify(g).includes("977740"), "the full number is not copied into consent evidence");
    assert.deepStrictEqual(refreshed, ["kid"], "the effective-state mirror is refreshed so the leaderboard rule agrees");
  });

  await test("a guardian's decline is NOT overridden", async () => {
    const users = {kid: {role: "learner", isMinor: true, guardian: {consentStatus: "denied"}, suspended: true}};
    const {db, writes} = makeDb(users);
    const out = await recordPaymentConsent(db, {learnerUid: "kid", ...PAY, refreshEffective: async () => {}});
    assert.deepStrictEqual(out, {recorded: false, reason: "suspended"});
    assert.strictEqual(writes.length, 0);
    assert.strictEqual(users.kid.guardian.consentStatus, "denied");
  });

  await test("a decline that did not suspend is still not overridden", async () => {
    const users = {kid: {role: "learner", isMinor: true, guardian: {consentStatus: "denied"}}};
    const {db, writes} = makeDb(users);
    const out = await recordPaymentConsent(db, {learnerUid: "kid", ...PAY, refreshEffective: async () => {}});
    assert.deepStrictEqual(out, {recorded: false, reason: "guardian-denied"});
    assert.strictEqual(writes.length, 0);
  });

  await test("it is idempotent: a second confirmation writes nothing and keeps the first evidence", async () => {
    const users = {kid: {role: "learner", isMinor: true, guardian: {consentStatus: "pending"}}};
    const {db, writes} = makeDb(users);
    const noop = async () => {};
    await recordPaymentConsent(db, {learnerUid: "kid", ...PAY, refreshEffective: noop});
    const again = await recordPaymentConsent(db, {
      learnerUid: "kid", paymentId: "pay_2", phoneNumber: "260966000111", refreshEffective: noop,
    });
    assert.deepStrictEqual(again, {recorded: false, reason: "already-granted"});
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(users.kid.guardian.evidence.paymentId, "pay_1");
  });

  await test("an adult learner, a teacher and a missing user are left alone", async () => {
    const users = {
      adult: {role: "learner", isMinor: false},
      teacher: {role: "teacher"},
    };
    const {db, writes} = makeDb(users);
    for (const uid of ["adult", "teacher", "ghost"]) {
      const out = await recordPaymentConsent(db, {learnerUid: uid, ...PAY, refreshEffective: async () => {}});
      assert.strictEqual(out.recorded, false, uid);
    }
    assert.strictEqual(writes.length, 0);
  });

  await test("missing ids do nothing and never touch the database", async () => {
    let touched = false;
    const db = {collection: () => { touched = true; }, runTransaction: async () => { touched = true; }};
    assert.deepStrictEqual(await recordPaymentConsent(db, {paymentId: "p"}), {recorded: false, reason: "missing-input"});
    assert.deepStrictEqual(await recordPaymentConsent(db, {learnerUid: "u"}), {recorded: false, reason: "missing-input"});
    assert.strictEqual(touched, false);
  });

  await test("a failing mirror refresh does not undo or hide the grant", async () => {
    const users = {kid: {role: "learner", isMinor: true}};
    const {db} = makeDb(users);
    const out = await recordPaymentConsent(db, {
      learnerUid: "kid", ...PAY, refreshEffective: async () => { throw new Error("mirror down"); },
    });
    assert.strictEqual(out.recorded, true);
    assert.strictEqual(users.kid.guardian.consentStatus, "granted");
  });

  Module._load = origLoad;
  console.log(`\n  ${passed} passed\n`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
