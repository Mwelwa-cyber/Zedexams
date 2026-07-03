/**
 * Node test for the pure Google Play Billing helpers
 * (functions/googlePlayBillingCore.js): the product↔plan map, deterministic
 * payment-id derivation, subscriptionsv2 response parsing, and — most
 * important — decideEntitlementUpdate, the never-downgrade brain that must
 * NEVER lapse a Lenco/web subscription off the back of a stale Play token.
 *
 * Plain `node` script (repo convention). Run:
 *   node functions/googlePlayBillingCore.test.js
 */

const assert = require("node:assert");

const {
  PLAY_PRODUCT_TO_PLAN,
  planIdForPlayProduct,
  derivePaymentId,
  parseSubscriptionV2,
  ACTIVE_STATES,
  decideEntitlementUpdate,
} = require("./googlePlayBillingCore");
const {getPlan} = require("./plans");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("googlePlayBillingCore");

// ── Product ↔ plan map ────────────────────────────────────────────────────
const productIds = Object.keys(PLAY_PRODUCT_TO_PLAN);
const planIds = Object.values(PLAY_PRODUCT_TO_PLAN);
ok("map is non-empty (6 products in v1)", productIds.length === 6);
ok("plan ids are unique (bijective map)", new Set(planIds).size === planIds.length);
ok("product ids are unique", new Set(productIds).size === productIds.length);
for (const planId of planIds) {
  const plan = getPlan(planId);
  ok(`plan "${planId}" exists in plans.js with durationDays`,
      !!plan && Number(plan.durationDays) > 0);
  ok(`plan "${planId}" is a subscription, not a topup`, plan.kind !== "topup");
}
ok("lookup maps teacher_pro_monthly → pro_monthly",
    planIdForPlayProduct("teacher_pro_monthly") === "pro_monthly");
ok("unknown product → null", planIdForPlayProduct("hack_the_planet") === null);

// ── derivePaymentId ───────────────────────────────────────────────────────
const id1 = derivePaymentId("token-abc", 1750000000000);
ok("payment id is gp_-prefixed", id1.startsWith("gp_"));
ok("payment id is 43 chars (gp_ + 40 hex)", id1.length === 43);
ok("derivation is stable", derivePaymentId("token-abc", 1750000000000) === id1);
ok("later expiry (renewal) → DIFFERENT doc id",
    derivePaymentId("token-abc", 1752600000000) !== id1);
ok("different token → different id",
    derivePaymentId("token-xyz", 1750000000000) !== id1);

// ── parseSubscriptionV2 ───────────────────────────────────────────────────
const FUTURE = "2030-01-01T00:00:00Z";
const FUTURE_MS = Date.parse(FUTURE);
const activeBody = {
  subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
  acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
  latestOrderId: "GPA.1234-5678",
  lineItems: [{
    productId: "learner_premium_monthly",
    expiryTime: FUTURE,
    offerDetails: {basePlanId: "monthly"},
  }],
};
const parsedActive = parseSubscriptionV2(activeBody);
ok("parses productId", parsedActive.productId === "learner_premium_monthly");
ok("parses basePlanId", parsedActive.basePlanId === "monthly");
ok("parses expiryTime to ms", parsedActive.expiryTimeMs === FUTURE_MS);
ok("parses state", parsedActive.state === "SUBSCRIPTION_STATE_ACTIVE");
ok("pending ack → acknowledged:false", parsedActive.acknowledged === false);
ok("parses orderId", parsedActive.orderId === "GPA.1234-5678");

