"use strict";

/**
 * googlePlayRtdn — applying a Google Play Real-time Developer
 * Notification. The effectful half of googlePlayRtdnCore (which owns the
 * parsing and the what-does-this-mean decisions, and explains why the
 * notification is treated as a doorbell rather than as truth).
 *
 * ── Finding out whose purchase this is ──────────────────────────────
 *
 * A notification carries a purchase token and nothing about the buyer.
 * The link back to an account is `payments/{gp_*}.googlePlayPurchaseToken`,
 * written when the purchase was first verified — which is why a renewal
 * can be applied at all without the app being open.
 *
 * A token we have never seen is NOT an error. It is the ordinary case for
 * a purchase whose very first verification has not happened yet: Play can
 * publish PURCHASED before the client's `verifyGooglePlayPurchase` call
 * lands. Acknowledging it and moving on is correct — the client's own
 * verification does the grant moments later.
 *
 * ── Revocation is narrow on purpose ─────────────────────────────────
 *
 * A refund lapses the accounts THIS payment granted, found by
 * `subscriptionPaymentId`, and nothing else. Not "every child of this
 * guardian": a family may hold a plan somebody else paid for, or a
 * longer one bought earlier, and a refund of one purchase must not reach
 * into a grant it never made. That is the same reasoning
 * guardianEntitlement uses when it refuses to shorten an entitlement a
 * child already holds.
 */

const admin = require("firebase-admin");

const {decodeRtdnMessage, parseRtdnNotification, classifyRtdn} =
  require("./googlePlayRtdnCore");
const {creditedUid} = require("./guardianBillingCore");

const MAX_AFFECTED = 25;

/**
 * Every account a payment granted: the one it credited, plus any learner
 * the guardian cascade extended it to. Both are found from the payment
 * itself rather than from the family, so a refund cannot reach a grant
 * this payment did not make.
 */
async function accountsGrantedBy(db, {paymentId, pay}) {
  const uids = new Set();
  const credited = creditedUid(pay);
  if (credited) uids.add(credited);
  try {
    const snap = await db.collection("users")
        .where("subscriptionPaymentId", "==", paymentId)
        .limit(MAX_AFFECTED)
        .get();
    for (const doc of snap.docs) uids.add(doc.id);
  } catch (err) {
    // A failed lookup must not stop the credited account being lapsed —
    // partial revocation beats none when money has been returned.
    console.error("[googlePlayRtdn] cascade lookup failed", err?.message || err);
  }
  return [...uids];
}

/**
 * Lapse every grant a voided payment made.
 *
 * Writes an expiry of NOW rather than deleting the plan fields, because
 * that is how every other lapse in this codebase works — access is
 * resolved at read time from `subscriptionExpiry`, so a past date is the
 * downgrade. Deleting fields instead would make a refunded account look
 * like one that had never paid, which is a different and less honest
 * thing to show support.
 */
async function revokeGrantsForToken(db, {purchaseToken, nowMs = Date.now()} = {}) {
  const out = {payments: 0, revoked: [], reason: null};
  if (!purchaseToken) {
    out.reason = "no-token";
    return out;
  }

  const paySnap = await db.collection("payments")
      .where("googlePlayPurchaseToken", "==", purchaseToken)
      .limit(MAX_AFFECTED)
      .get();
  if (paySnap.empty) {
    out.reason = "unknown-token";
    return out;
  }

  const lapseAt = admin.firestore.Timestamp.fromMillis(nowMs);

  for (const payDoc of paySnap.docs) {
    const pay = payDoc.data() || {};
    // A payment that never completed granted nothing to take away.
    if (pay.status !== "successful") continue;
    out.payments += 1;

    const uids = await accountsGrantedBy(db, {paymentId: payDoc.id, pay});
    for (const uid of uids) {
      try {
        const ref = db.collection("users").doc(uid);
        const snap = await ref.get();
        if (!snap.exists) continue;
        const user = snap.data() || {};

        const update = {
          subscriptionExpiry: lapseAt,
          subscriptionStatus: "refunded",
          paymentStatus: "refunded",
          googlePlaySyncedAt: admin.firestore.FieldValue.serverTimestamp(),
          subscriptionRevokedAt: admin.firestore.FieldValue.serverTimestamp(),
          subscriptionRevokedReason: "play_voided_purchase",
        };
        // The teacher studio gate reads its own expiry field, so it has to
        // be lapsed in step or a refunded teacher keeps paid quotas.
        const plan = String(user.subscriptionPlan || "");
        if (plan.startsWith("pro_") || plan.startsWith("max_")) {
          update.teacherPlanExpiresAt = lapseAt;
        }
        await ref.update(update);
        out.revoked.push(uid);
      } catch (err) {
        console.error("[googlePlayRtdn] revoke failed for", uid, err?.message || err);
      }
    }

    try {
      await payDoc.ref.update({
        status: "refunded",
        refundedAt: admin.firestore.FieldValue.serverTimestamp(),
        refundSource: "play_rtdn",
      });
    } catch (err) {
      console.error("[googlePlayRtdn] payment refund stamp failed", err?.message || err);
    }
  }

  if (out.payments === 0) out.reason = "no-successful-payment";
  return out;
}

