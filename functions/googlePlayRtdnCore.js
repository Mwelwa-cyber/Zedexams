"use strict";

/**
 * googlePlayRtdnCore — reading a Google Play Real-time Developer
 * Notification, and deciding what it means. Pure: no firebase-admin, no
 * fetch, so it runs under plain `node` (the *Core.js split).
 *
 * ── Why this exists at all ──────────────────────────────────────────
 *
 * Before it, the ONLY thing that advanced a Play subscription in this
 * product was the client: `NativePlayBillingSync` re-verifies owned
 * purchases three seconds after sign-in, on a cold start, on Android.
 * That works for a learner who opens the app most days. It does not work
 * for a PARENT, who buys a plan for their child and then may not open
 * the app again for a month — which is precisely the person this rail was
 * built for. Their renewal would go through on Google's side, their card
 * would be charged, and `subscriptionExpiry` would sit at last month's
 * date until they happened to open the app. A paying family losing access
 * mid-term is the failure this module prevents.
 *
 * ── The notification is a DOORBELL, never the truth ─────────────────
 *
 * Nothing here reads an entitlement out of the notification body. A
 * notification says "something happened to this purchase token"; the
 * Play Developer API says what. So every actionable notification
 * classifies to `reverify`, and the effectful half re-runs the SAME
 * verification path a purchase takes — same never-downgrade brain, same
 * idempotent activation, same acknowledgement. A renewal is not special-
 * cased into an expiry-bump; it is a re-verification that happens to
 * find a later expiry.
 *
 * That is also what makes replay safe. Pub/Sub delivers at-least-once and
 * can deliver out of order, so a handler that APPLIED the notification's
 * contents could move an expiry backwards on a redelivered message. One
 * that re-asks Google cannot: it always applies the current state.
 *
 * ── The one exception is a void ─────────────────────────────────────
 *
 * `voidedPurchaseNotification` is a refund or a chargeback, and it is the
 * only kind that must REMOVE access. It gets its own action because
 * re-verification cannot deliver it: a refunded one-time pass still reads
 * as purchased on `purchases.products`, so re-asking Google would confirm
 * the grant we are supposed to be taking away.
 */

/** Subscription notification types (Play `subscriptionNotification.notificationType`). */
const SUBSCRIPTION_NOTIFICATION = Object.freeze({
  RECOVERED: 1,
  RENEWED: 2,
  CANCELED: 3,
  PURCHASED: 4,
  ON_HOLD: 5,
  IN_GRACE_PERIOD: 6,
  RESTARTED: 7,
  PRICE_CHANGE_CONFIRMED: 8,
  DEFERRED: 9,
  PAUSED: 10,
  PAUSE_SCHEDULE_CHANGED: 11,
  REVOKED: 12,
  EXPIRED: 13,
  PENDING_PURCHASE_CANCELED: 20,
});

/** One-time product notification types. */
const ONE_TIME_NOTIFICATION = Object.freeze({
  PURCHASED: 1,
  CANCELED: 2,
});

/**
 * The subscription events that change what a buyer is entitled to, and so
 * are worth a Play API round trip.
 *
 * PRICE_CHANGE_CONFIRMED, DEFERRED, PAUSE_SCHEDULE_CHANGED and
 * PENDING_PURCHASE_CANCELED are deliberately absent: none of them changes
 * the current entitlement, and re-verifying on each would spend a Play API
 * call and a Firestore transaction to write back exactly what is already
 * there. CANCELED *is* present — auto-renew going off does not end access
 * (the paid period runs on), but it does change what the manage screen
 * must say, and that comes from the same re-verification.
 */
const ACTIONABLE_SUBSCRIPTION_TYPES = Object.freeze([
  SUBSCRIPTION_NOTIFICATION.RECOVERED,
  SUBSCRIPTION_NOTIFICATION.RENEWED,
  SUBSCRIPTION_NOTIFICATION.CANCELED,
  SUBSCRIPTION_NOTIFICATION.PURCHASED,
  SUBSCRIPTION_NOTIFICATION.ON_HOLD,
  SUBSCRIPTION_NOTIFICATION.IN_GRACE_PERIOD,
  SUBSCRIPTION_NOTIFICATION.RESTARTED,
  SUBSCRIPTION_NOTIFICATION.PAUSED,
  SUBSCRIPTION_NOTIFICATION.REVOKED,
  SUBSCRIPTION_NOTIFICATION.EXPIRED,
]);

/** Human names, for the log line somebody reads during an incident. */
const SUBSCRIPTION_TYPE_NAMES = Object.freeze(
    Object.fromEntries(Object.entries(SUBSCRIPTION_NOTIFICATION).map(([k, v]) => [v, k])),
);

/**
 * Decode the Pub/Sub envelope Play publishes into.
 *
 * Returns null for anything unreadable — a body with no `data`, data that
 * is not base64 JSON, or JSON that is not an object. A null here means
 * "acknowledge and move on": a message we cannot parse will not parse on
 * redelivery either, and refusing it forever would wedge the subscription
 * behind an ever-growing backlog.
 */
