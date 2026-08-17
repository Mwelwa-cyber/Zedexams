/**
 * End-to-end payment lifecycle run — against the Firestore EMULATOR.
 *
 *   npm run test:payment-lifecycle-emulator
 *   (wraps this in `firebase-tools emulators:exec --only firestore`, which
 *    starts the emulator and sets FIRESTORE_EMULATOR_HOST before invoking node.)
 *
 * This is the emulator half of launch-blocker #7 ("one end-to-end payment
 * lifecycle run through a real Lenco sandbox / emulator"). The pure contract
 * test (functions/paymentProviderContract.test.js) drives the mock provider +
 * the pure decision helpers with a stubbed activation spy and no Firebase. THIS
 * test closes the remaining gap: it exercises the REAL server activation logic
 * (subscriptionActivation.js) and the REAL webhook dispatcher
 * (lencoWebhookProcessor.js) against a REAL (emulated) Firestore, with the mock
 * provider adapter (mockPaymentProvider.js) standing in for the Lenco sandbox.
 *
 * So the full chain is real except the network to Lenco:
 *   mock provider (Lenco sandbox)  →  webhook dispatcher  →  activation
 *        →  Firestore transactions  →  users/{uid} + payments/{ref} docs.
 *
 * The invariant under test is the same as the contract test, but now verified
 * on real committed documents: a payment grants access ONLY when the trusted
 * server confirms a `successful` status, EXACTLY ONCE, with the collected
 * amount verified — and never from a pending, declined, or short-collected
 * state. Idempotency (webhook + poll + duplicate callback) is proven by
 * asserting the user's expiry is written once and not re-stacked on a replay.
 *
 * SAFETY: refuses to run unless FIRESTORE_EMULATOR_HOST is set, so a stray
 * `node functions/paymentLifecycleEmulator.test.js` can never touch production
 * Firestore. The mock provider is likewise selectable only outside production
 * (see paymentProvider.js). Because its npm command is not a bare `node …`
 * invocation, scripts/run-all-tests.mjs (test:all) skips it automatically —
 * exactly like the *-rules-emulator suites.
 */

// Select the mock provider + a non-production env BEFORE any module reads them.
process.env.PAYMENTS_PROVIDER = "mock";
if (!process.env.NODE_ENV) process.env.NODE_ENV = "test";

const assert = require("node:assert");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
      "\n✖ FIRESTORE_EMULATOR_HOST is not set. Run via:\n" +
      "    npm run test:payment-lifecycle-emulator\n" +
      "  (this test refuses to run against a real Firestore).\n",
  );
  process.exit(1);
}

