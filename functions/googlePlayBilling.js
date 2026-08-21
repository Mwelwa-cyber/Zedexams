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
  playProductType,
  PLAY_PRODUCT_TYPE,
  derivePaymentId,
  parseSubscriptionV2,
  parseProductPurchase,
  decideProductGrant,
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
 * when the JSON doesn't parse or lacks a client_email; the sa-json-* reasons
 * already cover those.
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

/**
 * GET purchases.products for a ONE-TIME purchase token.
 *
 * Same 404/400 → null and 401/403 → PlayConfigError contract as
 * fetchSubscriptionV2, deliberately: the caller branches on product TYPE,
 * not on which failure shape came back, so the two endpoints have to fail
 * identically or every error path needs writing twice.
 *
 * Unlike the subscription endpoint this one NEEDS the productId in the
 * URL — which is why the client sends it alongside the token and why an
 * unmapped productId is refused before we get here.
 */
async function fetchProductPurchase({accessToken, productId, purchaseToken, fetchImpl = fetch}) {
  const url = `${API_BASE}/${PLAY_PACKAGE}/purchases/products/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetchImpl(url, {
    headers: {Authorization: `Bearer ${accessToken}`},
  });
  if (res.status === 404 || res.status === 400) return null;
  if (res.status === 401 || res.status === 403) {
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
 * Acknowledge a ONE-TIME purchase. Same three-day stake as a subscription:
 * the app buys with autoAcknowledgePurchases:false, so money is only kept
 * once we have verified and granted, and a purchase we never managed to
 * verify is auto-refunded rather than silently kept.
 *
 * NOT consume(). Consuming marks a product re-purchasable and throws away
 * the record we use to recognise the token again; a day pass is bought
 * once and its token has to stay queryable so a restore-on-open can prove
 * the grant it already made.
 */
async function acknowledgeProduct({accessToken, productId, purchaseToken, fetchImpl = fetch}) {
  const url = `${API_BASE}/${PLAY_PACKAGE}/purchases/products/` +
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
 *
 * Handles BOTH Play product types. Which one is decided by the productId
 * the client sends alongside the token: a one-time pass is read from
 * purchases.products, a subscription from purchases.subscriptionsv2.
 * Sending no productId (or a subscription one) takes the subscription
 * path, which is what every pre-existing caller does.
 *
 * ── A guardian may buy for a child here, exactly as on the web ──────
 *
 * `beneficiaryUid` credits the purchase to a linked child instead of the
 * payer, matching the Lenco rail (see functions/guardianBillingCore.js).
 * It MUST already have been authorised by
 * guardianBillingAuth.authoriseGuardianPurchase — this function trusts
 * it, because it has no way to re-derive who a caller's children are and
 * a second, different check is how the two rails drift apart. The caller
 * that does authorise it is paymentHandlers.verifyGooglePlayPurchase.
 *
 * The obfuscated account id still binds to the PAYER's uid, not the
 * child's: it is Google's record of which device account bought this, and
 * the buyer is the parent. Binding it to the beneficiary would make every
 * guardian purchase look like a cross-account replay.
 *
 * Injectable deps (all optional): db, activate, fetchSubscription,
 * fetchProduct, acknowledge, acknowledgeOneTime, nowMs.
 *
 * @returns {Promise<{status: string, productId?: string, planId?: string,
 *   expiryTime?: string|null, activated?: boolean, alreadyActive?: boolean,
 *   reason?: string}>} status ∈ active | expired | noop | not_found |
 *   wrong_user | unknown_product | account_mismatch.
 */
async function verifyAndApplyPurchase({
  uid,
  purchaseToken,
  productId: declaredProductId = "",
  accessToken = null,
  emailSecrets = {},
  db = null,
  activate = null,
  fetchSubscription = null,
  fetchProduct = null,
  acknowledge = null,
  acknowledgeOneTime = null,
  fetchImpl = fetch,
  nowMs = Date.now(),
  enforceAccountBinding = enforceAccountBindingFromEnv(),
  recordBinding = null,
  beneficiaryUid = null,
  beneficiaryName = null,
  guardianRequestId = null,
}) {
  if (!uid || !purchaseToken) return {status: "not_found"};

  const firestore = db || admin.firestore();
  const activateImpl = activate ||
    require("./subscriptionActivation").activateSubscriptionFromPayment;
  const fetchSub = fetchSubscription ||
    ((args) => fetchSubscriptionV2({accessToken, fetchImpl, ...args}));
  const fetchProd = fetchProduct ||
    ((args) => fetchProductPurchase({accessToken, fetchImpl, ...args}));
  const ackImpl = acknowledge ||
    ((args) => acknowledgeSubscription({accessToken, fetchImpl, ...args}));
  const ackProductImpl = acknowledgeOneTime ||
    ((args) => acknowledgeProduct({accessToken, fetchImpl, ...args}));

  // Which endpoint answers for this token. The client's productId only
  // CHOOSES the endpoint — every fact used below still comes out of
  // Google's response, so a client naming the wrong product gets a 404
  // (→ not_found) rather than a grant it did not pay for.
  const isOneTime =
    playProductType(String(declaredProductId || "")) === PLAY_PRODUCT_TYPE.INAPP;

  let parsed;
  if (isOneTime) {
    const body = await fetchProd({productId: declaredProductId, purchaseToken});
    const product = parseProductPurchase(body);
    if (!product) return {status: "not_found"};
    parsed = {
      productId: product.productId,
      // A pass has no store-owned renewal date. Left at 0 so nothing
      // downstream writes a `grantExpiryAt` and the plan's own
      // durationDays does the arithmetic — which is what makes a pass
      // bought during an active month EXTEND it rather than truncate it.
      expiryTimeMs: 0,
      purchaseTimeMs: product.purchaseTimeMs,
      acknowledged: product.acknowledged,
      orderId: product.orderId,
      obfuscatedAccountId: product.obfuscatedAccountId,
      purchaseState: product.purchaseState,
    };
  } else {
    const body = await fetchSub({purchaseToken});
    const sub = parseSubscriptionV2(body);
    if (!sub) return {status: "not_found"};
    parsed = {...sub, purchaseTimeMs: 0};
  }

  const planId = planIdForPlayProduct(parsed.productId);
  const plan = planId ? getPlan(planId) : null;
  if (!planId || !plan) {
    console.error(
        `[googlePlayBilling] purchase for unmapped Play product "${parsed.productId}" (uid ${uid})`);
    return {status: "unknown_product", productId: parsed.productId};
  }

  // Account binding (issue #1596): the buyer's client stamps its ZedExams
  // uid as the obfuscated account id at purchase time; Google echoes it
  // back here. Observe by default, reject a present-but-mismatched id only
  // under enforce. Absent ids (legacy / pre-update clients) always fall
  // through. The uid compared is the PAYER's — see the docblock.
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

  const decision = isOneTime ?
    decideProductGrant({purchaseState: parsed.purchaseState}) :
    decideEntitlementUpdate({
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
    // ── Already paying on the other rail? ───────────────────────────
    //
    // Checked HERE rather than above because the question is only ever
    // about a GRANT. A verification that resolves to noop or expire is
    // not a purchase — there is nothing to refuse and nothing to refund —
    // and refusing those would turn a routine re-check of an old token
    // into a false double-purchase report.
    //
    // By the time we reach a grant Google has ALREADY taken the money, so
    // this cannot prevent the charge, only the entitlement. That is still
    // right: refusing the write leaves the purchase unacknowledged, and an
    // unacknowledged Play purchase is auto-refunded after three days. The
    // parent gets their money back without anyone having to notice.
    //
    // Logged as an error rather than a warning because those three days
    // are a deadline: if the automatic refund does not happen it has to
    // happen by hand, and this line is the only record that it is owed.
    const {RAIL, decideCrossRail} = await import("./shared/billing/crossRailCore.js");
    const accounts = [{who: "payer", user}];
    if (beneficiaryUid) {
      try {
        const childSnap = await firestore.collection("users").doc(beneficiaryUid).get();
        if (childSnap.exists) accounts.push({who: "child", user: childSnap.data()});
      } catch (err) {
        // A failed read must not block a legitimate purchase; the payer's
        // own document is where a web subscription lives anyway.
        console.warn("[googlePlayBilling] beneficiary read failed", err?.message || err);
      }
    }
    const crossRail = decideCrossRail({rail: RAIL.PLAY, accounts, nowMs});
    if (!crossRail.allowed) {
      console.error(
          "[googlePlayBilling] DOUBLE PURCHASE — Play grant refused, refund owed",
          {
            uid,
            who: crossRail.who,
            existingRail: crossRail.existing?.rail,
            existingExpiresAt: new Date(crossRail.existing?.expiresAtMs || 0).toISOString(),
            productId: parsed.productId,
            // Deliberately NOT the purchase token — it is a bearer
            // credential and logs are read widely. The order id is what a
            // refund is issued against in Play Console.
            orderId: parsed.orderId,
          },
      );
      return {
        status: "cross_rail_conflict",
        productId: parsed.productId,
        planId,
        reason: crossRail.reason,
        existingRail: crossRail.existing?.rail || null,
      };
    }

    // Keyed on (token, period). For a subscription the period is the
    // expiry, so each renewal is a fresh doc through the one idempotent
    // activation chokepoint. A pass never renews, so its purchase time —
    // constant for the life of the token — plays the same role and makes
    // re-verification a no-op on the existing status guard.
    const periodKey = isOneTime ? parsed.purchaseTimeMs : parsed.expiryTimeMs;
    const paymentId = derivePaymentId(purchaseToken, periodKey);
    const payRef = firestore.collection("payments").doc(paymentId);

    const {guardianPaymentFields} = require("./guardianBillingCore");
    const guardianFields = guardianPaymentFields({
      beneficiaryUid,
      beneficiaryName,
      guardianRequestId,
    });

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
        // The PAYER. `beneficiaryUid` (below, when present) is who the
        // grant CREDITS — subscriptionActivation resolves the pair through
        // guardianBillingCore.creditedUid, the same as on the web rail.
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
        googlePlayState: isOneTime ? `PRODUCT_STATE_${parsed.purchaseState}` : parsed.state,
        googlePlayProductType: isOneTime ? "inapp" : "subs",
        // Subscriptions only. Google owns a subscription's renewal date, so
        // activation pins to it; a pass has none and must fall through to
        // the plan's durationDays instead.
        ...(isOneTime ? {} : {
          grantExpiryAt: admin.firestore.Timestamp.fromMillis(parsed.expiryTimeMs),
        }),
        ...guardianFields,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    if (wrongUser) {
      console.warn(`[googlePlayBilling] token replay across accounts (uid ${uid})`);
      return {status: "wrong_user", productId: parsed.productId, planId};
    }

    const result = await activateImpl({
      paymentId,
      lencoStatus: isOneTime ? "successful" : parsed.state,
      emailSecrets,
    });

    if (!parsed.acknowledged) {
      try {
        const ack = isOneTime ? ackProductImpl : ackImpl;
        await ack({productId: parsed.productId, purchaseToken});
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
  fetchProductPurchase,
  acknowledgeSubscription,
  acknowledgeProduct,
  verifyAndApplyPurchase,
  probePlayConfig,
  describeSaIdentity,
  PLAY_PACKAGE,
};
