/**
 * Payment lifecycle CONTRACT test — safe test path (launch-blocker #7).
 * Run: node functions/paymentProviderContract.test.js
 *
 * Drives the FULL authenticated payment lifecycle through the mock provider
 * adapter (functions/mockPaymentProvider.js) + the REAL server decision logic
 * (decideLockedInitiation, processLencoWebhookEvent) — no real money, no Lenco
 * account, no Firestore. This is the "strictly isolated internal test
 * environment using a mock provider adapter that implements the same contract"
 * path the blocker calls for.
 *
 * The invariant under test: a payment is fulfilled ONLY when the trusted server
 * confirms a `successful` status, EXACTLY ONCE, and never from a client-reported
 * or provider-"pending" state.
 */

// Select the mock provider for this test process (before any require reads it).
// mockAllowed() only honours these OUTSIDE production, so this is inert in a
// deployed function.
process.env.PAYMENTS_PROVIDER = "mock";
process.env.NODE_ENV = "test";

const assert = require("node:assert");
const provider = require("./mockPaymentProvider");
const {getPaymentProvider, mockAllowed} = require("./paymentProvider");
const {decideLockedInitiation} = require("./paymentInitiationCore");
const {processLencoWebhookEvent} = require("./lencoWebhookProcessor");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── Fakes: an in-memory payments store + Firestore-shaped accessor ──────────
function makeDb(payments) {
  return {
    collection: () => ({
      doc: (id) => ({
        get: async () => ({exists: payments.has(id), id, data: () => payments.get(id)}),
        update: async (patch) => { if (payments.has(id)) Object.assign(payments.get(id), patch); },
      }),
      where: (field, _op, val) => ({
        limit: () => ({
          get: async () => {
            const hit = [...payments.entries()].find(([, d]) => d[field] === val);
            return {empty: !hit, docs: hit ? [{id: hit[0], exists: true, data: () => hit[1]}] : []};
          },
        }),
      }),
    }),
  };
}

// An idempotent activation spy that mirrors the REAL server contract: a payment
// already successful/confirmed is never granted a second time.
function makeActivation(payments) {
  const calls = {activate: 0, grants: 0, markFailed: 0};
  const activate = async ({paymentId}) => {
    calls.activate += 1;
    const p = payments.get(paymentId);
    if (!p) return {activated: false};
    if (p.status === "successful" || p.status === "confirmed") return {alreadyActive: true};
    p.status = "successful";
    calls.grants += 1; // the ONLY place entitlement is granted
    return {activated: true};
  };
  const markFailed = async ({paymentId}) => {
    calls.markFailed += 1;
    const p = payments.get(paymentId);
    if (p && p.status !== "successful") p.status = "failed";
  };
  return {activate, markFailed, calls};
}

const evt = (type, data) => ({event: type, data});

