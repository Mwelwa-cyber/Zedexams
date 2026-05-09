/**
 * Self-serve subscription cancellation (audit D4).
 *
 * Premium users in Zambia pay via MTN MoMo as a one-shot prepayment —
 * there is no auto-renewal. So "cancellation" really means: stop
 * pestering me to upgrade after my current period ends, and don't bill
 * me again at expiry. We model it with a single boolean flag:
 *
 *   users.{uid}.cancelAtPeriodEnd: true | false (or absent)
 *
 * The flag doesn't shorten access — the existing subscriptionExpiry
 * date still controls when premium turns off. It's purely a signal:
 *   - For the UI: show "Plan ends ${date}" + Reactivate, instead of
 *     the normal "Active" + Cancel.
 *   - For future renewal cron logic: skip auto-renew (when we add it).
 *   - For analytics: actual churn vs. natural expiry.
 *
 * Why a Cloud Function (instead of a direct client write):
 *   - Firestore rules block any self-update of subscription fields.
 *     `cancelAtPeriodEnd` is added to that block list in firestore.rules
 *     so a tampered client can't toggle it directly.
 *   - The function audits (createdAt, lastChangedBy) so support can
 *     trace every cancel/reactivate.
 *
 * One callable, two intents — `cancel: true` schedules cancellation,
 * `cancel: false` reactivates. Idempotent.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const setSubscriptionCancellation = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const cancel = Boolean(request.data?.cancel);
  const reason = typeof request.data?.reason === "string"
    ? request.data.reason.slice(0, 500)
    : null;

  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);

  // Read first so we can return the resulting state to the caller and
  // refuse on edge cases (no active subscription to cancel).
  const snap = await userRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }
  const data = snap.data() || {};

  // Don't let someone "cancel" a free account — confuses analytics and
  // the UI is supposed to hide the cancel button anyway, so this is
  // belt-and-braces.
  const hasActivePremium = Boolean(
      data.isPremium ||
      data.premium ||
      data.subscriptionStatus === "active" ||
      data.paymentStatus === "active",
  );
  if (cancel && !hasActivePremium) {
    throw new HttpsError("failed-precondition", "No active subscription to cancel.");
  }

  const update = {
    cancelAtPeriodEnd: cancel,
    cancelAtPeriodEndUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (cancel) {
    update.cancelAtPeriodEndReason = reason;
  } else {
    // Reactivation clears the reason so a re-cancel later starts clean.
    update.cancelAtPeriodEndReason = admin.firestore.FieldValue.delete();
  }
  await userRef.update(update);

  // Audit log — written to a separate collection so reading users/{uid}
  // doesn't pull a growing history.
  await db.collection("subscriptionEvents").add({
    uid,
    kind: cancel ? "cancel-scheduled" : "reactivated",
    reason: cancel ? reason : null,
    subscriptionExpiry: data.subscriptionExpiry || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => {
    // Audit-log failures shouldn't break the user-visible action.
    console.warn("[subscriptionLifecycle] audit-log write failed", err);
  });

  return {
    ok: true,
    cancelAtPeriodEnd: cancel,
    subscriptionExpiry: data.subscriptionExpiry || null,
  };
});

module.exports = {setSubscriptionCancellation};