const ackedBody = {...activeBody, acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"};
ok("acknowledged state parses true", parseSubscriptionV2(ackedBody).acknowledged === true);

const multiLine = parseSubscriptionV2({
  subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
  lineItems: [
    {productId: "learner_premium_monthly", expiryTime: "2029-01-01T00:00:00Z"},
    {productId: "learner_premium_monthly", expiryTime: FUTURE},
  ],
});
ok("multiple line items → max expiry wins", multiLine.expiryTimeMs === FUTURE_MS);

ok("null body → null", parseSubscriptionV2(null) === null);
ok("body without line items → null", parseSubscriptionV2({subscriptionState: "X"}) === null);
ok("line items without productId → null",
    parseSubscriptionV2({lineItems: [{expiryTime: FUTURE}]}) === null);

// ── decideEntitlementUpdate: the never-downgrade matrix ───────────────────
const NOW = Date.parse("2026-07-03T12:00:00Z");
const FUT = NOW + 20 * 24 * 3600 * 1000;
const PAST = NOW - 5 * 24 * 3600 * 1000;
const TOKEN = "tok-1";
const playUser = (expiryMs) => ({
  subscriptionProvider: "google_play",
  googlePlayPurchaseToken: TOKEN,
  subscriptionExpiryMs: expiryMs,
});

function decide(state, expiryTimeMs, user, purchaseToken = TOKEN) {
  return decideEntitlementUpdate({state, expiryTimeMs, nowMs: NOW, user, purchaseToken});
}

ok("ACTIVE_STATES includes canceled (paid-through until expiry)",
    ACTIVE_STATES.includes("SUBSCRIPTION_STATE_CANCELED"));

ok("active + future expiry → activate",
    decide("SUBSCRIPTION_STATE_ACTIVE", FUT, playUser(FUT)).action === "activate");
ok("grace period + future expiry → activate",
    decide("SUBSCRIPTION_STATE_IN_GRACE_PERIOD", FUT, playUser(FUT)).action === "activate");
ok("canceled but paid-through (future expiry) → activate",
    decide("SUBSCRIPTION_STATE_CANCELED", FUT, playUser(FUT)).action === "activate");
ok("active state but PAST expiry → not activate",
    decide("SUBSCRIPTION_STATE_ACTIVE", PAST, playUser(FUT)).action !== "activate");

// Expired token vs a LENCO-provided premium — must never touch it.
const lencoUser = {
  subscriptionProvider: "lenco",
  googlePlayPurchaseToken: null,
  subscriptionExpiryMs: FUT,
};
const dLenco = decide("SUBSCRIPTION_STATE_EXPIRED", PAST, lencoUser);
ok("expired token + lenco-managed user → noop (never downgrade web)",
    dLenco.action === "noop" && dLenco.reason === "not-play-managed");

const dMismatch = decide("SUBSCRIPTION_STATE_EXPIRED", PAST, {
  ...playUser(FUT), googlePlayPurchaseToken: "some-other-token",
});
ok("expired token that isn't the user's stored token → noop",
    dMismatch.action === "noop" && dMismatch.reason === "token-mismatch");

const dLapsed = decide("SUBSCRIPTION_STATE_EXPIRED", PAST, playUser(PAST));
ok("expired + already-lapsed locally → noop (nothing to lapse)",
    dLapsed.action === "noop" && dLapsed.reason === "already-lapsed");

ok("expired + matching Play-managed active user → expire",
    decide("SUBSCRIPTION_STATE_EXPIRED", PAST, playUser(FUT)).action === "expire");
ok("on-hold + matching Play-managed active user → expire (access pauses)",
    decide("SUBSCRIPTION_STATE_ON_HOLD", PAST, playUser(FUT)).action === "expire");
ok("paused + matching Play-managed active user → expire",
    decide("SUBSCRIPTION_STATE_PAUSED", PAST, playUser(FUT)).action === "expire");
ok("revoked + matching Play-managed active user → expire",
    decide("SUBSCRIPTION_STATE_REVOKED", PAST, playUser(FUT)).action === "expire");

ok("missing user object → noop, not a crash",
    decide("SUBSCRIPTION_STATE_EXPIRED", PAST, undefined).action === "noop");

console.log(`\n${passed} passed`);
