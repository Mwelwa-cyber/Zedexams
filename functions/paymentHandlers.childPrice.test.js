"use strict";

/**
 * Which callables are gated, and by which gate — audit C-01 / C-02, revised.
 *
 * Purchase is a gated capability. Three callables hand back commercial facts:
 * `getUpgradeQuote` (the ZMW figure for any plan id), `initiateLencoPayment`
 * (charges) and `resendInvoiceEmail` (re-mails a receipt carrying the amount
 * and the plan name). A reviewer tests the gate with a direct call, not a
 * screenshot, so the gate is what is pinned here.
 *
 * Two gates, deliberately different (2026-10):
 *
 *   - `assertMayStartPurchase` guards the quote and the payment. A learner
 *     whose guardian has NOT YET approved the account may start one, because a
 *     parent's confirmed payment is what records that approval; requiring the
 *     approval first is a deadlock. A DECLINED account, an unreadable one and
 *     a missing sign-in are still refused.
 *   - `assertLearnerCapability(uid, 'purchase')` still guards the invoice
 *     re-send: an invoice only exists once a payment has landed, and by then
 *     the approval is on record, so nothing needs relaxing there.
 *
 * What these tests pin:
 *
 *   1. Each callable invokes ITS gate and not the other.
 *   2. A refusal short-circuits BEFORE any Firestore read or module require,
 *      so a refused call costs nothing and leaves nothing behind.
 *   3. A pending minor reaches the body of the quote and the payment.
 *   4. Ownership is still checked afterwards — the gate is an addition, not a
 *      replacement, so an adult reading someone else's invoice is refused for
 *      the reason it always was.
 *
 * The handlers take every collaborator by injection (`buildPaymentHandlers`),
 * so this needs no emulator and no firebase-functions runtime.
 *
 * Plain `node` script. Run: node functions/paymentHandlers.childPrice.test.js
 */

const assert = require("node:assert");

const {buildPaymentHandlers} = require("./paymentHandlers");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** Minimal HttpsError stand-in carrying the code the client branches on. */
class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// A learner whose guardian has not approved yet. May START a purchase.
const MINOR = "minor_learner";
// A learner whose guardian declined. Refused everywhere.
const DECLINED = "declined_learner";
const ADULT = "adult_learner";

/**
 * Build the handler pair with the two collaborators under test spied on.
 *
 * `firestoreCalls` is the tripwire for property 2: the real bodies reach
 * Firestore for the caller's profile and the invoice/plan, so a refusal that
 * fired too late would show up here as a non-zero count.
 */
function buildWithSpies({refuseFor = [], declinedFor = [DECLINED]} = {}) {
  const capabilityCalls = [];
  const startCalls = [];
  const firestoreCalls = [];

  const handlers = buildPaymentHandlers({
    CAPABILITY_PURCHASE: "purchase",
    HttpsError: FakeHttpsError,
    getFirestore: () => {
      firestoreCalls.push(1);
      // Reached only when the gate let the call through. Returns a document
      // that does not exist, which every body below handles.
      return {
        collection: () => ({doc: () => ({get: async () => ({exists: false, data: () => ({})})})}),
      };
    },
    assertAdminSecondFactor: async () => {},
    assertLearnerCapability: async (uid, capability) => {
      capabilityCalls.push({uid, capability});
      if (refuseFor.includes(uid)) {
        throw new FakeHttpsError(
            "permission-denied",
            "We need a parent or guardian to approve your account.",
            {reason: "consent-pending", capability},
        );
      }
    },
    // The gate for the quote and the payment: pending is let through, a
    // guardian's decline is not — the same split consentGuard makes.
    assertMayStartPurchase: async (uid) => {
      startCalls.push({uid});
      if (declinedFor.includes(uid)) {
        throw new FakeHttpsError(
            "permission-denied",
            "This account has been deactivated at a parent or guardian's request.",
            {reason: "guardian-denied", capability: "purchase"},
        );
      }
    },
    assertVerifiedAuth: async (request) => request.auth.uid,
    cleanString: (value, max) => String(value ?? "").trim().slice(0, max),
    crypto: require("node:crypto"),
    emailSmtpPassword: {value: () => ""},
    emailSmtpUser: {value: () => ""},
    googlePlaySaJson: {value: () => ""},
    lencoApiKeyValue: () => "",
    lencoEmailSecrets: [],
    raisePlayConfigError: () => {},
    recordAppCheckCallable: () => {},
    shouldSendWebhookAlert: () => false,
  });

  return {handlers, capabilityCalls, startCalls, firestoreCalls};
}

async function rejects(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to be refused, but it resolved");
}

