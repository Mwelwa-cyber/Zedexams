/**
 * Node test for Google Play Real-time Developer Notifications —
 * googlePlayRtdnCore (parsing + classification) and googlePlayRtdn
 * (owner resolution, re-verification, revocation).
 *
 * The properties worth pinning are the ones whose failure is silent and
 * expensive:
 *
 *  • a renewal is applied by RE-ASKING Google, never by trusting the
 *    notification body, so an out-of-order redelivery cannot move an
 *    expiry backwards;
 *  • a refund lapses only the accounts THAT payment granted — never every
 *    child of the guardian, who may hold a plan somebody else paid for;
 *  • a token we have never seen is not an error, because Play routinely
 *    publishes PURCHASED before the client's first verification lands;
 *  • a notification for another package is ignored rather than acted on.
 *
 * Run: node functions/googlePlayRtdn.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── firebase-admin stub ──────────────────────────────────────────────────
const SERVER_TS = Symbol("serverTimestamp");
const firestoreFn = () => { throw new Error("db must be injected in tests"); };
firestoreFn.FieldValue = {serverTimestamp: () => SERVER_TS};
firestoreFn.Timestamp = {
  fromMillis: (ms) => ({toMillis: () => ms, toDate: () => new Date(ms), _ms: ms}),
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return {firestore: firestoreFn};
  return origLoad.call(this, request, ...rest);
};

const {
  SUBSCRIPTION_NOTIFICATION,
  ONE_TIME_NOTIFICATION,
  decodeRtdnMessage,
  parseRtdnNotification,
  classifyRtdn,
} = require("./googlePlayRtdnCore");
const {handleRtdnMessage, revokeGrantsForToken} = require("./googlePlayRtdn");

const PKG = "com.zedexams.android";
const TOKEN = "play-token-abc";

function envelope(payload) {
  return {data: Buffer.from(JSON.stringify(payload)).toString("base64")};
}
function subNotification(type, {token = TOKEN, productId = "learner_premium_monthly",
  packageName = PKG} = {}) {
  return envelope({
    version: "1.0",
    packageName,
    eventTimeMillis: "1755766800000",
    subscriptionNotification: {
      version: "1.0", notificationType: type, purchaseToken: token, subscriptionId: productId,
    },
  });
}
function classify(message) {
  return classifyRtdn({
    notification: parseRtdnNotification(decodeRtdnMessage(message)),
    expectedPackage: PKG,
  });
}

/** Minimal Firestore stand-in supporting the two equality queries used. */
function fakeDb({payments = {}, users = {}} = {}) {
  const updates = [];
  function collection(name) {
    const store = name === "payments" ? payments : users;
    return {
      doc: (id) => ({
        id,
        get: async () => ({exists: store[id] !== undefined, id, data: () => store[id]}),
        update: async (data) => {
          updates.push({collection: name, id, data});
          store[id] = {...(store[id] || {}), ...data};
        },
      }),
      where(field, _op, value) {
        const matches = Object.entries(store)
            .filter(([, v]) => v && v[field] === value);
        const build = (rows) => ({
          limit: () => build(rows),
          get: async () => ({
            empty: rows.length === 0,
            docs: rows.map(([id, v]) => ({
              id,
              data: () => v,
              ref: {
                update: async (data) => {
                  updates.push({collection: name, id, data});
                  store[id] = {...store[id], ...data};
                },
              },
            })),
          }),
        });
        return build(matches);
      },
    };
  }
  return {collection, __updates: updates};
}

