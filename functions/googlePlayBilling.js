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
  evaluateAccountBinding,
} = require("./googlePlayBillingCore");

const PLAY_PACKAGE = "com.zedexams.android";
const API_BASE =
  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/** Configuration problem (bad/missing service account, API not enabled) —
 * surfaced to the client as failed-precondition, not a payment failure.
 * `reason` pins WHICH config stage broke (sa-json-missing / sa-json-invalid /
 * sa-json-incomplete / token-fetch-failed / play-api-rejected) so the failure
 * is diagnosable from the thrown error alone — all stages otherwise collapse
 * into one client-facing message and need a Cloud Logging dive to tell apart. */
class PlayConfigError extends Error {
  constructor(message, reason = "config") {
    super(message);
    this.reason = reason;
  }
}

// One JWT client per service-account email; google-auth-library caches and
// refreshes its own access tokens, so this doubles as the token cache.
let cachedJwt = null;
let cachedJwtEmail = null;

/**
 * Parse GOOGLE_PLAY_SA_JSON into the service-account object, tolerating the two
 * ways `firebase functions:secrets:set` + copy-paste routinely mangle it (the
 * incident this guards against — a mis-set secret took Play verification down):
 *
 *   1. the whole object wrapped in a pair of SINGLE quotes ('{...}') — not
 *      valid JSON, so a bare JSON.parse throws;
 *   2. the object double-encoded as a JSON string ("{\"type\":...}") — a bare
 *      JSON.parse yields the *string*, not the object.
 *
 * Both self-heal here; anything still unparseable throws the same
 * `sa-json-invalid` as before, so a genuinely bad/empty secret is not masked.
 * Mirrors normalizePem()'s tolerance for the GitHub App key (monitor.js).
 */
function parseServiceAccountJson(saJsonString) {
  let value = String(saJsonString || "").trim();
  // A single-quote wrapper is never valid JSON; strip one matched pair so the
  // common `'{...}'` paste parses. (Double-quote wrapping needs no special
  // case — a JSON-encoded object is itself valid JSON, handled by the
  // double-decode below.)
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1).trim();
  }
  const invalid = () =>
    new PlayConfigError("GOOGLE_PLAY_SA_JSON is not valid JSON", "sa-json-invalid");
  let sa;
  try {
    sa = JSON.parse(value);
  } catch {
    throw invalid();
  }
  // Double-encoded: the first parse returns a string; parse once more to reach
  // the object. Exactly one extra hop — never loop.
  if (typeof sa === "string") {
    try {
      sa = JSON.parse(sa);
    } catch {
      throw invalid();
    }
  }
  if (!sa || typeof sa !== "object") throw invalid();
  return sa;
}

async function getAccessToken(saJsonString) {
  const sa = parseServiceAccountJson(saJsonString);
  if (!sa.client_email || !sa.private_key) {
    throw new PlayConfigError(
        "GOOGLE_PLAY_SA_JSON is missing client_email/private_key", "sa-json-incomplete");
  }
  if (!cachedJwt || cachedJwtEmail !== sa.client_email) {
    const {JWT} = require("google-auth-library");
    cachedJwt = new JWT({email: sa.client_email, key: sa.private_key, scopes: [SCOPE]});
    cachedJwtEmail = sa.client_email;
  }
  let token;
  try {
    ({token} = await cachedJwt.getAccessToken());
  } catch (err) {
    // e.g. invalid_grant on a revoked/malformed key — a config problem, not
    // a transient one, so it must carry a reason like the parse failures.
    throw new PlayConfigError(
        `could not obtain Play API access token: ${String(err?.message || err)}`,
        "token-fetch-failed");
  }
  if (!token) throw new PlayConfigError("could not obtain Play API access token", "token-fetch-failed");
  return token;
}

/**
 * Google returns a JSON error body on a rejected androidpublisher call whose
 * `error.status` / `error.message` name the exact cause — `SERVICE_DISABLED`
 * ("Google Play Android Developer API has not been used… or it is disabled",
 * with an enable link) vs `PERMISSION_DENIED` ("The current user has
 * insufficient permissions", i.e. the SA isn't invited in Play Console).
 * Surfacing it turns the otherwise-opaque 401/403 into a one-line fix instead
 * of a Cloud Logging dive. Best-effort + bounded: never let body reading mask
 * the config error, and stay resilient to injected fetch stubs with no text().
 */