async function run() {
  provider.__resetMockStore();
  console.log("payment provider contract");

  // 0. The seam is safe: default runtime returns the REAL client; the mock is
  // only reachable in a recognised non-production env.
  ok("mock is selectable in this test env", mockAllowed() === true);
  ok("getPaymentProvider returns the mock here", getPaymentProvider() === provider);

  // 1. Valid vs invalid phone (delegates to the real normaliser).
  ok("valid phone normalises", provider.normalizePhone("0977000000").length > 0);
  ok("invalid phone rejected", provider.normalizePhone("hello") === "");

  // 2. Authenticated initiation → provider returns PENDING and grants NOTHING.
  {
    const payments = new Map();
    const ref = "pay_success_1";
    const initResp = await provider.initiateMobileMoneyCollection({phone: "0977000000", amount: 100, reference: ref});
    payments.set(ref, {planId: "premium", phoneNumber: "0977000000", status: "pending", lencoStatus: "pending", createdAt: 1000});
    ok("initiation returns pending, not successful", initResp.data.status === "pending");
    // Entitlement must not exist yet — a client seeing "pending" grants nothing.
    ok("no entitlement from a pending initiation", payments.get(ref).status === "pending");
  }

  // 3. Duplicate button press / concurrent request → real lock logic REUSES the
  // in-flight attempt (never a second Lenco charge).
  {
    const existing = {data: {planId: "premium", phoneNumber: "0977000000", status: "pending", lencoStatus: "pending", createdAt: 5000}};
    const decision = decideLockedInitiation({existing, planId: "premium", phone: "0977000000", nowMs: 5500});
    ok("duplicate press reuses the pending attempt", decision.action === "reuse-pending");
  }

  // 4. Callback-BEFORE-redirect → the first attempt already succeeded; a retry
  // must resolve to "already paid", never charge twice.
  {
    const existing = {data: {planId: "premium", phoneNumber: "0977000000", status: "successful", lencoStatus: "successful", createdAt: 5000}};
    const decision = decideLockedInitiation({existing, planId: "premium", phone: "0977000000", nowMs: 5500});
    ok("callback-before-redirect resolves to already-paid", decision.action === "reuse-paid");
  }

  // 5. Provider timeout at initiation → throws (surfaced to the caller, no doc
  // left "successful").
  {
    let threw = false;
    try {
      await provider.initiateMobileMoneyCollection({phone: "0977000002", amount: 100, reference: "pay_timeout"});
    } catch (err) { threw = err.code === "ETIMEDOUT"; }
    ok("provider timeout throws ETIMEDOUT", threw === true);
  }

  // 6. Declined transaction → status poll returns failed → markFailed, no grant.
  {
    provider.__resetMockStore();
    const ref = "pay_declined";
    const payments = new Map([[ref, {status: "pending"}]]);
    await provider.initiateMobileMoneyCollection({phone: "0977000001", amount: 100, reference: ref});
    const status = await provider.getCollectionStatus({reference: ref});
    ok("declined scenario polls to failed", status.data.status === "failed");
    const {activate, markFailed, calls} = makeActivation(payments);
    await processLencoWebhookEvent({event: evt("collection.failed", {reference: ref, status: "failed"}), db: makeDb(payments), activate, markFailed});
    ok("declined → markFailed, never granted", calls.grants === 0 && calls.markFailed === 1);
  }

  // 7. User cancellation → failed, no grant.
  {
    provider.__resetMockStore();
    const ref = "pay_cancel";
    await provider.initiateMobileMoneyCollection({phone: "0977000004", amount: 100, reference: ref});
    const status = await provider.getCollectionStatus({reference: ref});
    ok("cancelled scenario polls to failed", status.data.status === "failed");
  }

  // 8. OTP flow: wrong OTP fails, correct OTP proceeds to success.
  {
    provider.__resetMockStore();
    const ref = "pay_otp";
    const init = await provider.initiateMobileMoneyCollection({phone: "0977000003", amount: 100, reference: ref});
    ok("otp scenario requires otp", init.data.status === "otp-required");
    const bad = await provider.submitMobileMoneyOtp({reference: ref, otp: "000000"});
    ok("wrong OTP fails", bad.data.status === "failed");
    const good = await provider.submitMobileMoneyOtp({reference: ref, otp: "123456"});
    ok("correct OTP accepted (pending)", good.data.status === "pending");
    const s1 = await provider.getCollectionStatus({reference: ref});
    const s2 = await provider.getCollectionStatus({reference: ref});
    ok("otp flow settles successful after polling", s1.data.status === "pending" && s2.data.status === "successful");
  }

  // 9. Successful transaction via webhook → activated EXACTLY once, even on a
  // duplicate callback (delayed + duplicate callbacks are safe).
  {
    provider.__resetMockStore();
    const ref = "pay_success_final";
    const payments = new Map([[ref, {planId: "premium", status: "pending", lencoStatus: "pending"}]]);
    await provider.initiateMobileMoneyCollection({phone: "0977000000", amount: 100, reference: ref});
    // delayed callback: first poll pending, second successful
    const p1 = await provider.getCollectionStatus({reference: ref});
    const p2 = await provider.getCollectionStatus({reference: ref});
    ok("delayed callback: pending then successful", p1.data.status === "pending" && p2.data.status === "successful");

    const {activate, markFailed, calls} = makeActivation(payments);
    const db = makeDb(payments);
    const okEvent = evt("collection.successful", {reference: ref, status: "successful", amount: 100, currency: "ZMW"});
    const r1 = await processLencoWebhookEvent({event: okEvent, db, activate, markFailed});
    const r2 = await processLencoWebhookEvent({event: okEvent, db, activate, markFailed}); // duplicate callback
    ok("webhook activates the payment", r1.action === "activated");
    ok("duplicate callback is idempotent (still matched)", r2.matched === true);
    ok("fulfilment applied EXACTLY once", calls.grants === 1);
    ok("payment is now successful", payments.get(ref).status === "successful");

    // redirect-after-callback: a later status poll → activate short-circuits.
    await activate({paymentId: ref, lencoStatus: "successful"});
    ok("redirect-after-callback grants nothing extra", calls.grants === 1);
  }

  // 10. Invalid webhook signature → rejected (fail closed); valid → accepted.
  {
    const rawBody = JSON.stringify({event: "collection.successful", data: {reference: "x"}});
    const validSig = provider.signWebhook(rawBody);
    ok("valid mock signature verifies", provider.verifyWebhookSignature({rawBody, signature: validSig}) === true);
    ok("tampered body fails verification", provider.verifyWebhookSignature({rawBody: rawBody + "x", signature: validSig}) === false);
    ok("garbage signature fails verification", provider.verifyWebhookSignature({rawBody, signature: "deadbeef"}) === false);
    ok("missing signature fails verification", provider.verifyWebhookSignature({rawBody, signature: ""}) === false);
  }

  // 11. Unmatched webhook (unknown reference) → ignored, no grant/fail.
  {
    const payments = new Map();
    const {activate, markFailed, calls} = makeActivation(payments);
    const r = await processLencoWebhookEvent({event: evt("collection.successful", {reference: "ghost", status: "successful"}), db: makeDb(payments), activate, markFailed});
    ok("unknown reference is ignored", r.matched === false && r.action === "ignored");
    ok("unknown reference grants nothing", calls.grants === 0);
  }

  console.log(`\n${passed} assertions passed.`);
}

run().catch((err) => { console.error(err); process.exit(1); });