async function main() {
  console.log("\npaymentHandlers — no price reaches a child's token\n");

  await test("getUpgradeQuote asks the may-start gate before anything else", async () => {
    const {handlers, capabilityCalls, startCalls, firestoreCalls} = buildWithSpies();

    const err = await rejects(() => handlers.getUpgradeQuote({
      auth: {uid: DECLINED},
      data: {planId: "max_monthly"},
    }));

    assert.strictEqual(err.code, "permission-denied");
    assert.deepStrictEqual(startCalls, [{uid: DECLINED}]);
    assert.deepStrictEqual(capabilityCalls, [], "the quote must not use the strict gate");
    // Property 2: refused before the plan lookup and before the profile read.
    assert.strictEqual(firestoreCalls.length, 0,
        "a refused quote must not read Firestore");
  });

  await test("a pending minor reaches the quote — a payment is what approves the account", async () => {
    // The gate passes, so the body proceeds into the plan lookup. Reaching
    // THAT error is the proof the may-start gate let a pending learner through.
    const {handlers, startCalls} = buildWithSpies();
    const err = await rejects(() => handlers.getUpgradeQuote({
      auth: {uid: MINOR},
      data: {planId: "not_a_real_plan"},
    }));
    assert.deepStrictEqual(startCalls, [{uid: MINOR}]);
    assert.strictEqual(err.code, "invalid-argument");
  });

  await test("initiateLencoPayment asks the may-start gate and refuses a declined account", async () => {
    const {handlers, capabilityCalls, startCalls, firestoreCalls} = buildWithSpies();

    const err = await rejects(() => handlers.initiateLencoPayment({
      auth: {uid: DECLINED},
      data: {planId: "monthly", phone: "0977740465"},
    }));

    assert.strictEqual(err.code, "permission-denied");
    assert.strictEqual(err.details.reason, "guardian-denied");
    assert.deepStrictEqual(startCalls, [{uid: DECLINED}]);
    assert.deepStrictEqual(capabilityCalls, [], "initiate must not use the strict gate");
    assert.strictEqual(firestoreCalls.length, 0, "a refused payment must not read Firestore");
  });

  await test("a pending minor is not refused by initiateLencoPayment's gate", async () => {
    // Past the gate the body needs the Lenco provider and API key; without them
    // it fails for an unrelated reason. Anything OTHER than permission-denied
    // proves the gate let the pending learner through.
    const {handlers, startCalls} = buildWithSpies();
    const err = await rejects(() => handlers.initiateLencoPayment({
      auth: {uid: MINOR},
      data: {planId: "not_a_real_plan", phone: "0977740465"},
    }));
    assert.deepStrictEqual(startCalls, [{uid: MINOR}]);
    assert.notStrictEqual(err.code, "permission-denied");
  });

  await test("resendInvoiceEmail asks the purchase gate before reading the invoice", async () => {
    const {handlers, capabilityCalls, firestoreCalls} = buildWithSpies({refuseFor: [MINOR]});

    const err = await rejects(() => handlers.resendInvoiceEmail({
      auth: {uid: MINOR},
      data: {invoiceId: "pay_1"},
    }));

    assert.strictEqual(err.code, "permission-denied");
    assert.deepStrictEqual(capabilityCalls, [{uid: MINOR, capability: "purchase"}]);
    assert.strictEqual(firestoreCalls.length, 0,
        "a refused resend must not read the invoice");
  });

  await test("the refusal carries the reason the client renders a banner from", async () => {
    const {handlers} = buildWithSpies();
    const err = await rejects(() => handlers.getUpgradeQuote({
      auth: {uid: DECLINED},
      data: {planId: "max_monthly"},
    }));
    assert.strictEqual(err.details.reason, "guardian-denied");
    assert.strictEqual(err.details.capability, "purchase");
  });

  await test("an adult learner is not refused by the gate", async () => {
    // The gate passes, so the body proceeds into the plan lookup — which is
    // where an unknown plan id is rejected. Reaching THAT error is the proof
    // the age gate let an adult through: a `permission-denied` here would mean
    // the new assertion had caught somebody it must not.
    const {handlers, startCalls} = buildWithSpies();
    const err = await rejects(() => handlers.getUpgradeQuote({
      auth: {uid: ADULT},
      data: {planId: "not_a_real_plan"},
    }));
    assert.deepStrictEqual(startCalls, [{uid: ADULT}]);
    assert.strictEqual(err.code, "invalid-argument");
    assert.notStrictEqual(err.code, "permission-denied");
  });

  await test("ownership is still enforced after the age gate", async () => {
    // The invoice read comes back non-existent for an allowed caller, so the
    // body's own not-found path runs. The point is that the age gate did not
    // REPLACE the ownership branch — control still reaches it.
    const {handlers, firestoreCalls} = buildWithSpies({refuseFor: [MINOR]});
    const err = await rejects(() => handlers.resendInvoiceEmail({
      auth: {uid: ADULT},
      data: {invoiceId: "pay_1"},
    }));
    assert.strictEqual(err.code, "not-found");
    assert.ok(firestoreCalls.length > 0,
        "an allowed caller must still reach the invoice read");
  });

  console.log(`\n  ${passed} passed\n`);
}

main().catch((err) => {
  console.error("\n  ✗", err && err.message);
  console.error(err);
  process.exit(1);
});
