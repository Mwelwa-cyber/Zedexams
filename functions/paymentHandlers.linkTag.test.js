"use strict";

/**
 * initiateLencoPayment — the guardian-link tag is written WITH the payment.
 *
 * linkPayment.js (the no-login pay link) used to tag the payment with its
 * guardian request AFTER initiation. A webhook landing in between activated the
 * payment with no request id, so the request was never settled and the child
 * never told. The tag now travels on a server-built property
 * (`request.trustedPaymentFields`) and is written in the SAME transaction that
 * creates the payment.
 *
 * Two properties are pinned:
 *   1. a trusted request's tag IS on the created payment document;
 *   2. a CLIENT cannot get a tag there — `data.guardianRequestId` with no
 *      beneficiary is dropped, and `data.trustedPaymentFields` is ignored.
 *
 * Uses the mock payment provider (the documented NODE_ENV=test opt-in) and an
 * in-memory Firestore. Run: node functions/paymentHandlers.linkTag.test.js
 */

process.env.NODE_ENV = "test";
process.env.PAYMENTS_PROVIDER = "mock";

const assert = require("node:assert");
const {buildPaymentHandlers} = require("./paymentHandlers");

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function makeDb() {
  const store = {
    "users/kid": {displayName: "Kid", role: "learner", email: "k@example.com"},
  };
  const created = [];
  let n = 0;
  const ref = (path) => ({
    __path: path,
    id: path.split("/")[1],
    get: async () => ({exists: store[path] !== undefined, id: path.split("/")[1], data: () => store[path]}),
    update: async (patch) => { store[path] = {...(store[path] || {}), ...patch}; },
    set: async (data) => { store[path] = data; },
  });
  const db = {
    collection: (col) => ({
      doc: (id) => ref(`${col}/${id || `gen${++n}`}`),
    }),
    runTransaction: async (fn) => fn({
      get: async (r) => r.get(),
      set: (r, data) => { store[r.__path] = data; created.push({path: r.__path, data}); },
    }),
  };
  return {db, store, created};
}

async function run(request) {
  const {db, created} = makeDb();
  const handlers = buildPaymentHandlers({
    CAPABILITY_PURCHASE: "purchase",
    HttpsError: FakeHttpsError,
    FieldValue: {serverTimestamp: () => "TS"},
    Timestamp: {fromDate: (d) => d},
    getFirestore: () => db,
    assertAdminSecondFactor: async () => {},
    assertLearnerCapability: async () => {},
    assertMayStartPurchase: async () => {},
    assertVerifiedAuth: async (req) => req.auth.uid,
    cleanString: (v, max) => String(v ?? "").trim().slice(0, max),
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
  const res = await handlers.initiateLencoPayment(request);
  const payment = created.find((c) => c.path.startsWith("payments/"));
  return {res, payment: payment && payment.data};
}

const base = () => ({
  auth: {uid: "kid", token: {}},
  data: {planId: "term_pass", method: "mobile_money", phone: "0977740465", operator: "airtel"},
});

(async () => {
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed += 1; console.log(`  ✓ ${name}`); };

  await test("a trusted link request has its guardian request on the created payment", async () => {
    const {payment, res} = await run({...base(), trustedPaymentFields: {guardianRequestId: "REQ1"}});
    assert.ok(payment, "a payment document was created");
    assert.strictEqual(payment.guardianRequestId, "REQ1");
    assert.strictEqual(payment.startedVia, "guardian_link");
    assert.strictEqual(payment.userId, "kid", "still the child's own payment");
    assert.ok(res.paymentId);
  });

  await test("a client cannot put a guardian request on a payment through its data", async () => {
    const request = base();
    request.data.guardianRequestId = "FORGED";
    request.data.trustedPaymentFields = {guardianRequestId: "FORGED"};
    request.data.startedVia = "guardian_link";
    const {payment} = await run(request);
    assert.ok(payment);
    assert.strictEqual(payment.guardianRequestId, undefined);
    assert.strictEqual(payment.startedVia, undefined);
  });

  await test("an ordinary payment carries no link fields at all", async () => {
    const {payment} = await run(base());
    assert.ok(!("guardianRequestId" in payment));
    assert.ok(!("startedVia" in payment));
  });

  console.log(`\npaymentHandlers.linkTag: ${passed} checks passed`);
})().catch((err) => { console.error(err); process.exit(1); });