(async () => {
  console.log("googlePlayRtdn");

  // ── Parsing ─────────────────────────────────────────────────────────
  const renewed = parseRtdnNotification(decodeRtdnMessage(
      subNotification(SUBSCRIPTION_NOTIFICATION.RENEWED)));
  ok("subscription notification parses to kind subscription", renewed.kind === "subscription");
  ok("carries the purchase token", renewed.purchaseToken === TOKEN);
  ok("subscriptionId is read as the productId",
      renewed.productId === "learner_premium_monthly");

  const oneTime = parseRtdnNotification(decodeRtdnMessage(envelope({
    packageName: PKG,
    oneTimeProductNotification: {
      notificationType: ONE_TIME_NOTIFICATION.PURCHASED,
      purchaseToken: TOKEN, sku: "learner_premium_term_pass",
    },
  })));
  ok("one-time notification reads sku as the productId",
      oneTime.kind === "oneTime" && oneTime.productId === "learner_premium_term_pass");

  const voided = parseRtdnNotification(decodeRtdnMessage(envelope({
    packageName: PKG,
    voidedPurchaseNotification: {purchaseToken: TOKEN, orderId: "GPA.1", productType: 1},
  })));
  ok("voided notification parses to kind voided", voided.kind === "voided");

  ok("unreadable message → null", parseRtdnNotification(decodeRtdnMessage({})) === null);
  ok("non-base64 garbage → null",
      parseRtdnNotification(decodeRtdnMessage({data: "%%%not base64%%%"})) === null);
  ok("already-decoded json body is accepted",
      parseRtdnNotification(decodeRtdnMessage({json: {packageName: PKG,
        subscriptionNotification: {notificationType: 2, purchaseToken: TOKEN}}}))?.kind ===
        "subscription");

  // ── Classification ──────────────────────────────────────────────────
  const ACTIONABLE = ["RECOVERED", "RENEWED", "CANCELED", "PURCHASED", "ON_HOLD",
    "IN_GRACE_PERIOD", "RESTARTED", "PAUSED", "REVOKED", "EXPIRED"];
  for (const name of ACTIONABLE) {
    const v = classify(subNotification(SUBSCRIPTION_NOTIFICATION[name]));
    ok(`${name} → reverify`, v.action === "reverify" && v.reason === name);
  }
  // These change nothing about the CURRENT entitlement, so spending a Play
  // API call and a transaction on them would write back what is there.
  for (const name of ["PRICE_CHANGE_CONFIRMED", "DEFERRED", "PAUSE_SCHEDULE_CHANGED",
    "PENDING_PURCHASE_CANCELED"]) {
    ok(`${name} → ignore`,
        classify(subNotification(SUBSCRIPTION_NOTIFICATION[name])).action === "ignore");
  }

  ok("voided → revoke", classify(envelope({packageName: PKG,
    voidedPurchaseNotification: {purchaseToken: TOKEN, productType: 1}})).action === "revoke");
  ok("one-time PURCHASED → reverify", classify(envelope({packageName: PKG,
    oneTimeProductNotification: {notificationType: ONE_TIME_NOTIFICATION.PURCHASED,
      purchaseToken: TOKEN, sku: "learner_premium_day_pass"}})).action === "reverify");
  ok("one-time CANCELED → ignore (it never granted anything)", classify(envelope({
    packageName: PKG,
    oneTimeProductNotification: {notificationType: ONE_TIME_NOTIFICATION.CANCELED,
      purchaseToken: TOKEN, sku: "learner_premium_day_pass"}})).action === "ignore");
  ok("test notification → ignore, and is how the wiring is proved",
      classify(envelope({packageName: PKG, testNotification: {version: "1.0"}})).reason ===
        "test-notification");
  ok("another app's package → ignore",
      classify(subNotification(SUBSCRIPTION_NOTIFICATION.RENEWED,
          {packageName: "com.someone.else"})).reason === "wrong-package");
  ok("notification with no purchase token → ignore",
      classify(subNotification(SUBSCRIPTION_NOTIFICATION.RENEWED, {token: ""})).reason ===
        "no-purchase-token");

  // ── Applying a renewal ──────────────────────────────────────────────
  {
    const db = fakeDb({
      payments: {
        gp_1: {userId: "parent-1", beneficiaryUid: "child-1", status: "successful",
          googlePlayPurchaseToken: TOKEN, googlePlayProductId: "learner_premium_monthly"},
      },
    });
    const verifyCalls = [];
    const r = await handleRtdnMessage({
      message: subNotification(SUBSCRIPTION_NOTIFICATION.RENEWED),
      db,
      expectedPackage: PKG,
      verify: async (args) => { verifyCalls.push(args); return {status: "active"}; },
    });
    ok("renewal resolves the payer from the stored payment",
        verifyCalls.length === 1 && verifyCalls[0].uid === "parent-1");
    ok("renewal re-verifies against Google rather than trusting the message",
        verifyCalls[0].purchaseToken === TOKEN);
    ok("renewal passes the productId so the right endpoint is used",
        verifyCalls[0].productId === "learner_premium_monthly");
    ok("renewal reports the verified status", r.status === "active" && r.reason === "RENEWED");
    // The beneficiary is NOT re-asserted: the stored payment already names
    // the child and activation resolves it from there.
    ok("renewal does not re-assert an unauthorised beneficiary",
        verifyCalls[0].beneficiaryUid === undefined);
  }

  // ── A token we have never seen ──────────────────────────────────────
  {
    const db = fakeDb({payments: {}});
    let verified = false;
    const r = await handleRtdnMessage({
      message: subNotification(SUBSCRIPTION_NOTIFICATION.PURCHASED),
      db,
      expectedPackage: PKG,
      verify: async () => { verified = true; return {status: "active"}; },
    });
    ok("unknown token → reported, not thrown", r.status === "unknown-token");
    ok("unknown token → nothing verified (the client's own call does the grant)", !verified);
  }

  // ── A refund lapses exactly what this payment granted ───────────────
  {
    const NOW = Date.parse("2026-08-21T09:00:00Z");
    const db = fakeDb({
      payments: {
        gp_1: {userId: "parent-1", beneficiaryUid: "child-1", status: "successful",
          googlePlayPurchaseToken: TOKEN},
      },
      users: {
        // Credited by this payment.
        "child-1": {subscriptionPlan: "monthly", subscriptionPaymentId: "gp_1"},
        // Cascaded from the same payment.
        "child-2": {subscriptionPlan: "monthly", subscriptionPaymentId: "gp_1"},
        // A sibling on a plan somebody ELSE paid for. Must not be touched.
        "child-3": {subscriptionPlan: "monthly", subscriptionPaymentId: "gp_other"},
      },
    });
    const r = await handleRtdnMessage({
      message: envelope({packageName: PKG,
        voidedPurchaseNotification: {purchaseToken: TOKEN, productType: 1}}),
      db,
      expectedPackage: PKG,
      nowMs: NOW,
    });
    ok("refund revokes the credited child", r.revoked >= 1 &&
        db.__updates.some((u) => u.id === "child-1"));
    ok("refund revokes the cascaded sibling",
        db.__updates.some((u) => u.id === "child-2"));
    ok("refund does NOT touch a child this payment never granted",
        !db.__updates.some((u) => u.id === "child-3"));
    const childUpdate = db.__updates.find((u) => u.id === "child-1").data;
    ok("revocation writes a past expiry rather than deleting the plan",
        childUpdate.subscriptionExpiry._ms === NOW);
    ok("revocation records why", childUpdate.subscriptionRevokedReason === "play_voided_purchase");
    ok("the payment itself is stamped refunded",
        db.__updates.some((u) => u.collection === "payments" && u.data.status === "refunded"));
  }

  // ── A refund of a teacher plan lapses the studio gate too ───────────
  {
    const db = fakeDb({
      payments: {gp_2: {userId: "t1", status: "successful", googlePlayPurchaseToken: TOKEN}},
      users: {t1: {subscriptionPlan: "pro_monthly", subscriptionPaymentId: "gp_2"}},
    });
    await revokeGrantsForToken(db, {purchaseToken: TOKEN, nowMs: 1000});
    const u = db.__updates.find((x) => x.id === "t1").data;
    ok("refunded teacher loses paid studio quotas in step",
        u.teacherPlanExpiresAt && u.teacherPlanExpiresAt._ms === 1000);
  }

  // ── A payment that never completed grants nothing to revoke ─────────
  {
    const db = fakeDb({
      payments: {gp_3: {userId: "p", status: "pending", googlePlayPurchaseToken: TOKEN}},
      users: {p: {subscriptionPaymentId: "gp_3"}},
    });
    const out = await revokeGrantsForToken(db, {purchaseToken: TOKEN});
    ok("pending payment → nothing revoked",
        out.payments === 0 && out.revoked.length === 0);
  }

  // ── An unparseable message is acknowledged, not retried forever ─────
  {
    const r = await handleRtdnMessage({
      message: {data: "not-base64-json"},
      db: fakeDb(),
      expectedPackage: PKG,
    });
    ok("garbage message → ignore, never a throw", r.action === "ignore");
  }

  console.log(`\n${passed} passed`);
})().catch((err) => { console.error(err); process.exit(1); });