function decodeRtdnMessage(message) {
  const raw = message && typeof message === "object" ?
    (message.data ?? message.json ?? null) : null;
  if (raw == null) return null;
  // firebase-functions decodes `json` for us when the body is valid JSON;
  // fall back to decoding `data` ourselves so the module is testable and
  // works whichever shape arrives.
  if (typeof raw === "object") return raw;
  let text;
  try {
    text = Buffer.from(String(raw), "base64").toString("utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Normalise a decoded notification into one shape.
 *
 * @returns {{
 *   kind: "subscription"|"oneTime"|"voided"|"test"|"unknown",
 *   purchaseToken: string,
 *   productId: string,
 *   notificationType: number|null,
 *   packageName: string,
 *   eventTimeMs: number,
 *   productType: number|null,   // voided only: 1 subscription, 2 one-time
 * }|null}
 */
function parseRtdnNotification(decoded) {
  if (!decoded || typeof decoded !== "object") return null;
  const packageName = String(decoded.packageName || "");
  const eventTimeMs = Number(decoded.eventTimeMillis);
  const base = {
    packageName,
    eventTimeMs: Number.isFinite(eventTimeMs) ? eventTimeMs : 0,
    productType: null,
  };

  const sub = decoded.subscriptionNotification;
  if (sub && typeof sub === "object") {
    return {
      ...base,
      kind: "subscription",
      purchaseToken: String(sub.purchaseToken || ""),
      // Play calls it subscriptionId here; it IS the product id.
      productId: String(sub.subscriptionId || ""),
      notificationType: Number(sub.notificationType),
    };
  }

  const one = decoded.oneTimeProductNotification;
  if (one && typeof one === "object") {
    return {
      ...base,
      kind: "oneTime",
      purchaseToken: String(one.purchaseToken || ""),
      productId: String(one.sku || ""),
      notificationType: Number(one.notificationType),
    };
  }

  const voided = decoded.voidedPurchaseNotification;
  if (voided && typeof voided === "object") {
    return {
      ...base,
      kind: "voided",
      purchaseToken: String(voided.purchaseToken || ""),
      productId: "",
      notificationType: null,
      productType: Number.isFinite(Number(voided.productType)) ?
        Number(voided.productType) : null,
    };
  }

  if (decoded.testNotification && typeof decoded.testNotification === "object") {
    return {...base, kind: "test", purchaseToken: "", productId: "", notificationType: null};
  }

  return {...base, kind: "unknown", purchaseToken: "", productId: "", notificationType: null};
}

/**
 * What to DO about a parsed notification.
 *
 * @param {object} args
 * @param {object|null} args.notification  from parseRtdnNotification
 * @param {string} args.expectedPackage    our own package name
 * @returns {{action: "reverify"|"revoke"|"ignore", reason: string}}
 *
 * A notification for another package is ignored rather than trusted. The
 * topic is ours, but a topic is a topic: anything with publish rights can
 * put a message on it, and every action below spends a Play API call
 * against a token the message chose. Checking the package costs one string
 * comparison and removes the whole class.
 */
function classifyRtdn({notification, expectedPackage} = {}) {
  if (!notification) return {action: "ignore", reason: "unreadable"};
  if (notification.kind === "test") return {action: "ignore", reason: "test-notification"};
  if (notification.kind === "unknown") return {action: "ignore", reason: "unrecognised-shape"};
  if (expectedPackage && notification.packageName &&
      notification.packageName !== expectedPackage) {
    return {action: "ignore", reason: "wrong-package"};
  }
  if (!notification.purchaseToken) return {action: "ignore", reason: "no-purchase-token"};

  if (notification.kind === "voided") return {action: "revoke", reason: "voided-purchase"};

  if (notification.kind === "oneTime") {
    // A pass is bought once. PURCHASED is the only thing to act on; a
    // CANCELED pending purchase never granted anything, so there is
    // nothing to take away.
    if (notification.notificationType === ONE_TIME_NOTIFICATION.PURCHASED) {
      return {action: "reverify", reason: "one-time-purchased"};
    }
    return {action: "ignore", reason: "one-time-not-actionable"};
  }

  if (ACTIONABLE_SUBSCRIPTION_TYPES.includes(notification.notificationType)) {
    return {
      action: "reverify",
      reason: SUBSCRIPTION_TYPE_NAMES[notification.notificationType] || "subscription-change",
    };
  }
  return {action: "ignore", reason: "subscription-not-actionable"};
}

module.exports = {
  SUBSCRIPTION_NOTIFICATION,
  ONE_TIME_NOTIFICATION,
  ACTIONABLE_SUBSCRIPTION_TYPES,
  SUBSCRIPTION_TYPE_NAMES,
  decodeRtdnMessage,
  parseRtdnNotification,
  classifyRtdn,
};
