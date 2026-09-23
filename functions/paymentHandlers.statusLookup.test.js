"use strict";

/**
 * `getLencoPaymentStatus` answers the "waiting for your payment" poll.
 *
 * #2622 made both of its return paths build their message with
 * `statusLookupMessage` — but imported that helper inside a DIFFERENT handler
 * (`initiateLencoPayment`), so in this one it was an undefined identifier.
 * Every poll of a payment not yet activated threw a ReferenceError, which the
 * client sees as a bare "internal" error. Activation itself still happened
 * through the webhook and Till's reconcile, so nothing but the buyer's screen
 * noticed. `no-undef` is not enabled for functions/, so lint could not see it.
 *
 * These tests drive BOTH paths (a fresh Lenco answer, and a failed lookup that
 * falls back to the last known status) through the real handler, with the
 * provider stubbed, so the identifier has to resolve at runtime.
 *
 * Plain `node` script. Run: node functions/paymentHandlers.statusLookup.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let providerBehaviour = null;
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "./paymentProvider") {
    return {getPaymentProvider: () => ({getCollectionStatus: async () => providerBehaviour()})};
  }
  return realLoad.call(this, request, ...rest);
};

const {buildPaymentHandlers} = require("./paymentHandlers");

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const UID = "buyer_1";

function build(payment) {
  const updates = [];
  const db = {
    collection: (name) => ({
      doc: () => ({
        get: async () => (name === "payments" ?
          {exists: true, data: () => payment} :
          {exists: true, data: () => ({role: "learner"})}),
        update: async (data) => {
          updates.push(data);
        },
      }),
    }),
  };
  const handlers = buildPaymentHandlers({
    CAPABILITY_PURCHASE: "purchase",
    HttpsError: FakeHttpsError,
    admin: {firestore: () => db},
    assertAdminSecondFactor: async () => {},
    assertLearnerCapability: async () => {},
    assertVerifiedAuth: async (request) => request.auth.uid,
    cleanString: (value, max) => String(value ?? "").trim().slice(0, max),
    crypto: require("node:crypto"),
    emailSmtpPassword: {value: () => ""},
    emailSmtpUser: {value: () => ""},
    googlePlaySaJson: {value: () => ""},
    lencoApiKeyValue: () => "test-key",
    lencoEmailSecrets: [],
    raisePlayConfigError: () => {},
    recordAppCheckCallable: () => {},
    shouldSendWebhookAlert: () => false,
  });
  return {handlers, updates};
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log("\npaymentHandlers — getLencoPaymentStatus answers the poll\n");

  await test("a pending payment reports Lenco's status and message", async () => {
    providerBehaviour = async () => ({data: {status: "pay-offline", message: "Approve on your phone"}});
    const {handlers, updates} = build({userId: UID, status: "pending", lencoStatus: "pending"});

    const res = await handlers.getLencoPaymentStatus({auth: {uid: UID}, data: {paymentId: "pay_1"}});

    assert.strictEqual(res.status, "pay-offline");
    assert.strictEqual(res.message, "Approve on your phone");
    assert.strictEqual(updates.length, 1, "the fresh status is persisted");
  });

  await test("a failed lookup falls back to the last known status instead of erroring", async () => {
    providerBehaviour = async () => {
      throw new Error("lenco timeout");
    };
    const {handlers} = build({userId: UID, status: "pending", lencoStatus: "pending"});
    const warn = console.warn;
    console.warn = () => {};
    try {
      const res = await handlers.getLencoPaymentStatus({auth: {uid: UID}, data: {paymentId: "pay_1"}});
      assert.strictEqual(res.status, "pending");
      assert.ok("message" in res, "the fallback still carries a message field");
    } finally {
      console.warn = warn;
    }
  });

  console.log(`\n${passed} passed`);
}

main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => {
      Module._load = realLoad;
    });
