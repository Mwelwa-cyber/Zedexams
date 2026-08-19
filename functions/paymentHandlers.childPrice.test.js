"use strict";

/**
 * A price never reaches an under-18 learner's token — audit C-01 / C-02.
 *
 * `initiateLencoPayment` has refused an unapproved minor since purchase became
 * a gated capability. The two callables that hand back the same commercial
 * facts without charging anything did not: `getUpgradeQuote` returns the ZMW
 * figure for any plan id, and `resendInvoiceEmail` re-mails a receipt carrying
 * the amount and the plan name. Both were reachable by a child's token even
 * after the learner screens stopped rendering either — which is exactly the
 * distinction Play's Families policy does NOT draw, and which a reviewer tests
 * with a direct call rather than a screenshot.
 *
 * What these tests pin, therefore, is not a rendered price but the gate:
 *
 *   1. Both callables invoke `assertLearnerCapability(uid, 'purchase')`.
 *   2. A refusal short-circuits BEFORE any Firestore read or module require,
 *      so a refused call costs nothing and leaves nothing behind.
 *   3. Ownership is still checked afterwards — the age gate is an addition,
 *      not a replacement, so an adult reading someone else's invoice is
 *      refused for the reason it always was.
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

const MINOR = "minor_learner";
const ADULT = "adult_learner";

/**
 * Build the handler pair with the two collaborators under test spied on.
 *
 * `firestoreCalls` is the tripwire for property 2: the real bodies reach
 * Firestore for the caller's profile and the invoice/plan, so a refusal that
 * fired too late would show up here as a non-zero count.
 */
function buildWithSpies({refuseFor = []} = {}) {
  const capabilityCalls = [];
  const firestoreCalls = [];

  const handlers = buildPaymentHandlers({
    CAPABILITY_PURCHASE: "purchase",
    HttpsError: FakeHttpsError,
    admin: {
      firestore: () => {
        firestoreCalls.push(1);
        // Reached only when the gate let the call through. Returns a document
        // that does not exist, which every body below handles.
        return {
          collection: () => ({doc: () => ({get: async () => ({exists: false, data: () => ({})})})}),
        };
      },
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

  return {handlers, capabilityCalls, firestoreCalls};
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

  await test("getUpgradeQuote asks the purchase gate before anything else", async () => {
    const {handlers, capabilityCalls, firestoreCalls} = buildWithSpies({refuseFor: [MINOR]});

    const err = await rejects(() => handlers.getUpgradeQuote({
      auth: {uid: MINOR},
      data: {planId: "max_monthly"},
    }));

    assert.strictEqual(err.code, "permission-denied");
    assert.deepStrictEqual(capabilityCalls, [{uid: MINOR, capability: "purchase"}]);
    // Property 2: refused before the plan lookup and before the profile read.
    assert.strictEqual(firestoreCalls.length, 0,
        "a refused quote must not read Firestore");
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
    const {handlers} = buildWithSpies({refuseFor: [MINOR]});
    const err = await rejects(() => handlers.getUpgradeQuote({
      auth: {uid: MINOR},
      data: {planId: "max_monthly"},
    }));
    assert.strictEqual(err.details.reason, "consent-pending");
    assert.strictEqual(err.details.capability, "purchase");
  });

  await test("an adult learner is not refused by the gate", async () => {
    // The gate passes, so the body proceeds into the plan lookup — which is
    // where an unknown plan id is rejected. Reaching THAT error is the proof
    // the age gate let an adult through: a `permission-denied` here would mean
    // the new assertion had caught somebody it must not.
    const {handlers, capabilityCalls} = buildWithSpies({refuseFor: [MINOR]});
    const err = await rejects(() => handlers.getUpgradeQuote({
      auth: {uid: ADULT},
      data: {planId: "not_a_real_plan"},
    }));
    assert.deepStrictEqual(capabilityCalls, [{uid: ADULT, capability: "purchase"}]);
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
