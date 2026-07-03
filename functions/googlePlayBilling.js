/**
 * functions/googlePlayBilling.js
 *
 * Server-side Google Play purchase verification. The Android app sends a
 * purchase token (fresh purchase or restore-on-open); this module verifies
 * it against the Google Play Developer API, then funnels the grant through
 * the SAME idempotent activation chokepoint the Lenco flow uses
 * (subscriptionActivation.activateSubscriptionFromPayment) via a
 * payments/{gp_*} doc with provider:"google_play".
 *
 * Pure decision logic (product↔plan map, payment-id derivation, response
 * parsing, the never-downgrade rules) lives in googlePlayBillingCore.js.
 * Effectful deps (fetch, Firestore, activation) are injectable for tests,
 * mirroring lencoWebhookProcessor.js / Till.
 *
 * Self-healing note: if a crash lands between creating the pending
 * payments doc and activation completing, the NEXT verify of the same
 * token+expiry re-derives the same doc id and re-runs activation, which
 * finishes the job. Till's hourly reconcile intentionally skips
 * non-"lenco" providers, so re-entry here is the recovery path — which is
 * also why `provider` is always set on Play docs (a provider-less pending
 * doc would fall into Till's Lenco lookup).
 */

const admin = require("firebase-admin");

const {getPlan} = require("./plans");
const {
  planIdForPlayProduct,
  derivePaymentId,
  parseSubscriptionV2,
  decideEntitlementUpdate,
} = require("./googlePlayBillingCore");

const PLAY_PACKAGE = "com.zedexams.android";
const API_BASE =
  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/** Configuration problem (bad/missing service account, API not enabled) —
 * surfaced to the client as failed-precondition, not a payment failure. */
class PlayConfigError extends Error {}

// One JWT client per service-account email; google-auth-library caches and
// refreshes its own access tokens, so this doubles as the token cache.
let cachedJwt = null;
let cachedJwtEmail = null;

async function getAccessToken(saJsonString) {
  let sa;
  try {
    sa = JSON.parse(String(saJsonString || ""));
  } catch {
    throw new PlayConfigError("GOOGLE_PLAY_SA_JSON is not valid JSON");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new PlayConfigError("GOOGLE_PLAY_SA_JSON is missing client_email/private_key");
  }
  if (!cachedJwt || cachedJwtEmail !== sa.client_email) {
    const {JWT} = require("google-auth-library");
    cachedJwt = new JWT({email: sa.client_email, key: sa.private_key, scopes: [SCOPE]});
    cachedJwtEmail = sa.client_email;
  }
  const {token} = await cachedJwt.getAccessToken();
  if (!token) throw new PlayConfigError("could not obtain Play API access token");
  return token;
}

/**
 * GET purchases.subscriptionsv2 for a purchase token.
 * Returns the response body, or null when Google says the token doesn't
 * exist / is malformed (404 or 400 — a user-supplied garbage token, not an
 * outage). 401/403 mean OUR credentials/linkage are wrong → PlayConfigError.
 */
