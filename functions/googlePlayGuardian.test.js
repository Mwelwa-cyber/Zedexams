/**
 * Node test for the two things the Android PARENT rail added to
 * functions/googlePlayBilling.js:
 *
 *   1. a purchase may name a linked child (`beneficiaryUid`), exactly as
 *      the web/Lenco rail does, so the same money buys the same thing on
 *      both rails;
 *   2. one-time passes (day / term) verify through purchases.products
 *      rather than subscriptionsv2.
 *
 * The properties worth pinning are the ones a family would notice and a
 * reviewer would not: that a pass carries NO `grantExpiryAt` (so it
 * extends an active plan instead of truncating it to a date Google never
 * set), that a pass is acknowledged through the products endpoint (an
 * unacknowledged purchase is auto-refunded after three days), and that
 * the account-binding check still compares the PAYER's uid when a
 * guardian is buying for somebody else.
 *
 * Same firebase-admin Module._load harness as googlePlayVerify.test.js.
 *
 * Run: node functions/googlePlayGuardian.test.js
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
let store = {};
const k = (col, id) => `${col}/${id}`;
const snapFor = (col, id) => {
  const data = store[k(col, id)];
  return {exists: data !== undefined, id, data: () => data};
};
const makeRef = (col, id) => ({
  __col: col,
  __id: id,
  id,
  get: async () => snapFor(col, id),
  update: async (data) => { store[k(col, id)] = {...(store[k(col, id)] || {}), ...data}; },
});
const db = {
  collection: (col) => ({doc: (id) => makeRef(col, id)}),
  runTransaction: async (fn) => fn({
    get: async (ref) => snapFor(ref.__col, ref.__id),
    set: (ref, data) => { store[k(ref.__col, ref.__id)] = {...data}; },
    update: (ref, data) => {
      store[k(ref.__col, ref.__id)] = {...(store[k(ref.__col, ref.__id)] || {}), ...data};
    },
  }),
};
const firestoreFn = () => db;
firestoreFn.FieldValue = {serverTimestamp: () => SERVER_TS};
firestoreFn.Timestamp = {
  fromMillis: (ms) => ({toMillis: () => ms, toDate: () => new Date(ms), _ms: ms}),
  fromDate: (d) => ({toMillis: () => d.getTime(), toDate: () => d, _date: d}),
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return {firestore: firestoreFn};
  return origLoad.call(this, request, ...rest);
};

const {verifyAndApplyPurchase} = require("./googlePlayBilling");
const {derivePaymentId} = require("./googlePlayBillingCore");

const NOW = Date.parse("2026-08-21T09:00:00Z");
const FUT = NOW + 30 * 24 * 3600 * 1000;
const PARENT = "parent-uid";
const CHILD = "child-uid";

const DAY_PASS = "learner_premium_day_pass";
const TERM_PASS = "learner_premium_term_pass";
const MONTHLY = "learner_premium_monthly";

function subBody({productId = MONTHLY, expiryMs = FUT, acked = false, obfAccountId} = {}) {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: acked ?
      "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" : "ACKNOWLEDGEMENT_STATE_PENDING",
    latestOrderId: "GPA.SUB-1",
    ...(obfAccountId === undefined ? {} : {
      externalAccountIdentifiers: {obfuscatedExternalAccountId: obfAccountId},
    }),
    lineItems: [{
      productId,
      expiryTime: new Date(expiryMs).toISOString(),
      offerDetails: {basePlanId: "monthly"},
    }],
  };
}

function productBody({productId = TERM_PASS, purchaseState = 0, acked = false,
  purchaseTimeMs = NOW, obfAccountId} = {}) {
  return {
    productId,
    purchaseState,
    acknowledgementState: acked ? 1 : 0,
    consumptionState: 0,
    orderId: "GPA.PASS-1",
    purchaseTimeMillis: String(purchaseTimeMs),
    ...(obfAccountId === undefined ? {} : {obfuscatedExternalAccountId: obfAccountId}),
  };
}

let activateCalls = [];
let subAckCalls = [];
let productAckCalls = [];
let productFetches = [];
let subFetches = [];

function reset() {
  store = {};
  activateCalls = [];
  subAckCalls = [];
  productAckCalls = [];
  productFetches = [];
  subFetches = [];
  store[`users/${PARENT}`] = {displayName: "Grace Banda", email: "g@x.zm", role: "parent"};
  store[`users/${CHILD}`] = {displayName: "Mutinta Banda", role: "student"};
}

async function run({
  uid = PARENT, token = "tok-1", productId = "", sub = null, product = null,
  beneficiaryUid = null, beneficiaryName = null, guardianRequestId = null,
  enforceAccountBinding = false,
} = {}) {
  return verifyAndApplyPurchase({
    uid,
    purchaseToken: token,
    productId,
    db,
    nowMs: NOW,
    enforceAccountBinding,
    beneficiaryUid,
    beneficiaryName,
    guardianRequestId,
    recordBinding: async () => {},
    activate: async (args) => {
      activateCalls.push(args);
      const key = `payments/${args.paymentId}`;
      if (store[key]) store[key] = {...store[key], status: "successful"};
      return {ok: true, activated: true};
    },
    fetchSubscription: async (args) => { subFetches.push(args); return sub; },
    fetchProduct: async (args) => { productFetches.push(args); return product; },
    acknowledge: async (args) => { subAckCalls.push(args); },
    acknowledgeOneTime: async (args) => { productAckCalls.push(args); },
  });
}

(async () => {
  console.log("googlePlayGuardian");

  // ── A guardian buying a SUBSCRIPTION for a child ────────────────────
  reset();
  let r = await run({
    productId: MONTHLY,
    sub: subBody(),
    beneficiaryUid: CHILD,
    beneficiaryName: "Mutinta Banda",
  });
  let payId = derivePaymentId("tok-1", FUT);
  let pay = store[`payments/${payId}`];
  ok("guardian sub purchase → active", r.status === "active");
  ok("payments doc records the PAYER as userId", pay.userId === PARENT);
  ok("payments doc names the child as beneficiary", pay.beneficiaryUid === CHILD);
  ok("beneficiary name carried for the receipt", pay.beneficiaryName === "Mutinta Banda");
  ok("guardian purchase is never an upgrade", pay.isUpgrade === false);
  ok("subscription pins Google's expiry via grantExpiryAt",
      pay.grantExpiryAt && pay.grantExpiryAt._ms === FUT);
  ok("subscription is typed subs", pay.googlePlayProductType === "subs");
  ok("subscription acknowledged through the subscriptions endpoint",
      subAckCalls.length === 1 && productAckCalls.length === 0);
  ok("the products endpoint was never called for a subscription", productFetches.length === 0);

  // ── An ordinary self-purchase is unchanged ──────────────────────────
  reset();
  r = await run({productId: MONTHLY, sub: subBody()});
  pay = store[`payments/${derivePaymentId("tok-1", FUT)}`];
  ok("no beneficiary → no beneficiaryUid field written", pay.beneficiaryUid === undefined);
  ok("no beneficiary → no isUpgrade override written", pay.isUpgrade === undefined);

  // ── A guardian buying a one-time TERM PASS for a child ──────────────
  reset();
  r = await run({
    productId: TERM_PASS,
    product: productBody({productId: TERM_PASS}),
    beneficiaryUid: CHILD,
    beneficiaryName: "Mutinta Banda",
  });
  payId = derivePaymentId("tok-1", NOW);
  pay = store[`payments/${payId}`];
  ok("one-time pass → active", r.status === "active");
  ok("pass resolves to the term_pass plan", r.planId === "term_pass");
  ok("pass read from the products endpoint", productFetches.length === 1 && subFetches.length === 0);
  ok("products fetch carries the productId (the URL needs it)",
      productFetches[0].productId === TERM_PASS);
  // The property this whole branch exists for: Google sets no renewal date
  // on a pass, so pinning one would truncate a plan the child already has.
  ok("pass writes NO grantExpiryAt", pay.grantExpiryAt === undefined);
  ok("pass is typed inapp", pay.googlePlayProductType === "inapp");
  ok("pass keyed on purchase time, not expiry", !!store[`payments/${derivePaymentId("tok-1", NOW)}`]);
  ok("pass credits the child", pay.beneficiaryUid === CHILD);
  ok("pass acknowledged through the products endpoint",
      productAckCalls.length === 1 && subAckCalls.length === 0);
  ok("pass acknowledge names the product", productAckCalls[0].productId === TERM_PASS);
  ok("activation ran once", activateCalls.length === 1);
  ok("expiryTime is null — a pass has no store-owned expiry", r.expiryTime === null);

  // ── Re-verifying the same pass is idempotent ────────────────────────
  const beforeDocs = Object.keys(store).filter((key) => key.startsWith("payments/")).length;
  await run({
    productId: TERM_PASS,
    product: productBody({productId: TERM_PASS, acked: true}),
    beneficiaryUid: CHILD,
  });
  const afterDocs = Object.keys(store).filter((key) => key.startsWith("payments/")).length;
  ok("re-verify of the same pass creates no second payments doc", beforeDocs === afterDocs);
  ok("already-acknowledged pass is not acknowledged twice", productAckCalls.length === 1);

  // ── A pass that has not been paid for grants nothing ────────────────
  reset();
  r = await run({productId: DAY_PASS, product: productBody({productId: DAY_PASS, purchaseState: 2})});
  ok("PENDING pass → noop, not a grant", r.status === "noop" && r.reason === "purchase-pending");
  ok("PENDING pass creates no payment doc",
      Object.keys(store).filter((key) => key.startsWith("payments/")).length === 0);
  ok("PENDING pass never activates", activateCalls.length === 0);

  reset();
  r = await run({productId: DAY_PASS, product: productBody({productId: DAY_PASS, purchaseState: 1})});
  ok("CANCELLED pass → noop", r.status === "noop" && r.reason === "purchase-cancelled");
  ok("CANCELLED pass never activates", activateCalls.length === 0);

  // ── A token Google does not know ────────────────────────────────────
  reset();
  r = await run({productId: DAY_PASS, product: null});
  ok("unknown pass token → not_found", r.status === "not_found");

  // ── Binding still compares the PAYER, not the beneficiary ───────────
  // Binding the child would make every guardian purchase look like a
  // cross-account replay — the buyer is the parent, and Google recorded
  // the parent's id.
  reset();
  r = await run({
    productId: MONTHLY,
    sub: subBody({obfAccountId: PARENT}),
    beneficiaryUid: CHILD,
    enforceAccountBinding: true,
  });
  ok("payer-bound id + child beneficiary → active under enforce", r.status === "active");

  reset();
  r = await run({
    productId: MONTHLY,
    sub: subBody({obfAccountId: CHILD}),
    beneficiaryUid: CHILD,
    enforceAccountBinding: true,
  });
  ok("child-bound id → account_mismatch (the payer is who Google recorded)",
      r.status === "account_mismatch");

  // ── A pass bound to another account is refused the same way ─────────
  reset();
  r = await run({
    productId: DAY_PASS,
    product: productBody({productId: DAY_PASS, obfAccountId: "somebody-else"}),
    enforceAccountBinding: true,
  });
  ok("mismatched pass under enforce → account_mismatch", r.status === "account_mismatch");
  ok("mismatched pass creates no payment doc",
      Object.keys(store).filter((key) => key.startsWith("payments/")).length === 0);

  // ── A guardian request rides along to the receipt ───────────────────
  reset();
  await run({
    productId: TERM_PASS,
    product: productBody({productId: TERM_PASS}),
    beneficiaryUid: CHILD,
    guardianRequestId: "req-9",
  });
  pay = store[`payments/${derivePaymentId("tok-1", NOW)}`];
  ok("settled guardian request recorded on the payment", pay.guardianRequestId === "req-9");

  // ── The cross-rail guard ────────────────────────────────────────────
  // Google has already taken the money by the time we get here, so the
  // grant is refused and the purchase is left UNACKNOWLEDGED — which is
  // what makes Google auto-refund it after three days.
  reset();
  store[`users/${PARENT}`] = {
    displayName: "Grace Banda", role: "parent",
    subscriptionProvider: "lenco",
    subscriptionExpiry: {toMillis: () => NOW + 10 * 24 * 3600 * 1000},
  };
  r = await run({productId: MONTHLY, sub: subBody()});
  ok("Play grant refused while the payer is live on Lenco",
      r.status === "cross_rail_conflict" && r.existingRail === "lenco");
  ok("refused grant creates no payment doc",
      Object.keys(store).filter((key) => key.startsWith("payments/")).length === 0);
  ok("refused grant never activates", activateCalls.length === 0);
  ok("refused grant is NOT acknowledged (so Google auto-refunds it)",
      subAckCalls.length === 0 && productAckCalls.length === 0);

  // The same guard has to see a live plan on the CHILD, since a guardian
  // purchase credits the child and that is where a web plan would sit.
  reset();
  store[`users/${CHILD}`] = {
    displayName: "Mutinta Banda",
    subscriptionProvider: "lenco",
    subscriptionExpiry: {toMillis: () => NOW + 10 * 24 * 3600 * 1000},
  };
  r = await run({productId: MONTHLY, sub: subBody(), beneficiaryUid: CHILD});
  ok("Play grant refused while the CHILD is live on Lenco",
      r.status === "cross_rail_conflict");

  // Renewing on the rail you are already on is the ordinary case.
  reset();
  store[`users/${PARENT}`] = {
    displayName: "Grace Banda", role: "parent",
    subscriptionProvider: "google_play",
    subscriptionExpiry: {toMillis: () => NOW + 10 * 24 * 3600 * 1000},
  };
  r = await run({productId: MONTHLY, sub: subBody()});
  ok("a Play renewal is never caught by the cross-rail guard", r.status === "active");

  // A LAPSED plan on the other rail is not a conflict — it is a customer
  // coming back, and refusing them would be the strictness failure.
  reset();
  store[`users/${PARENT}`] = {
    displayName: "Grace Banda", role: "parent",
    subscriptionProvider: "lenco",
    subscriptionExpiry: {toMillis: () => NOW - 24 * 3600 * 1000},
  };
  r = await run({productId: MONTHLY, sub: subBody()});
  ok("an expired plan on the other rail does not block a purchase", r.status === "active");

  // ── An unmapped product still refuses ───────────────────────────────
  reset();
  r = await run({productId: DAY_PASS, product: productBody({productId: "not_in_catalog"})});
  ok("pass for an unmapped product → unknown_product", r.status === "unknown_product");

  console.log(`\n${passed} passed`);
})().catch((err) => { console.error(err); process.exit(1); });
