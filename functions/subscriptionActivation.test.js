/**
 * Node test for the server-side subscription activation path
 * (functions/subscriptionActivation.js) — the single idempotent place a
 * confirmed Lenco payment flips a buyer to premium and stamps the teacher
 * studio tier. This is money + access logic, so the transaction, idempotency
 * guards, expiry-stacking, teacher-tier mapping, and side-effect resilience
 * all get covered.
 *
 * Plain `node` script (repo convention — no test runner). CI runs these with
 * a root-only `npm ci`, where functions/node_modules does NOT exist, so the
 * firebase-admin dep plus the lazily-required side-effect modules are stubbed
 * via Module._load before the module under test loads. `./plans` is pure and
 * loads for real.
 *
 * Run: node functions/subscriptionActivation.test.js
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
let store = {}; // `${col}/${id}` -> data object (undefined = does not exist)

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
  runTransaction: async (fn) => {
    const tx = {
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
    };
    return fn(tx);
  },
};

const firestoreFn = () => db;
firestoreFn.FieldValue = {
  serverTimestamp: () => SERVER_TS,
  increment: (n) => ({__inc: n}),
  delete: () => DELETE_FIELD,
};
firestoreFn.Timestamp = {fromDate: (d) => ({toDate: () => d, _date: d})};
const adminStub = {firestore: firestoreFn};

// ── Side-effect stubs (recorded; togglable to throw) ─────────────────────
const calls = {invoice: [], redeem: [], consume: []};
let sideEffectsThrow = false;
const invoiceGeneratorStub = {
  emitInvoice: async (args) => {
    calls.invoice.push(args);
    if (sideEffectsThrow) throw new Error("smtp down");
  },
};
const referralRedemptionStub = {
  redeemReferralCredit: async (args) => {
    calls.redeem.push(args);
    if (sideEffectsThrow) throw new Error("referral down");
  },
  consumeReferralCredits: async (args) => { calls.consume.push(args); },
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return adminStub;
  if (request === "./invoiceGenerator") return invoiceGeneratorStub;
  if (request === "./referralRedemption") return referralRedemptionStub;
  return origLoad.call(this, request, ...rest);
};

const {activateSubscriptionFromPayment, markPaymentFailed, checkCollectedAmount} = require("./subscriptionActivation");

// Helpers
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (date) => Math.round((date.getTime() - Date.now()) / DAY);
function reset() {
  store = {};
  calls.invoice.length = 0;
  calls.redeem.length = 0;
  calls.consume.length = 0;
  sideEffectsThrow = false;
}
async function rejects(promise, re) {
  try {
    await promise;
    return false;
  } catch (err) {
    return re ? re.test(String(err && err.message)) : true;
  }
}

(async () => {
  console.log("subscriptionActivation");

  // ── checkCollectedAmount (pure) ──────────────────────────────────────────
  ok("no collected amount → skipped (checked:false)",
      checkCollectedAmount({chargedZMW: 75}).checked === false);
  ok("collected==charged → ok",
      checkCollectedAmount({chargedZMW: 75, collectedAmount: 75}).ok === true);
  ok("within tolerance (74 vs 75) → ok",
      checkCollectedAmount({chargedZMW: 75, collectedAmount: 74}).ok === true);
  ok("under-collection (50 vs 75) → blocked",
      checkCollectedAmount({chargedZMW: 75, collectedAmount: 50}).ok === false);
  ok("over-collection → ok but flagged over",
      checkCollectedAmount({chargedZMW: 75, collectedAmount: 100}).over === true);
  ok("currency mismatch → blocked",
      checkCollectedAmount({chargedZMW: 75, chargedCurrency: "ZMW", collectedAmount: 75, collectedCurrency: "USD"}).ok === false);
  ok("garbage collected amount → skipped",
      checkCollectedAmount({chargedZMW: 75, collectedAmount: "abc"}).checked === false);

  // ── Guard rails ─────────────────────────────────────────────────────────
  reset();
  ok("no paymentId → {ok:false,no-payment-id}",
      JSON.stringify(await activateSubscriptionFromPayment({})) ===
      JSON.stringify({ok: false, reason: "no-payment-id"}));

  reset();
  store["payments/p-missing-user"] = {planId: "grade7_monthly"}; // no userId
  ok("payment without userId throws",
      await rejects(activateSubscriptionFromPayment({paymentId: "p-missing-user"}), /no userId/));

  reset();
  ok("payment doc not found throws",
      await rejects(activateSubscriptionFromPayment({paymentId: "ghost"}), /not found/));

  reset();
  store["payments/p-badplan"] = {planId: "nope", userId: "u1"};
  store["users/u1"] = {};
  ok("unknown plan throws",
      await rejects(activateSubscriptionFromPayment({paymentId: "p-badplan"}), /unknown plan/));

  reset();
  store["payments/p-nouser"] = {planId: "grade7_monthly", userId: "ghost"};
  ok("user not found throws",
      await rejects(activateSubscriptionFromPayment({paymentId: "p-nouser"}), /user ghost not found/));

  // ── Idempotency: already successful is a no-op ────────────────────────────
  reset();
  store["payments/p-done"] = {planId: "grade7_monthly", userId: "u1", status: "successful"};
  store["users/u1"] = {premium: false};
  const already = await activateSubscriptionFromPayment({paymentId: "p-done"});
  ok("already-successful payment → alreadyActive", already.ok === true && already.alreadyActive === true);
  ok("already-successful does not touch the user", store["users/u1"].premium === false);
  ok("already-successful fires no invoice", calls.invoice.length === 0);

  // ── Happy path: learner plan ─────────────────────────────────────────────
  reset();
  store["payments/p1"] = {
    planId: "grade7_monthly", userId: "u1", amountZMW: 75, currency: "ZMW", phoneNumber: "260977000111",
  };
  store["users/u1"] = {premium: false};
  const res = await activateSubscriptionFromPayment({paymentId: "p1"});
  const user = store["users/u1"];
  const pay = store["payments/p1"];
  ok("learner activation returns activated:true", res.ok === true && res.activated === true);
  ok("payment flips to successful", pay.status === "successful");
  ok("payment records lencoStatus", pay.lencoStatus === "successful");
  ok("user becomes premium", user.premium === true && user.isPremium === true && user.plan === "premium");
  ok("user paymentStatus/subscriptionStatus active",
      user.paymentStatus === "active" && user.subscriptionStatus === "active");
  ok("subscriptionPlan stamped from payment", user.subscriptionPlan === "grade7_monthly");
  ok("subscriptionProvider lenco + paymentId linked",
      user.subscriptionProvider === "lenco" && user.subscriptionPaymentId === "p1");
  ok("expiry is ~30 days out (plan durationDays)", daysFromNow(user.subscriptionExpiry._date) === 30);
  ok("expiry reminder cooldown reset", user.expiryReminderSentAt === null);
  ok("phone copied onto user", user.subscriptionPhoneNumber === "260977000111");
  ok("learner plan does NOT set a teacher tier", !("teacherPlan" in user));
  ok("invoice emitted once with payment payload", calls.invoice.length === 1 && calls.invoice[0].payment.id === "p1");
  ok("referral redeem + consume both fired", calls.redeem.length === 1 && calls.consume.length === 1);

  // ── Teacher tier mapping ─────────────────────────────────────────────────
  reset();
  store["payments/pt"] = {planId: "pro_monthly", userId: "t1"};
  store["users/t1"] = {};
  await activateSubscriptionFromPayment({paymentId: "pt"});
  ok("pro_monthly maps teacherPlan=pro", store["users/t1"].teacherPlan === "pro");
  ok("teacherPlanExpiresAt set for pro", !!store["users/t1"].teacherPlanExpiresAt);

  reset();
  store["payments/pm"] = {planId: "max_yearly", userId: "t2"};
  store["users/t2"] = {};
  await activateSubscriptionFromPayment({paymentId: "pm"});
  ok("max_yearly maps teacherPlan=max", store["users/t2"].teacherPlan === "max");
  ok("max_yearly expiry is ~365 days", daysFromNow(store["users/t2"].subscriptionExpiry._date) === 365);

  // ── Expiry stacking ──────────────────────────────────────────────────────
  reset();
  store["payments/pr"] = {planId: "grade7_monthly", userId: "u2"};
  store["users/u2"] = {subscriptionExpiry: firestoreFn.Timestamp.fromDate(new Date(Date.now() + 10 * DAY))};
  await activateSubscriptionFromPayment({paymentId: "pr"});
  ok("early renewal stacks onto remaining days (10+30=40)",
      daysFromNow(store["users/u2"].subscriptionExpiry._date) === 40);

  reset();
  store["payments/pe"] = {planId: "grade7_monthly", userId: "u3"};
  store["users/u3"] = {subscriptionExpiry: firestoreFn.Timestamp.fromDate(new Date(Date.now() - 5 * DAY))};
  await activateSubscriptionFromPayment({paymentId: "pe"});
  ok("expired subscription restarts from today (~30)",
      daysFromNow(store["users/u3"].subscriptionExpiry._date) === 30);

  // ── Tier upgrade keeps the SAME renewal date (no stacking) ────────────────
  reset();
  store["payments/pu"] = {planId: "max_monthly", userId: "u5", isUpgrade: true};
  store["users/u5"] = {
    subscriptionPlan: "pro_monthly",
    teacherPlan: "pro",
    subscriptionExpiry: firestoreFn.Timestamp.fromDate(new Date(Date.now() + 100 * DAY)),
    teacherPlanExpiresAt: firestoreFn.Timestamp.fromDate(new Date(Date.now() + 100 * DAY)),
  };
  await activateSubscriptionFromPayment({paymentId: "pu"});
  ok("upgrade does NOT add days — expiry stays ~100 (not 130)",
      daysFromNow(store["users/u5"].subscriptionExpiry._date) === 100);
  ok("upgrade flips the tier to max", store["users/u5"].teacherPlan === "max");
  ok("upgrade keeps teacherPlanExpiresAt on the same date",
      daysFromNow(store["users/u5"].teacherPlanExpiresAt._date) === 100);
  ok("upgrade stamps the new subscriptionPlan", store["users/u5"].subscriptionPlan === "max_monthly");

  // Revenue-integrity fix: an upgrade pays only the prorated tier difference,
  // so it must NEVER mint a fresh full period — even if it lands after the sub
  // lapsed. With the renewal date captured at quote time (intendedExpiry), the
  // upgrade is pinned to THAT date regardless of the live (lapsed) expiry.
  reset();
  store["payments/pui"] = {
    planId: "max_monthly", userId: "u6b", isUpgrade: true,
    intendedExpiry: firestoreFn.Timestamp.fromDate(new Date(Date.now() + 50 * DAY)),
  };
  store["users/u6b"] = {
    subscriptionPlan: "pro_monthly",
    teacherPlan: "pro",
    subscriptionExpiry: firestoreFn.Timestamp.fromDate(new Date(Date.now() - 2 * DAY)), // lapsed
  };
  await activateSubscriptionFromPayment({paymentId: "pui"});
  ok("upgrade pins expiry to the captured intendedExpiry (~50), NOT a fresh 30",
      daysFromNow(store["users/u6b"].subscriptionExpiry._date) === 50);
  ok("upgrade still flips tier to max even past the live expiry", store["users/u6b"].teacherPlan === "max");

  // Pre-field payment (no intendedExpiry) on an expired sub: honour the captured
  // renewal date by falling back to the (lapsed) live expiry — still no fresh
  // full period at the prorated price. The buyer gets little/no time, which is
  // correct: they let the sub lapse before the upgrade settled.
  reset();
  store["payments/pux"] = {planId: "max_monthly", userId: "u6", isUpgrade: true};
  store["users/u6"] = {
    subscriptionPlan: "pro_monthly",
    teacherPlan: "pro",
    subscriptionExpiry: firestoreFn.Timestamp.fromDate(new Date(Date.now() - 2 * DAY)),
  };
  await activateSubscriptionFromPayment({paymentId: "pux"});
  ok("legacy upgrade on a lapsed sub does NOT grant a fresh 30-day period",
      daysFromNow(store["users/u6"].subscriptionExpiry._date) === -2);

  // ── Amount verification: block on under-collection ────────────────────────
  reset();
  store["payments/pamt"] = {planId: "grade7_monthly", userId: "ua", amountZMW: 75, currency: "ZMW"};
  store["users/ua"] = {premium: false};
  const shortRes = await activateSubscriptionFromPayment({
    paymentId: "pamt", collectedAmount: 50, collectedCurrency: "ZMW",
  });
  ok("under-collection returns {ok:false, amount-mismatch}",
      shortRes.ok === false && shortRes.reason === "amount-mismatch");
  ok("under-collection does NOT make the user premium", store["users/ua"].premium === false);
  ok("under-collection parks the payment as amount_mismatch (not successful)",
      store["payments/pamt"].status === "amount_mismatch");
  ok("under-collection records the collected amount", store["payments/pamt"].collectedAmount === 50);
  ok("under-collection emits no invoice", calls.invoice.length === 0);

  // Exact / within-tolerance collection activates normally.
  reset();
  store["payments/pamt2"] = {planId: "grade7_monthly", userId: "ub", amountZMW: 75, currency: "ZMW"};
  store["users/ub"] = {premium: false};
  const matchRes = await activateSubscriptionFromPayment({
    paymentId: "pamt2", collectedAmount: 75, collectedCurrency: "ZMW",
  });
  ok("matching amount activates", matchRes.ok === true && matchRes.activated === true);
  ok("matching amount makes the user premium", store["users/ub"].premium === true);

  // Currency mismatch blocks too.
  reset();
  store["payments/pamt3"] = {planId: "grade7_monthly", userId: "uc", amountZMW: 75, currency: "ZMW"};
  store["users/uc"] = {premium: false};
  const curRes = await activateSubscriptionFromPayment({
    paymentId: "pamt3", collectedAmount: 75, collectedCurrency: "USD",
  });
  ok("currency mismatch blocks activation",
      curRes.ok === false && curRes.reason === "amount-mismatch");
  ok("currency mismatch leaves user non-premium", store["users/uc"].premium === false);

  // Over-collection still activates, but is flagged.
  reset();
  store["payments/pamt4"] = {planId: "grade7_monthly", userId: "ud", amountZMW: 75, currency: "ZMW"};
  store["users/ud"] = {premium: false};
  const overRes = await activateSubscriptionFromPayment({
    paymentId: "pamt4", collectedAmount: 100, collectedCurrency: "ZMW",
  });
  ok("over-collection still activates", overRes.ok === true && overRes.activated === true);
  ok("over-collection is flagged on the result",
      overRes.overCollected && overRes.overCollected.collected === 100);

  // ── Pay-per-generation top-up grants a credit, not a subscription ────────
  reset();
  store["payments/ptu"] = {planId: "topup_generation", userId: "u7", amountZMW: 25, currency: "ZMW"};
  store["users/u7"] = {premium: false, generationCredits: 0};
  const topRes = await activateSubscriptionFromPayment({paymentId: "ptu"});
  ok("topup returns activated + topUp flag",
      topRes.ok === true && topRes.activated === true && topRes.topUp === true);
  ok("topup grants one generation credit", store["users/u7"].generationCredits === 1);
  ok("topup does NOT make the user premium",
      store["users/u7"].premium === false && !("subscriptionPlan" in store["users/u7"]));
  ok("topup does NOT set a teacher tier", !("teacherPlan" in store["users/u7"]));
  ok("topup flips payment to successful", store["payments/ptu"].status === "successful");
  ok("topup emits a receipt invoice", calls.invoice.length === 1);
  ok("topup skips referral side effects", calls.redeem.length === 0 && calls.consume.length === 0);

  // Credits stack onto an existing balance, and a webhook/poll replay must not
  // double-grant (idempotency is the whole point of the status guard).
  reset();
  store["payments/ptu2"] = {planId: "topup_generation", userId: "u8"};
  store["users/u8"] = {generationCredits: 2};
  await activateSubscriptionFromPayment({paymentId: "ptu2"});
  ok("topup stacks onto existing credits (2+1=3)", store["users/u8"].generationCredits === 3);
  const replay = await activateSubscriptionFromPayment({paymentId: "ptu2"});
  ok("topup replay is a no-op (no double-grant)",
      replay.alreadyActive === true && store["users/u8"].generationCredits === 3);

  // ── Side-effect resilience: a failed invoice/referral never undoes access ──
  reset();
  sideEffectsThrow = true;
  store["payments/ps"] = {planId: "grade7_monthly", userId: "u4"};
  store["users/u4"] = {};
  const stillOk = await activateSubscriptionFromPayment({paymentId: "ps"});
  ok("activation still succeeds when side effects throw", stillOk.ok === true && stillOk.activated === true);
  ok("user stayed premium despite invoice failure", store["users/u4"].premium === true);

  // ── markPaymentFailed ─────────────────────────────────────────────────────
  reset();
  ok("markPaymentFailed no id → {ok:false}",
      (await markPaymentFailed({})).ok === false);

  reset();
  store["payments/pf"] = {status: "pending", userId: "u1"};
  const failRes = await markPaymentFailed({paymentId: "pf", reason: "insufficient funds"});
  ok("markPaymentFailed flips status to failed", store["payments/pf"].status === "failed" && failRes.ok === true);
  ok("markPaymentFailed records the reason", store["payments/pf"].failureReason === "insufficient funds");

  reset();
  store["payments/pf2"] = {status: "pending"};
  await markPaymentFailed({paymentId: "pf2", reason: "x".repeat(500)});
  ok("failure reason truncated to 300 chars", store["payments/pf2"].failureReason.length === 300);

  reset();
  store["payments/pwin"] = {status: "successful"};
  await markPaymentFailed({paymentId: "pwin"});
  ok("a late failure never downgrades a successful payment", store["payments/pwin"].status === "successful");

  reset();
  ok("markPaymentFailed on a missing doc resolves ok (no throw)",
      (await markPaymentFailed({paymentId: "ghost"})).ok === true);

  Module._load = origLoad;
  console.log(`\n${passed} passed`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