const admin = require("firebase-admin");
const PROJECT_ID = process.env.GCLOUD_PROJECT || "examsprepzambia-test";
// storageBucket lets the best-effort invoice-PDF side effect resolve a bucket;
// when the Storage emulator is running (STORAGE_EMULATOR_HOST is set by
// `emulators:exec --only firestore,storage`) the upload routes there — no real
// GCS, and the invoice/receipt side effect is exercised end-to-end too.
admin.initializeApp({projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com`});

const provider = require("./mockPaymentProvider");
const {getPaymentProvider, mockAllowed} = require("./paymentProvider");
const {activateSubscriptionFromPayment, markPaymentFailed} = require("./subscriptionActivation");
const {processLencoWebhookEvent} = require("./lencoWebhookProcessor");

const db = admin.firestore();
const DAY_MS = 24 * 60 * 60 * 1000;

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// Seed a users/{uid} doc and a pending payments/{ref} doc, mirroring the shape
// initiateLencoPayment writes before Lenco confirms anything.
async function seed({uid, ref, user = {}, payment = {}}) {
  await db.collection("users").doc(uid).set({
    email: `${uid}@test.zedexams.com`,
    role: "student",
    plan: "free",
    premium: false,
    ...user,
  });
  await db.collection("payments").doc(ref).set({
    userId: uid,
    planId: "monthly",
    amountZMW: 50,
    currency: "ZMW",
    phoneNumber: "0977000000",
    provider: "lenco",
    status: "pending",
    lencoStatus: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...payment,
  });
}

const getPayment = async (ref) => (await db.collection("payments").doc(ref).get()).data();
const getUser = async (uid) => (await db.collection("users").doc(uid).get()).data();
const evt = (type, data) => ({event: type, data});
// Bind the REAL activation + failure recorders into the webhook dispatcher.
const dispatch = (event) => processLencoWebhookEvent({
  event, db,
  activate: activateSubscriptionFromPayment,
  markFailed: markPaymentFailed,
});

async function run() {
  provider.__resetMockStore();
  console.log("payment lifecycle — Firestore emulator\n");

  // 0. Guards: the mock is selectable here (never in production).
  ok("mock provider is selectable in this env", mockAllowed() === true);
  ok("getPaymentProvider returns the mock here", getPaymentProvider() === provider);

  // 1. HAPPY PATH — mobile money, delayed callback, activated via webhook.
  {
    const uid = "u_happy";
    const ref = "pay_happy";
    await seed({uid, ref, payment: {phoneNumber: "0977000000"}});

    // Sandbox initiation returns pending; entitlement must NOT exist yet.
    const init = await provider.initiateMobileMoneyCollection({phone: "0977000000", amount: 50, reference: ref});
    ok("initiation is pending, not successful", init.data.status === "pending");
    ok("no entitlement from a pending initiation", (await getUser(uid)).premium === false);

    // Delayed callback: first status poll pending, second successful.
    const p1 = await provider.getCollectionStatus({reference: ref});
    const p2 = await provider.getCollectionStatus({reference: ref});
    ok("delayed callback: pending then successful", p1.data.status === "pending" && p2.data.status === "successful");

    // Signed webhook lands → REAL activation runs a real Firestore transaction.
    const before = Date.now();
    const r1 = await dispatch(evt("collection.successful", {reference: ref, status: "successful", amount: 50, currency: "ZMW"}));
    ok("webhook activates the payment", r1.action === "activated");

    const pay = await getPayment(ref);
    const user = await getUser(uid);
    ok("payment doc is now successful", pay.status === "successful");
    ok("confirmedAt was stamped", !!pay.confirmedAt);
    ok("user flipped to premium", user.premium === true && user.isPremium === true && user.plan === "premium");
    ok("subscriptionPlan recorded", user.subscriptionPlan === "monthly");
    ok("subscriptionPaymentId links the payment", user.subscriptionPaymentId === ref);

    const expiry = user.subscriptionExpiry.toDate().getTime();
    ok("expiry ≈ now + 30 days", expiry > before + 29 * DAY_MS && expiry < before + 31 * DAY_MS);

    // 1b. IDEMPOTENCY — a duplicate/delayed callback (and a redirect poll)
    // must grant nothing extra: the expiry is written once, never re-stacked.
    const r2 = await dispatch(evt("collection.successful", {reference: ref, status: "successful", amount: 50, currency: "ZMW"}));
    ok("duplicate callback is still matched", r2.matched === true);
    const r3 = await activateSubscriptionFromPayment({paymentId: ref, lencoStatus: "successful", collectedAmount: 50, collectedCurrency: "ZMW"});
    ok("re-activation short-circuits (already active)", r3.alreadyActive === true);
    const expiryAfter = (await getUser(uid)).subscriptionExpiry.toDate().getTime();
    ok("expiry NOT re-stacked on replay (exactly-once)", expiryAfter === expiry);
  }

  // 2. DECLINED — provider polls to failed; failure webhook records it, grants
  // nothing.
  {
    const uid = "u_declined";
    const ref = "pay_declined";
    await seed({uid, ref, payment: {phoneNumber: "0977000001"}});
    await provider.initiateMobileMoneyCollection({phone: "0977000001", amount: 50, reference: ref});
    const status = await provider.getCollectionStatus({reference: ref});
    ok("declined scenario polls to failed", status.data.status === "failed");

    const r = await dispatch(evt("collection.failed", {reference: ref, status: "failed", reasonForFailure: "declined"}));
    ok("failure webhook routes to failed", r.action === "failed");
    ok("payment doc is failed", (await getPayment(ref)).status === "failed");
    ok("declined user was NOT granted premium", (await getUser(uid)).premium === false);
  }

  // 3. AMOUNT MISMATCH — Lenco reports collecting less than we charged →
  // parked as amount_mismatch, NEVER activated.
  {
    const uid = "u_short";
    const ref = "pay_short";
    await seed({uid, ref, payment: {amountZMW: 50, phoneNumber: "0977000000"}});
    const r = await dispatch(evt("collection.successful", {reference: ref, status: "successful", amount: 10, currency: "ZMW"}));
    ok("under-collection returns amount_mismatch", r.action === "amount_mismatch");
    ok("payment parked as amount_mismatch", (await getPayment(ref)).status === "amount_mismatch");
    ok("short-collected user was NOT granted premium", (await getUser(uid)).premium === false);
  }

  // 4. OTP FLOW — wrong OTP fails, correct OTP proceeds, then activation.
  {
    const uid = "u_otp";
    const ref = "pay_otp";
    await seed({uid, ref, payment: {phoneNumber: "0977000003"}});
    const init = await provider.initiateMobileMoneyCollection({phone: "0977000003", amount: 50, reference: ref});
    ok("otp scenario requires an OTP", init.data.status === "otp-required");
    const bad = await provider.submitMobileMoneyOtp({reference: ref, otp: "000000"});
    ok("wrong OTP is rejected", bad.data.status === "failed");
    const good = await provider.submitMobileMoneyOtp({reference: ref, otp: "123456"});
    ok("correct OTP accepted (pending)", good.data.status === "pending");
    await provider.getCollectionStatus({reference: ref});
    const s2 = await provider.getCollectionStatus({reference: ref});
    ok("otp flow settles successful after polling", s2.data.status === "successful");
    await dispatch(evt("collection.successful", {reference: ref, status: "successful", amount: 50, currency: "ZMW"}));
    ok("otp payment activates the user", (await getUser(uid)).premium === true);
  }

  // 5. EARLY RENEWAL — an active sub stacks the new period onto the remaining
  // days rather than restarting from today.
  {
    const uid = "u_renew";
    const ref = "pay_renew";
    const existingExpiry = new Date(Date.now() + 10 * DAY_MS);
    await seed({
      uid, ref,
      user: {plan: "premium", premium: true, isPremium: true, subscriptionExpiry: admin.firestore.Timestamp.fromDate(existingExpiry)},
    });
    await dispatch(evt("collection.successful", {reference: ref, status: "successful", amount: 50, currency: "ZMW"}));
    const newExpiry = (await getUser(uid)).subscriptionExpiry.toDate().getTime();
    ok("renewal stacks onto remaining days (~40 out)", newExpiry > existingExpiry.getTime() + 29 * DAY_MS);
  }

  // 6. TOP-UP — a one-off credit purchase adds generation credits and leaves
  // plan/premium/expiry untouched.
  {
    const uid = "u_topup";
    const ref = "pay_topup";
    await seed({uid, ref, payment: {planId: "topup_generation", amountZMW: 25}});
    await dispatch(evt("collection.successful", {reference: ref, status: "successful", amount: 25, currency: "ZMW"}));
    const user = await getUser(uid);
    ok("top-up grants a generation credit", Number(user.generationCredits) === 1);
    ok("top-up does NOT flip the plan to premium", user.plan !== "premium" && user.premium === false);
    ok("top-up payment is successful", (await getPayment(ref)).status === "successful");
  }

  // 7. UNKNOWN REFERENCE — a webhook for a payment we never created is ignored.
  {
    const r = await dispatch(evt("collection.successful", {reference: "ghost_ref", status: "successful", amount: 50}));
    ok("unknown reference is ignored", r.matched === false && r.action === "ignored");
  }

  // 8. WEBHOOK SIGNATURE — valid mock signature verifies; tampering fails
  // closed. (Pure — the real HMAC path the onRequest handler runs.)
  {
    const rawBody = JSON.stringify({event: "collection.successful", data: {reference: "pay_happy"}});
    const sig = provider.signWebhook(rawBody);
    ok("valid mock signature verifies", provider.verifyWebhookSignature({rawBody, signature: sig}) === true);
    ok("tampered body fails verification", provider.verifyWebhookSignature({rawBody: rawBody + "x", signature: sig}) === false);
    ok("missing signature fails verification", provider.verifyWebhookSignature({rawBody, signature: ""}) === false);
  }

  // 9. GUARDIAN PAYS FOR A CHILD — the whole point of beneficiaryUid.
  //
  // Every assertion here is one half of a claim that is worthless without
  // the other: the CHILD must gain premium AND the parent must not. A
  // change that credited both would pass a "the child got it" test while
  // quietly giving away a second subscription.
  {
    const parent = "u_parent";
    const child = "u_child";
    const ref = "pay_guardian";

    await db.collection("users").doc(parent).set({
      email: "parent@test.zedexams.com", role: "parent", plan: "free", premium: false,
    });
    await seed({
      uid: child, ref,
      user: {role: "student"},
      // The payer is the parent; the payment names the child.
      payment: {userId: parent, beneficiaryUid: child, beneficiaryName: "Milton Phiri"},
    });

    const before = Date.now();
    const r = await dispatch(evt("collection.successful", {
      reference: ref, status: "successful", amount: 50, currency: "ZMW",
    }));
    ok("guardian payment activates", r.action === "activated");

    const kid = await getUser(child);
    const mum = await getUser(parent);
    ok("the CHILD gained premium", kid.premium === true && kid.plan === "premium");
    ok("the child's subscription links the parent's payment", kid.subscriptionPaymentId === ref);
    ok("the PARENT did not gain premium", mum.premium !== true && mum.plan === "free");
    ok("the parent has no subscription expiry", !mum.subscriptionExpiry);

    const expiry = kid.subscriptionExpiry.toDate().getTime();
    ok("the child's expiry ≈ now + 30 days",
        expiry > before + 29 * DAY_MS && expiry < before + 31 * DAY_MS);

    // The receipt is still the payer's — their money, their email.
    const pay = await getPayment(ref);
    ok("the payment still records who paid", pay.userId === parent);
    ok("…and who it was for", pay.beneficiaryUid === child);

    // Replaying the webhook must not stack a second period on the child.
    await dispatch(evt("collection.successful", {reference: ref, status: "successful", amount: 50, currency: "ZMW"}));
    const after = (await getUser(child)).subscriptionExpiry.toDate().getTime();
    ok("a replayed guardian payment does not re-stack the child's expiry", after === expiry);
  }

  console.log(`\n${passed} assertions passed (Firestore emulator).`);
}

run()
    .then(() => process.exit(0))
    .catch((err) => { console.error("\n✖ lifecycle run failed:\n", err); process.exit(1); });