async function readPlayErrorDetail(res) {
  try {
    if (typeof res.text !== "function") return "";
    const raw = String((await res.text()) || "").slice(0, 400);
    if (!raw) return "";
    try {
      const err = JSON.parse(raw)?.error;
      const msg = err?.message || err?.error_description || err?.status;
      if (msg) {
        return ` — ${msg}${err?.status && err.status !== msg ? ` [${err.status}]` : ""}`;
      }
    } catch { /* not JSON — surface the raw body */ }
    return ` — ${raw}`;
  } catch {
    return "";
  }
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
    // 403 → the SA authenticated but Play refused it: not invited in Play
    // Console (needs Manage orders + View financial data) OR the Android
    // Publisher API is disabled on its Cloud project. 401 → the credentials
    // weren't accepted at all: the SA JSON is from a Cloud project not linked
    // to this Play account, or the key was rotated. Google's own detail says
    // which — see the "Fixing play-api-rejected" runbook in the docs.
    const detail = await readPlayErrorDetail(res);
    throw new PlayConfigError(
        `Play API rejected our credentials (${res.status})${detail}`, "play-api-rejected");
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

/**
 * Best-effort "which key is this?" for probe failure messages: the SA's
 * client_email plus the first 8 chars of its private_key_id. Both are public
 * identifiers, not secret material. Naming them in the hourly-monitor rollup
 * turns "Play rejected our credentials" into a checkable fact — the admin can
 * compare the email against Play Console ▸ Users and permissions (and the key
 * id against the SA's Keys tab) without opening Secret Manager. Returns ""
 * when the JSON doesn't parse; the sa-json-* reasons already cover that.
 */
function describeSaIdentity(saJsonString) {
  try {
    const sa = parseServiceAccountJson(saJsonString);
    const email = String(sa.client_email || "").trim();
    if (!email) return "";
    const keyId = String(sa.private_key_id || "").trim().slice(0, 8);
    return keyId ? `${email}, key ${keyId}…` : email;
  } catch {
    return "";
  }
}

/**
 * Prove the whole verification wiring (secret → SA JSON → OAuth token →
 * Play Developer API auth) without a real purchase, by asking Google about a
 * garbage token: a 400/404 ("token doesn't exist") means our credentials were
 * ACCEPTED and only the token was rejected — end-to-end wiring OK. This is
 * step 6 of the docs/GOOGLE-PLAY-BILLING.md runbook, as code, so Vigil can
 * run it hourly instead of a paying customer discovering a broken config.
 *
 * Never throws. `reason` mirrors PlayConfigError reasons; "transient" marks
 * a non-config failure (Play 5xx / network) the next run should retry.
 * Failure messages append the secret's SA identity (see describeSaIdentity)
 * so a wrong-account / rotated-key mismatch is visible in the rollup itself.
 *
 * @returns {Promise<{ok: boolean, reason?: string, message?: string}>}
 */
async function probePlayConfig({saJson, fetchImpl = fetch, getToken = getAccessToken} = {}) {
  if (!String(saJson || "").trim()) {
    return {ok: false, reason: "sa-json-missing", message: "GOOGLE_PLAY_SA_JSON is empty"};
  }
  try {
    const accessToken = await getToken(saJson);
    await fetchSubscriptionV2({
      accessToken,
      purchaseToken: "zedexams-vigil-config-probe",
      fetchImpl,
    });
    return {ok: true};
  } catch (err) {
    const identity = describeSaIdentity(saJson);
    const suffix = identity ? ` [SA in secret: ${identity}]` : "";
    if (err instanceof PlayConfigError) {
      return {ok: false, reason: err.reason, message: `${err.message}${suffix}`};
    }
    return {ok: false, reason: "transient", message: `${String(err?.message || err)}${suffix}`};
  }
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Whether to HARD-reject a present-but-mismatched obfuscated account id.
 * Off by default: the rollout ships observe-only (telemetry, no rejection)
 * until the counters show new purchases reliably carry a matching id, then
 * flips on via `PLAY_ENFORCE_ACCOUNT_BINDING=1` on the deploy — the same
 * graduated pattern as App Check (see softVerifyAppCheckHttp). Absent ids are
 * NEVER rejected regardless (evaluateAccountBinding never sets reject on
 * "absent"), so legacy/in-flight purchases keep working.
 */
function enforceAccountBindingFromEnv() {
  return process.env.PLAY_ENFORCE_ACCOUNT_BINDING === "1";
}

/**
 * Best-effort per-day rollup of account-binding outcomes (issue #1596), the
 * playBindingHealth mirror of appCheckHealth. Lets the rollout be observed
 * (how many purchases carry a matching / mismatched / absent id) before
 * enforcement is switched on. Never throws — telemetry must not fail a grant.
 * `date` is derived from the injected clock so it's deterministic under test.
 */
async function recordAccountBinding({firestore, kind, enforce, dateMs}) {
  try {
    const date = new Date(dateMs).toISOString().slice(0, 10);
    const ref = firestore.collection("playBindingHealth").doc(date);
    // Defensive: the in-memory test stub has no set()/increment(); skip
    // rather than throw so existing verify tests stay quiet.
    if (typeof ref.set !== "function") return;
    const inc = (n) => admin.firestore.FieldValue.increment(n);
    await ref.set({
      date,
      total: inc(1),
      [`${kind}`]: inc(1),
      ...(enforce && kind === "mismatch" ? {rejected: inc(1)} : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  } catch (err) {
    console.warn("[googlePlayBilling] binding health write failed", err?.message || err);
  }
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
  enforceAccountBinding = enforceAccountBindingFromEnv(),
  recordBinding = null,
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

  // Account binding (issue #1596): the buyer's client stamps its ZedExams uid
  // as the obfuscated account id at purchase time; Google echoes it back here.
  // Observe by default, reject a present-but-mismatched id only under enforce.
  // Absent ids (legacy / pre-update clients) always fall through.
  const binding = evaluateAccountBinding({
    obfuscatedAccountId: parsed.obfuscatedAccountId,
    uid,
    enforce: enforceAccountBinding,
  });
  const recordBindingImpl = recordBinding ||
    ((args) => recordAccountBinding({firestore, dateMs: nowMs, ...args}));
  await recordBindingImpl({kind: binding.kind, enforce: enforceAccountBinding});
  if (binding.reject) {
    console.warn(
        `[googlePlayBilling] account-binding mismatch, rejected under enforce (uid ${uid})`);
    return {status: "account_mismatch", productId: parsed.productId, planId};
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
  parseServiceAccountJson,
  getAccessToken,
  fetchSubscriptionV2,
  acknowledgeSubscription,
  verifyAndApplyPurchase,
  probePlayConfig,
  describeSaIdentity,
  PLAY_PACKAGE,
};
