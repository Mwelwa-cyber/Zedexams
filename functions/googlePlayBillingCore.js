/**
 * functions/googlePlayBillingCore.js
 *
 * Pure helpers for Google Play Billing purchase verification — no
 * firebase-functions / firebase-admin imports so they run under plain
 * `node functions/googlePlayBillingCore.test.js` (same *Core.js split as
 * metaWhatsAppCore.js). The effectful half (Play Developer API calls +
 * Firestore writes) lives in googlePlayBilling.js.
 *
 * KEEP IN SYNC: PLAY_PRODUCT_TO_PLAN must stay the exact inverse of
 * PLAY_SUBS in src/utils/playBillingCatalog.js (enforced by
 * scripts/test-play-catalog-mirror.mjs) and match the subscription
 * products configured in the Google Play Console.
 */

const crypto = require("node:crypto");

// Google Play subscription productId → functions/plans.js planId.
const PLAY_PRODUCT_TO_PLAN = {
  learner_premium_weekly: "weekly",
  learner_premium_monthly: "monthly",
  teacher_pro_monthly: "pro_monthly",
  teacher_pro_yearly: "pro_yearly",
  teacher_max_monthly: "max_monthly",
  teacher_max_yearly: "max_yearly",
};

function planIdForPlayProduct(productId) {
  return PLAY_PRODUCT_TO_PLAN[productId] || null;
}

// Google Play's ObfuscatedAccountId (and Apple's appAccountToken) are capped
// at 64 chars, so this is the ceiling we can bind to a purchase.
const OBFUSCATED_ACCOUNT_ID_MAX = 64;

/**
 * The obfuscated account id we bind a purchase to for a given ZedExams uid.
 * A Firebase uid is already an opaque, non-PII token (no email/name), so we
 * bind it verbatim — which makes the server-side check a clean equality
 * (issue #1596). MUST match src/utils/playBillingCatalog.js's copy exactly
 * (asserted by scripts/test-play-catalog-mirror.mjs) since the client sets
 * this at purchase time and the server re-derives it to compare.
 *
 * Returns "" (→ binding skipped / treated as absent, never rejected) when
 * there's no usable uid or it would exceed Play's 64-char cap. In practice
 * Firebase Auth uids are 28 chars, so the cap only guards custom-token uids.
 */
function obfuscatedAccountIdForUid(uid) {
  const s = typeof uid === "string" ? uid : "";
  if (!s || s.length > OBFUSCATED_ACCOUNT_ID_MAX) return "";
  return s;
}

/**
 * Compare the obfuscated account id Google recorded against the purchase
 * (from externalAccountIdentifiers) with the one we'd derive for the
 * authenticated caller. Pure so the rollout policy is unit-testable.
 *
 *  - "match":    present AND equals our derived id → the legitimate buyer.
 *  - "absent":   no id on the purchase (legacy/in-flight client, or a uid we
 *                can't bind) → unverifiable; NEVER rejected, so old tokens
 *                and mid-rollout purchases keep working.
 *  - "mismatch": present but does NOT equal our derived id → a token being
 *                claimed by the wrong account. Rejected only under enforce.
 *
 * @returns {{kind: "match"|"absent"|"mismatch", reject: boolean}}
 */
function evaluateAccountBinding({obfuscatedAccountId, uid, enforce}) {
  const expected = obfuscatedAccountIdForUid(uid);
  const present = typeof obfuscatedAccountId === "string" && obfuscatedAccountId.length > 0;
  let kind;
  if (!present || !expected) {
    kind = "absent";
  } else {
    kind = obfuscatedAccountId === expected ? "match" : "mismatch";
  }
  return {kind, reject: !!enforce && kind === "mismatch"};
}

/**
 * Deterministic payments/{id} for a Play purchase. Keyed on
 * (purchaseToken, expiryTimeMillis) — NOT the token alone — because a
 * renewal is the SAME token with a LATER expiry. Keying on both makes
 * every renewal a fresh payments doc that flows through the one
 * idempotent activation chokepoint (grantExpiryAt pins the expiry, so
 * nothing stacks), while a same-period re-verification derives the same
 * id and no-ops on the existing status guard.
 */
function derivePaymentId(purchaseToken, expiryTimeMillis) {
  const hash = crypto
      .createHash("sha256")
      .update(`${purchaseToken}|${expiryTimeMillis}`)
      .digest("hex");
  return `gp_${hash.slice(0, 40)}`;
}

