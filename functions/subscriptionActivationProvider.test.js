/**
 * Node test for the provider-aware edits to
 * functions/subscriptionActivation.js made for Google Play Billing:
 *
 *  1. `subscriptionProvider` / invoice provider come from pay.provider
 *     (google_play) instead of the old hardcoded "lenco" — while a doc
 *     with no provider field (legacy) still resolves to "lenco".
 *  2. `grantExpiryAt` (Google's authoritative expiryTime) pins the expiry
 *     exactly — no durationDays stacking, even over an active sub.
 *  3. Google Play payments never redeem/consume referral credits (the next
 *     renewal's expiry pin would silently overwrite the bonus days).
 *  4. The googlePlayPurchaseToken/ProductId linkage lands on users/{uid}.
 *  5. The Lenco path is byte-identical to its pre-change behaviour
 *     (stacking, provider "lenco", referral side effects fire).
 *
 * Same Module._load stub harness as subscriptionActivation.test.js.
 * Run: node functions/subscriptionActivationProvider.test.js
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
const makeRef = (col, id) => ({__col: col, __id: id, id, get: async () => snapFor(col, id)});
const DELETE_FIELD = Symbol("deleteField");
const db = {
  collection: (col) => ({
    doc: (id) => makeRef(col, id),
    where: () => ({limit: () => ({get: async () => ({empty: true, docs: []})})}),
  }),
  runTransaction: async (fn) => fn({
    get: async (ref) => snapFor(ref.__col, ref.__id),
    update: (ref, data) => {
      const key = k(ref.__col, ref.__id);
      const base = {...(store[key] || {})};
      for (const [field, val] of Object.entries(data)) {
        if (val && typeof val === "object" && "__inc" in val) {
          base[field] = Number(base[field] || 0) + val.__inc;
        } else if (val === DELETE_FIELD) {
          delete base[field];
        } else {
          base[field] = val;
        }
      }
      store[key] = base;
    },
  }),
};
const firestoreFn = () => db;
firestoreFn.FieldValue = {
  serverTimestamp: () => SERVER_TS,
  increment: (n) => ({__inc: n}),
  delete: () => DELETE_FIELD,
};
firestoreFn.Timestamp = {fromDate: (d) => ({toDate: () => d, toMillis: () => d.getTime(), _date: d})};

const calls = {invoice: [], redeem: [], consume: []};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return {firestore: firestoreFn};
  if (request === "./invoiceGenerator") {
    return {emitInvoice: async (args) => calls.invoice.push(args)};
  }
  if (request === "./referralRedemption") {
    return {
      redeemReferralCredit: async (args) => calls.redeem.push(args),
      consumeReferralCredits: async (args) => calls.consume.push(args),
    };
  }
  if (request === "./notifications/createNotification") {
    return {createNotification: async () => {}};
  }
  if (request === "./notifications/notifyAudience") {
    return {notifyAdmins: async () => {}};
  }
  return origLoad.call(this, request, ...rest);
};

const {activateSubscriptionFromPayment} = require("./subscriptionActivation");

const DAY = 24 * 60 * 60 * 1000;
function reset() {
  store = {};
  calls.invoice.length = 0;
  calls.redeem.length = 0;
  calls.consume.length = 0;
}

(async () => {
  console.log("subscriptionActivationProvider");

  // ── Google Play payment: provider-aware fields + pinned expiry ────────
  reset();
  const googleExpiry = new Date(Date.now() + 31 * DAY);
  store["users/u1"] = {
    // An ACTIVE current sub — stacking would push past googleExpiry, so the
    // pin is observable: expiry must land EXACTLY on grantExpiryAt.
    subscriptionExpiry: firestoreFn.Timestamp.fromDate(new Date(Date.now() + 10 * DAY)),
  };
  store["payments/gp_1"] = {
    userId: "u1",
    planId: "pro_monthly",
    amountZMW: 59,
    currency: "ZMW",
    provider: "google_play",
    status: "pending",
    googlePlayPurchaseToken: "tok-abc",
    googlePlayProductId: "teacher_pro_monthly",
    grantExpiryAt: firestoreFn.Timestamp.fromDate(googleExpiry),
  };
  let res = await activateSubscriptionFromPayment({paymentId: "gp_1", lencoStatus: "SUBSCRIPTION_STATE_ACTIVE"});
  let user = store["users/u1"];
  ok("google_play activation succeeds", res.ok === true && res.activated === true);
  ok("subscriptionProvider = google_play (not hardcoded lenco)",
      user.subscriptionProvider === "google_play");
  ok("expiry pinned EXACTLY to grantExpiryAt (no stacking on active sub)",
      user.subscriptionExpiry._date.getTime() === googleExpiry.getTime());
  ok("googlePlayPurchaseToken recorded on the user",
      user.googlePlayPurchaseToken === "tok-abc");
  ok("googlePlayProductId recorded on the user",
      user.googlePlayProductId === "teacher_pro_monthly");
  ok("teacher tier still mapped (pro_monthly → pro)", user.teacherPlan === "pro");
  ok("teacherPlanExpiresAt matches the pinned expiry",
      user.teacherPlanExpiresAt._date.getTime() === googleExpiry.getTime());
  ok("premium flags set as ever", user.premium === true && user.subscriptionStatus === "active");
  ok("invoice emitted with provider google_play",
      calls.invoice.length === 1 && calls.invoice[0].payment.provider === "google_play");
  ok("referral credits NOT redeemed on a Play purchase", calls.redeem.length === 0);
  ok("referral credits NOT consumed on a Play purchase", calls.consume.length === 0);
  ok("payment flipped successful", store["payments/gp_1"].status === "successful");

  // Idempotency survives with the new fields.
  res = await activateSubscriptionFromPayment({paymentId: "gp_1"});
  ok("re-activation no-ops (alreadyActive)", res.alreadyActive === true);
  ok("no duplicate invoice on re-activation", calls.invoice.length === 1);

  // ── Lenco payment: byte-identical legacy behaviour ────────────────────
  reset();
  store["users/u2"] = {
    subscriptionExpiry: firestoreFn.Timestamp.fromDate(new Date(Date.now() + 10 * DAY)),
  };
  store["payments/len_1"] = {
    userId: "u2",
    planId: "pro_monthly",
    amountZMW: 59,
    currency: "ZMW",
    provider: "lenco",
    status: "pending",
    phoneNumber: "0977000000",
  };
  res = await activateSubscriptionFromPayment({paymentId: "len_1"});
  user = store["users/u2"];
  ok("lenco activation succeeds", res.ok === true && res.activated === true);
  ok("subscriptionProvider stays lenco", user.subscriptionProvider === "lenco");
  const stackedDays = Math.round((user.subscriptionExpiry._date.getTime() - Date.now()) / DAY);
  ok("lenco expiry still STACKS on the active sub (10 + 30 days)",
      stackedDays === 40);
  ok("no googlePlay fields on a lenco activation",
      !("googlePlayPurchaseToken" in user) && !("googlePlayProductId" in user));
  ok("referral redeem fires for lenco", calls.redeem.length === 1);
  ok("referral consume fires for lenco", calls.consume.length === 1);
  ok("invoice provider is lenco", calls.invoice[0].payment.provider === "lenco");

  // ── Legacy doc with NO provider field defaults to lenco ───────────────
  reset();
  store["users/u3"] = {};
  store["payments/legacy_1"] = {
    userId: "u3", planId: "monthly", amountZMW: 50, currency: "ZMW", status: "pending",
  };
  res = await activateSubscriptionFromPayment({paymentId: "legacy_1"});
  ok("provider-less legacy doc → subscriptionProvider lenco",
      store["users/u3"].subscriptionProvider === "lenco");
  ok("provider-less legacy doc → referral side effects still fire",
      calls.redeem.length === 1);

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