/**
 * The uid that owns a purchase token, from the payment doc written when it
 * was first verified. Returns the PAYER — re-verification credits whoever
 * the stored payment named, so the beneficiary travels with the doc rather
 * than needing to be re-derived here.
 */
async function ownerOfPurchaseToken(db, purchaseToken) {
  const snap = await db.collection("payments")
      .where("googlePlayPurchaseToken", "==", purchaseToken)
      .limit(1)
      .get();
  if (snap.empty) return null;
  const pay = snap.docs[0].data() || {};
  return {
    uid: pay.userId || null,
    beneficiaryUid: pay.beneficiaryUid || null,
    productId: pay.googlePlayProductId || "",
  };
}

/**
 * Handle one RTDN message end to end.
 *
 * Deps are injectable so the whole path — parse, classify, resolve owner,
 * apply — is testable without Pub/Sub, Firestore or the Play API.
 *
 * NEVER THROWS on a message it merely cannot act on. A thrown error makes
 * Pub/Sub redeliver, and redelivering a message that will fail identically
 * every time builds a backlog that delays the renewals behind it. Only a
 * genuinely transient failure (the Play API being down) is worth a retry,
 * and that is signalled by rethrowing from the verify path.
 *
 * @returns {Promise<{action: string, reason: string, status?: string, uid?: string|null}>}
 */
async function handleRtdnMessage({
  message,
  db = null,
  expectedPackage,
  verify = null,
  revoke = null,
  nowMs = Date.now(),
} = {}) {
  const firestore = db || admin.firestore();
  const notification = parseRtdnNotification(decodeRtdnMessage(message));
  const verdict = classifyRtdn({notification, expectedPackage});

  if (verdict.action === "ignore") {
    console.log(`[googlePlayRtdn] ignored (${verdict.reason})`);
    return {action: "ignore", reason: verdict.reason};
  }

  if (verdict.action === "revoke") {
    const revokeImpl = revoke ||
      ((args) => revokeGrantsForToken(firestore, args));
    const result = await revokeImpl({purchaseToken: notification.purchaseToken, nowMs});
    console.warn("[googlePlayRtdn] voided purchase applied", {
      reason: verdict.reason,
      payments: result.payments,
      revoked: result.revoked.length,
      detail: result.reason || null,
    });
    return {action: "revoke", reason: verdict.reason, revoked: result.revoked.length};
  }

  const owner = await ownerOfPurchaseToken(firestore, notification.purchaseToken);
  if (!owner || !owner.uid) {
    // See the module docblock: this is the normal race with the client's
    // own first verification, not a failure.
    console.log(`[googlePlayRtdn] no account yet for this token (${verdict.reason})`);
    return {action: "reverify", reason: verdict.reason, status: "unknown-token", uid: null};
  }

  const verifyImpl = verify ||
    ((args) => require("./googlePlayBilling").verifyAndApplyPurchase(args));

  // Re-verification uses the notification's product id when it has one
  // (subscriptions and one-time both carry it) and falls back to what the
  // payment doc recorded. The id only CHOOSES the Play endpoint — every
  // fact used to grant still comes from Google's response.
  const result = await verifyImpl({
    uid: owner.uid,
    purchaseToken: notification.purchaseToken,
    productId: notification.productId || owner.productId || "",
    // The stored payment already names the beneficiary for this token, and
    // activation resolves it from there. Passing it again would re-assert
    // a pairing nothing has re-authorised.
    nowMs,
  });

  console.log("[googlePlayRtdn] applied", {
    reason: verdict.reason,
    uid: owner.uid,
    status: result?.status || "unknown",
  });
  return {
    action: "reverify",
    reason: verdict.reason,
    status: result?.status || "unknown",
    uid: owner.uid,
  };
}

module.exports = {
  handleRtdnMessage,
  revokeGrantsForToken,
  ownerOfPurchaseToken,
  accountsGrantedBy,
  MAX_AFFECTED,
};