async function fetchSubscriptionV2({accessToken, purchaseToken, fetchImpl = fetch}) {
  const url = `${API_BASE}/${PLAY_PACKAGE}/purchases/subscriptionsv2/tokens/` +
    encodeURIComponent(purchaseToken);
  const res = await fetchImpl(url, {
    headers: {Authorization: `Bearer ${accessToken}`},
  });
  if (res.status === 404 || res.status === 400) return null;
  if (res.status === 401 || res.status === 403) {
    throw new PlayConfigError(`Play API rejected our credentials (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`Play API error ${res.status}`);
  }
  return await res.json();
}

/**
 * Acknowledge a subscription purchase (v1 endpoint — v2 has no acknowledge).
 * The app purchases with autoAcknowledgePurchases:false so money is only
 * kept once the backend has verified + granted; unacknowledged purchases
 * are auto-refunded by Google after 3 days, which is the correct failure
 * mode for a purchase we never managed to verify.
 */
async function acknowledgeSubscription({accessToken, productId, purchaseToken, fetchImpl = fetch}) {
  const url = `${API_BASE}/${PLAY_PACKAGE}/purchases/subscriptions/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(`acknowledge failed (${res.status})`);
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Verify one purchase token for one signed-in user and apply the result.
 * Injectable deps (all optional): db, activate, fetchSubscription,
 * acknowledge, nowMs — production wiring passes accessToken/emailSecrets
 * and uses the real implementations.
 *
 * @returns {Promise<{status: string, productId?: string, planId?: string,
 *   expiryTime?: string|null, activated?: boolean, alreadyActive?: boolean,
 *   reason?: string}>} status ∈ active | expired | noop | not_found |
 *   wrong_user | unknown_product.
 */
async function verifyAndApplyPurchase({
  uid,
  purchaseToken,
  accessToken = null,
  emailSecrets = {},
  db = null,
  activate = null,
  fetchSubscription = null,
  acknowledge = null,
  fetchImpl = fetch,
  nowMs = Date.now(),
}) {
  if (!uid || !purchaseToken) return {status: "not_found"};

  const firestore = db || admin.firestore();
  const activateImpl = activate ||
    require("./subscriptionActivation").activateSubscriptionFromPayment;
  const fetchSub = fetchSubscription ||
    ((args) => fetchSubscriptionV2({accessToken, fetchImpl, ...args}));
  const ackImpl = acknowledge ||
    ((args) => acknowledgeSubscription({accessToken, fetchImpl, ...args}));

  const body = await fetchSub({purchaseToken});
  const parsed = parseSubscriptionV2(body);
  if (!parsed) return {status: "not_found"};

  const planId = planIdForPlayProduct(parsed.productId);
  const plan = planId ? getPlan(planId) : null;
  if (!planId || !plan) {
    console.error(
        `[googlePlayBilling] purchase for unmapped Play product "${parsed.productId}" (uid ${uid})`);
    return {status: "unknown_product", productId: parsed.productId};
  }

  const userRef = firestore.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return {status: "noop", reason: "no-user"};
  const user = userSnap.data() || {};

  const decision = decideEntitlementUpdate({
    state: parsed.state,
    expiryTimeMs: parsed.expiryTimeMs,
    nowMs,
    user: {
      subscriptionProvider: user.subscriptionProvider,
      googlePlayPurchaseToken: user.googlePlayPurchaseToken,
      subscriptionExpiryMs: toMillis(user.subscriptionExpiry),
    },
    purchaseToken,
  });

  const expiryIso = parsed.expiryTimeMs ?
    new Date(parsed.expiryTimeMs).toISOString() : null;

  if (decision.action === "activate") {
    const paymentId = derivePaymentId(purchaseToken, parsed.expiryTimeMs);
    const payRef = firestore.collection("payments").doc(paymentId);

    // Create the pending payment doc exactly once; if another account
    // already owns this token+period, refuse (cross-account replay guard).
    let wrongUser = false;
    await firestore.runTransaction(async (tx) => {
      // Reset per-attempt: runTransaction may re-invoke this callback on
      // contention, so transaction-local state must not leak across retries.
      wrongUser = false;
      const snap = await tx.get(payRef);
      if (snap.exists) {
        const existing = snap.data() || {};
        if (existing.userId && existing.userId !== uid) wrongUser = true;
        return; // same user: fall through to (re-)activation — self-heals strands
      }
      tx.set(payRef, {
        userId: uid,
        displayName: user.displayName || "",
        email: user.email || "",
        userRole: user.role || "",
        planId,
        planName: plan.name,
        // ZMW list price, for admin revenue dashboards only — Google is
        // authoritative on the money actually collected.
        amountZMW: plan.priceZMW,
        currency: "ZMW",
        provider: "google_play",
        method: "google_play",
        paymentReference: parsed.orderId || "",
        status: "pending",
        googlePlayProductId: parsed.productId,
        googlePlayPurchaseToken: purchaseToken,
        googlePlayOrderId: parsed.orderId || null,
        googlePlayState: parsed.state,
        grantExpiryAt: admin.firestore.Timestamp.fromMillis(parsed.expiryTimeMs),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    if (wrongUser) {
      console.warn(`[googlePlayBilling] token replay across accounts (uid ${uid})`);
      return {status: "wrong_user", productId: parsed.productId, planId};
    }

    const result = await activateImpl({
      paymentId,
      lencoStatus: parsed.state,
      emailSecrets,
    });

    if (!parsed.acknowledged) {
      try {
        await ackImpl({productId: parsed.productId, purchaseToken});
      } catch (err) {
        // Non-fatal: acknowledgementState stays pending server-side, so the
        // next verify/restore retries within Google's 3-day window.
        console.error("[googlePlayBilling] acknowledge failed", err);
      }
    }

    return {
      status: "active",
      productId: parsed.productId,
      planId,
      expiryTime: expiryIso,
      activated: !!(result && result.activated),
      alreadyActive: !!(result && result.alreadyActive),
    };
  }

  if (decision.action === "expire") {
    const lapseMs = parsed.expiryTimeMs || nowMs;
    const update = {
      subscriptionExpiry: admin.firestore.Timestamp.fromMillis(lapseMs),
      googlePlaySyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Keep the teacher studio gate in step (it reads its own expiry field).
    const sp = String(user.subscriptionPlan || "");
    if (sp.startsWith("pro_") || sp.startsWith("max_")) {
      update.teacherPlanExpiresAt = admin.firestore.Timestamp.fromMillis(lapseMs);
    }
    await userRef.update(update);
    return {
      status: "expired",
      productId: parsed.productId,
      planId,
      expiryTime: expiryIso,
    };
  }

  return {
    status: "noop",
    reason: decision.reason,
    productId: parsed.productId,
    planId,
    expiryTime: expiryIso,
  };
}

module.exports = {
  PlayConfigError,
  getAccessToken,
  fetchSubscriptionV2,
  acknowledgeSubscription,
  verifyAndApplyPurchase,
  PLAY_PACKAGE,
};
