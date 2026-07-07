/**
 * Node test for the effectful Google Play verify flow
 * (functions/googlePlayBilling.js → verifyAndApplyPurchase): payments-doc
 * creation + idempotency keying, the cross-account replay guard, the
 * activate/expire/noop routing against a stubbed Play API, server-side
 * acknowledgement, and the self-healing re-entry property (a stranded
 * pending doc completes on the next verify of the same token+expiry).
 *
 * firebase-admin is stubbed via Module._load (same harness as
 * subscriptionActivation.test.js); the Play API + activation are injected
 * through verifyAndApplyPurchase's deps. google-auth-library is never
 * loaded because an accessToken/fetchSubscription is always injected.
 *
 * Run: node functions/googlePlayVerify.test.js
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
  update: async (data) => {
    store[k(col, id)] = {...(store[k(col, id)] || {}), ...data};
  },
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

const {verifyAndApplyPurchase, getAccessToken, probePlayConfig, PlayConfigError} =
  require("./googlePlayBilling");
const {derivePaymentId} = require("./googlePlayBillingCore");

// ── Fixtures + injected deps ─────────────────────────────────────────────
const NOW = Date.parse("2026-07-03T12:00:00Z");
const FUT = NOW + 30 * 24 * 3600 * 1000;
const FUT_RENEWED = FUT + 30 * 24 * 3600 * 1000;
const PAST = NOW - 3 * 24 * 3600 * 1000;
const TOKEN = "play-token-1";

function playBody({productId = "teacher_pro_monthly", state = "SUBSCRIPTION_STATE_ACTIVE",
  expiryMs = FUT, acked = false, orderId = "GPA.1111-2222", obfAccountId} = {}) {
  return {
    subscriptionState: state,
    acknowledgementState: acked ?
      "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" : "ACKNOWLEDGEMENT_STATE_PENDING",
    latestOrderId: orderId,
    ...(obfAccountId === undefined ? {} : {
      externalAccountIdentifiers: {obfuscatedExternalAccountId: obfAccountId},
    }),
    lineItems: [{productId, expiryTime: new Date(expiryMs).toISOString(),
      offerDetails: {basePlanId: "monthly"}}],
  };
}

const activateCalls = [];
const ackCalls = [];
async function runVerify({uid = "u1", body, token = TOKEN, activateResult} = {}) {
  return verifyAndApplyPurchase({
    uid,
    purchaseToken: token,
    db,
    nowMs: NOW,
    activate: async (args) => {
      activateCalls.push(args);
      // Mimic real activation: flip the payment doc successful.
      const key = `payments/${args.paymentId}`;
      if (store[key]) store[key] = {...store[key], status: "successful"};
      return activateResult || {ok: true, activated: true};
    },
    fetchSubscription: async () => body,
    acknowledge: async (args) => { ackCalls.push(args); },
  });
}
function reset() {
  store = {};
  activateCalls.length = 0;
  ackCalls.length = 0;
}

(async () => {
  console.log("googlePlayVerify");

  // ── Happy path: fresh purchase ───────────────────────────────────────
  reset();
  store["users/u1"] = {displayName: "T", email: "t@x.zm", role: "teacher"};
  let r = await runVerify({body: playBody()});
  const payId = derivePaymentId(TOKEN, FUT);
  const pay = store[`payments/${payId}`];
  ok("active sub → status active", r.status === "active");
  ok("result carries planId", r.planId === "pro_monthly");
  ok("result carries productId", r.productId === "teacher_pro_monthly");
  ok("result expiryTime is Google's", Date.parse(r.expiryTime) === FUT);
  ok("payments doc created under the derived gp_ id", !!pay);
  ok("payments doc has provider google_play (Till must skip it)",
      pay.provider === "google_play");
  ok("payments doc pins grantExpiryAt to Google's expiry",
      pay.grantExpiryAt && pay.grantExpiryAt.toMillis() === FUT);
  ok("payments doc records the purchase token",
      pay.googlePlayPurchaseToken === TOKEN);
  ok("payments doc records productId + orderId",
      pay.googlePlayProductId === "teacher_pro_monthly" && pay.googlePlayOrderId === "GPA.1111-2222");
  ok("amountZMW is the plans.js list price (reporting only)", pay.amountZMW === 59);
  ok("activation called once with the derived paymentId",
      activateCalls.length === 1 && activateCalls[0].paymentId === payId);
  ok("unacknowledged purchase → server acknowledge fired",
      ackCalls.length === 1 && ackCalls[0].purchaseToken === TOKEN &&
      ackCalls[0].productId === "teacher_pro_monthly");

  // ── Idempotency: same token + same expiry re-verifies without dupes ──
  const before = ackCalls.length;
  r = await runVerify({body: playBody({acked: true}), activateResult: {ok: true, alreadyActive: true}});
  ok("re-verify same period → alreadyActive, same doc id",
      r.status === "active" && r.alreadyActive === true);
  ok("acknowledged purchase → no second acknowledge", ackCalls.length === before);
  ok("no duplicate payment docs",
      Object.keys(store).filter((key) => key.startsWith("payments/")).length === 1);

  // ── Renewal: same token, later expiry → NEW payments doc ─────────────
  r = await runVerify({body: playBody({expiryMs: FUT_RENEWED, acked: true})});
  const renewId = derivePaymentId(TOKEN, FUT_RENEWED);
  ok("renewal → fresh payments doc keyed on the later expiry",
      !!store[`payments/${renewId}`] && renewId !== payId);
  ok("renewal doc pins the renewed expiry",
      store[`payments/${renewId}`].grantExpiryAt.toMillis() === FUT_RENEWED);

  // ── Self-healing: stranded pending doc completes on re-entry ─────────
  reset();
  store["users/u1"] = {};
  store[`payments/${payId}`] = {userId: "u1", planId: "pro_monthly",
    provider: "google_play", status: "pending"};
  r = await runVerify({body: playBody()});
  ok("stranded pending doc → re-entry still calls activation (self-heal)",
      r.status === "active" && activateCalls.length === 1);

  // ── Cross-account replay guard ────────────────────────────────────────
  reset();
  store["users/u2"] = {};
  store[`payments/${payId}`] = {userId: "u1", provider: "google_play", status: "successful"};
  r = await runVerify({uid: "u2", body: playBody()});
  ok("token already granted to another uid → wrong_user", r.status === "wrong_user");
  ok("wrong_user → zero activations", activateCalls.length === 0);
  ok("wrong_user → original doc untouched", store[`payments/${payId}`].userId === "u1");

  // ── Expire path: Play-managed user lapses to Google's past expiry ────
  reset();
  store["users/u1"] = {
    subscriptionProvider: "google_play",
    googlePlayPurchaseToken: TOKEN,
    subscriptionPlan: "pro_monthly",
    subscriptionExpiry: firestoreFn.Timestamp.fromMillis(FUT),
  };
  r = await runVerify({body: playBody({state: "SUBSCRIPTION_STATE_EXPIRED", expiryMs: PAST})});
  ok("expired Play-managed sub → status expired", r.status === "expired");
  ok("subscriptionExpiry written to Google's past expiry",
      store["users/u1"].subscriptionExpiry.toMillis() === PAST);
  ok("teacher plan gate lapses in step (pro_* plan)",
      store["users/u1"].teacherPlanExpiresAt.toMillis() === PAST);
  ok("expire path never calls activation", activateCalls.length === 0);
  ok("premium flags untouched (read-time expiry does the downgrade)",
      !("premium" in store["users/u1"]));

  // ── Never-downgrade: Lenco user with an expired Play token ───────────
  reset();
  const lencoUser = {
    subscriptionProvider: "lenco",
    subscriptionPlan: "pro_monthly",
    subscriptionExpiry: firestoreFn.Timestamp.fromMillis(FUT),
  };
  store["users/u1"] = {...lencoUser};
  r = await runVerify({body: playBody({state: "SUBSCRIPTION_STATE_EXPIRED", expiryMs: PAST})});
  ok("expired token vs lenco-managed user → noop",
      r.status === "noop" && r.reason === "not-play-managed");
  ok("lenco user's expiry untouched",
      store["users/u1"].subscriptionExpiry.toMillis() === FUT);

  // ── Unknown / invalid inputs ──────────────────────────────────────────
  reset();
  store["users/u1"] = {};
  r = await runVerify({body: playBody({productId: "not_in_catalog"})});
  ok("unmapped Play product → unknown_product", r.status === "unknown_product");
  ok("unknown product creates nothing",
      Object.keys(store).filter((key) => key.startsWith("payments/")).length === 0);

  r = await runVerify({body: null});
  ok("token Google doesn't know → not_found", r.status === "not_found");

  r = await verifyAndApplyPurchase({uid: "", purchaseToken: TOKEN, db, nowMs: NOW,
    activate: async () => {}, fetchSubscription: async () => playBody(), acknowledge: async () => {}});
  ok("missing uid → not_found guard", r.status === "not_found");

  reset(); // no users/u1 doc
  r = await runVerify({body: playBody()});
  ok("missing user doc → noop no-user", r.status === "noop" && r.reason === "no-user");

  // ── Acknowledge failure is non-fatal ──────────────────────────────────
  reset();
  store["users/u1"] = {};
  r = await verifyAndApplyPurchase({
    uid: "u1", purchaseToken: TOKEN, db, nowMs: NOW,
    activate: async (args) => {
      const key = `payments/${args.paymentId}`;
      if (store[key]) store[key] = {...store[key], status: "successful"};
      return {ok: true, activated: true};
    },
    fetchSubscription: async () => playBody(),
    acknowledge: async () => { throw new Error("ack 500"); },
  });
  ok("acknowledge throwing does not fail the grant", r.status === "active" && r.activated === true);

  // ── Account binding (issue #1596) ────────────────────────────────────
  // Helper: run with a captured recordBinding + an explicit enforce flag.
  const bindingCalls = [];
  async function runBind({uid = "u1", body, token = TOKEN, enforce = false} = {}) {
    bindingCalls.length = 0;
    return verifyAndApplyPurchase({
      uid, purchaseToken: token, db, nowMs: NOW,
      enforceAccountBinding: enforce,
      recordBinding: async (args) => { bindingCalls.push(args); },
      activate: async (args) => {
        activateCalls.push(args);
        const key = `payments/${args.paymentId}`;
        if (store[key]) store[key] = {...store[key], status: "successful"};
        return {ok: true, activated: true};
      },
      fetchSubscription: async () => body,
      acknowledge: async () => {},
    });
  }

  // Matching id → activates, telemetry records "match".
  reset();
  store["users/u1"] = {};
  r = await runBind({body: playBody({obfAccountId: "u1"})});
  ok("matching bound id → active", r.status === "active");
  ok("matching id → binding recorded as match", bindingCalls[0]?.kind === "match");

  // Absent id (legacy client) under enforce → still activates.
  reset();
  store["users/u1"] = {};
  r = await runBind({body: playBody({obfAccountId: undefined}), enforce: true});
  ok("absent id under enforce → still active (legacy tokens keep working)",
      r.status === "active");
  ok("absent id → binding recorded as absent", bindingCalls[0]?.kind === "absent");

  // Mismatched id, observe mode → activates but records the mismatch.
  reset();
  store["users/u1"] = {};
  r = await runBind({body: playBody({obfAccountId: "someone-else"}), enforce: false});
  ok("mismatched id in observe mode → still active (no behaviour change)",
      r.status === "active");
  ok("mismatched id (observe) → binding recorded as mismatch",
      bindingCalls[0]?.kind === "mismatch");

  // Mismatched id, enforce mode → rejected before any entitlement work.
  reset();
  store["users/u1"] = {};
  const activationsBefore = activateCalls.length;
  r = await runBind({body: playBody({obfAccountId: "someone-else"}), enforce: true});
  ok("mismatched id under enforce → account_mismatch", r.status === "account_mismatch");
  ok("account_mismatch → carries productId + planId",
      r.productId === "teacher_pro_monthly" && r.planId === "pro_monthly");
  ok("account_mismatch → zero activations", activateCalls.length === activationsBefore);
  ok("account_mismatch → no payment doc created",
      Object.keys(store).filter((key) => key.startsWith("payments/")).length === 0);

  // ── Config diagnosability: PlayConfigError reasons + probePlayConfig ──
  // Every config-failure stage must carry a distinct machine-readable reason,
  // so the callable's failed-precondition (and PostHog's play_verify_failed)
  // says WHICH stage broke instead of one opaque "not configured yet".
  // Both parse failures throw before google-auth-library is ever required.
  let thrown = null;
  await getAccessToken("not-json").catch((err) => { thrown = err; });
  ok("invalid SA JSON → PlayConfigError reason sa-json-invalid",
      thrown instanceof PlayConfigError && thrown.reason === "sa-json-invalid");
  thrown = null;
  await getAccessToken("{}").catch((err) => { thrown = err; });
  ok("SA JSON missing fields → PlayConfigError reason sa-json-incomplete",
      thrown instanceof PlayConfigError && thrown.reason === "sa-json-incomplete");

  // probePlayConfig — the runbook's garbage-token sanity check as code
  // (Vigil runs it hourly). It must never throw.
  let probe = await probePlayConfig({saJson: "   "});
  ok("probe: empty secret → sa-json-missing",
      probe.ok === false && probe.reason === "sa-json-missing");

  probe = await probePlayConfig({
    saJson: "x",
    getToken: async () => { throw new PlayConfigError("invalid_grant", "token-fetch-failed"); },
  });
  ok("probe: OAuth token failure → token-fetch-failed",
      probe.ok === false && probe.reason === "token-fetch-failed");

  probe = await probePlayConfig({
    saJson: "x",
    getToken: async () => "tok",
    fetchImpl: async () => ({status: 404}),
  });
  ok("probe: Google rejects only the garbage token (404) → wiring OK",
      probe.ok === true);

  probe = await probePlayConfig({
    saJson: "x",
    getToken: async () => "tok",
    fetchImpl: async () => ({status: 403}),
  });
  ok("probe: Play API 403 → play-api-rejected",
      probe.ok === false && probe.reason === "play-api-rejected");

  probe = await probePlayConfig({
    saJson: "x",
    getToken: async () => "tok",
    fetchImpl: async () => ({status: 500, ok: false}),
  });
  ok("probe: Play 5xx → transient (not a config verdict)",
      probe.ok === false && probe.reason === "transient");

  probe = await probePlayConfig({
    saJson: "x",
    getToken: async () => "tok",
    fetchImpl: async () => { throw new Error("socket hang up"); },
  });
  ok("probe: network error → transient, never throws",
      probe.ok === false && probe.reason === "transient");

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
