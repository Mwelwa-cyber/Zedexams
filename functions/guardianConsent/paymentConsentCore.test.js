"use strict";

/**
 * paymentConsentCore — when a confirmed payment counts as a guardian's
 * approval. Plain node: `node functions/guardianConsent/paymentConsentCore.test.js`
 */

const assert = require("node:assert");
const {decidePaymentConsent, paymentEvidence, lastFour} = require("./paymentConsentCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const kid = (guardian, extra = {}) => ({role: "learner", isMinor: true, guardian, ...extra});

console.log("paymentConsentCore");

test("a pending minor is promoted by a confirmed payment", () => {
  assert.deepStrictEqual(decidePaymentConsent(kid({consentStatus: "pending"})),
      {apply: true, reason: "was-pending"});
});

test("an expired approval link is promoted too — the parent paid instead", () => {
  assert.strictEqual(decidePaymentConsent(kid({consentStatus: "expired"})).apply, true);
});

test("an account with no guardian record at all is promoted (the migration state)", () => {
  assert.deepStrictEqual(decidePaymentConsent(kid(undefined)), {apply: true, reason: "no-record"});
  assert.strictEqual(decidePaymentConsent(kid({})).apply, true);
  assert.strictEqual(decidePaymentConsent(kid({consentStatus: "unknown"})).apply, true);
});

test("an unrecognised status reads as pending, so it is promotable — as at the gate", () => {
  for (const status of ["garbage", 42, true, {}, ""]) {
    assert.strictEqual(decidePaymentConsent(kid({consentStatus: status})).apply, true, String(status));
  }
});

test("a guardian's DECLINE outranks a payment", () => {
  // The failure this prevents: a child's own pocket money reinstating an
  // account their parent deactivated.
  const d = decidePaymentConsent(kid({consentStatus: "denied"}));
  assert.deepStrictEqual(d, {apply: false, reason: "guardian-denied"});
  assert.strictEqual(decidePaymentConsent(kid({consentStatus: " denied "})).apply, false,
      "a padded status must read the same as at the gate");
});

test("an already-granted account is left alone (idempotent, evidence not overwritten)", () => {
  assert.deepStrictEqual(decidePaymentConsent(kid({consentStatus: "granted"})),
      {apply: false, reason: "already-granted"});
  assert.strictEqual(decidePaymentConsent(kid({consentStatus: " granted"})).apply, false);
});

test("a suspension is somebody else's decision and a payment does not lift it", () => {
  const d = decidePaymentConsent(kid({consentStatus: "pending"}, {suspended: true, suspendedReason: "admin"}));
  assert.deepStrictEqual(d, {apply: false, reason: "suspended"});
});

test("an adult learner needs no approval; only an explicit isMinor:false counts", () => {
  assert.strictEqual(decidePaymentConsent({role: "learner", isMinor: false}).reason, "adult-learner");
  // Absent / null is a child, exactly as resolveLearnerAccess reads it.
  assert.strictEqual(decidePaymentConsent({role: "learner"}).apply, true);
  assert.strictEqual(decidePaymentConsent({role: "learner", isMinor: null}).apply, true);
});

test("only a learner is ever promoted", () => {
  for (const role of ["teacher", "parent", "admin", "superAdmin", undefined, "student"]) {
    assert.deepStrictEqual(decidePaymentConsent({role, isMinor: true}),
        {apply: false, reason: "not-a-learner"}, String(role));
  }
});

test("no profile is never promoted", () => {
  for (const user of [null, undefined, "x", 0]) {
    assert.deepStrictEqual(decidePaymentConsent(user), {apply: false, reason: "no-profile"});
  }
});

test("the evidence keeps the payment id and last four digits, never the number", () => {
  const e = paymentEvidence({paymentId: "pay_1", phoneNumber: "260977740465", operator: "AIRTEL"});
  assert.deepStrictEqual(e, {via: "payment", paymentId: "pay_1", payerPhoneLast4: "0465", operator: "airtel"});
  assert.ok(!JSON.stringify(e).includes("977740"), "the full number must not be copied into consent evidence");
});

test("evidence tolerates missing inputs without throwing", () => {
  assert.deepStrictEqual(paymentEvidence(), {via: "payment", paymentId: "", payerPhoneLast4: "", operator: ""});
  assert.strictEqual(lastFour("12"), "");
  assert.strictEqual(lastFour("+260 977 740 465"), "0465");
  assert.strictEqual(lastFour(null), "");
});

console.log(`\n  ${passed} passed\n`);