/**
 * Extract what activation needs from a purchases.subscriptionsv2.get
 * response body. Returns null when the body has no usable line items.
 * expiryTimeMs is the max across line items (single-product carts here,
 * but Play models every purchase as a line-item list).
 */
function parseSubscriptionV2(body) {
  if (!body || typeof body !== "object") return null;
  const items = Array.isArray(body.lineItems) ? body.lineItems : [];
  let productId = null;
  let basePlanId = null;
  let expiryTimeMs = 0;
  for (const item of items) {
    if (!productId && item.productId) productId = String(item.productId);
    if (!basePlanId && item.offerDetails && item.offerDetails.basePlanId) {
      basePlanId = String(item.offerDetails.basePlanId);
    }
    const t = Date.parse(item.expiryTime || "");
    if (Number.isFinite(t) && t > expiryTimeMs) expiryTimeMs = t;
  }
  if (!productId) return null;
  // The obfuscated account id the buyer's client bound at purchase time
  // (BillingFlowParams.setObfuscatedAccountId → Play records it here). Used
  // to verify the purchase belongs to the authenticated ZedExams uid.
  const ext = body.externalAccountIdentifiers || {};
  const obfuscatedAccountId = ext.obfuscatedExternalAccountId ?
    String(ext.obfuscatedExternalAccountId) : "";
  return {
    productId,
    basePlanId,
    expiryTimeMs,
    state: String(body.subscriptionState || ""),
    acknowledged:
      String(body.acknowledgementState || "") ===
      "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    orderId: body.latestOrderId ? String(body.latestOrderId) : null,
    obfuscatedAccountId,
  };
}

// States where the buyer is entitled right now. CANCELED means auto-renew
// was switched off but the paid period still runs — access stays until
// expiryTime passes (matching Play policy and buyer expectation).
const ACTIVE_STATES = [
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
  "SUBSCRIPTION_STATE_CANCELED",
];

/**
 * The never-downgrade brain. Decides what a verified Play subscription
 * means for the user doc:
 *
 *  - activate: state is entitled AND the expiry is in the future.
 *  - expire:   Google says the sub has lapsed (expired / on-hold / paused /
 *              revoked) AND this user's premium is Play-managed by THIS
 *              token AND they still look active locally. Writing Google's
 *              (past) expiry lapses access at read time.
 *  - noop:     everything else. Crucially: a user whose subscription came
 *              from Lenco / an admin grant / a different Play token is
 *              NEVER lapsed by a stale token — web subscriptions must be
 *              untouchable from the Android path.
 *
 * @param {Object} args
 * @param {string} args.state           subscriptionState from Play.
 * @param {number} args.expiryTimeMs    parsed expiryTime (ms epoch).
 * @param {number} args.nowMs           clock, injectable for tests.
 * @param {Object} args.user            users/{uid} snapshot data (needs
 *   subscriptionProvider, googlePlayPurchaseToken, subscriptionExpiryMs).
 * @param {string} args.purchaseToken   token being verified.
 * @returns {{action: "activate"|"expire"|"noop", reason?: string}}
 */
function decideEntitlementUpdate({state, expiryTimeMs, nowMs, user, purchaseToken}) {
  const activeNow = ACTIVE_STATES.includes(state) && expiryTimeMs > nowMs;
  if (activeNow) return {action: "activate"};
  const u = user || {};
  if (u.subscriptionProvider !== "google_play") {
    return {action: "noop", reason: "not-play-managed"};
  }
  if (!purchaseToken || u.googlePlayPurchaseToken !== purchaseToken) {
    return {action: "noop", reason: "token-mismatch"};
  }
  const currentExpiryMs = Number(u.subscriptionExpiryMs || 0);
  if (!currentExpiryMs || currentExpiryMs <= nowMs) {
    return {action: "noop", reason: "already-lapsed"};
  }
  return {action: "expire"};
}

module.exports = {
  PLAY_PRODUCT_TO_PLAN,
  planIdForPlayProduct,
  obfuscatedAccountIdForUid,
  evaluateAccountBinding,
  OBFUSCATED_ACCOUNT_ID_MAX,
  derivePaymentId,
  parseSubscriptionV2,
  ACTIVE_STATES,
  decideEntitlementUpdate,
};
