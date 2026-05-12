/**
 * Referral credit redemption — audit C7 PR 2.
 *
 * Wired off the MoMo success path in functions/index.js
 * (`markPaymentSuccessful`). When a referee's first successful
 * subscription lands, we:
 *
 *   1. Extend the referee's `subscriptionExpiry` by 30 days — their
 *      first paid month is effectively two months ("you get a free
 *      month for joining via a friend's link").
 *
 *   2. Increment the referrer's `referralCount` and `referralCredits`.
 *      Credits accumulate; PR 3 will let the referrer redeem them at
 *      their next subscription purchase. (We intentionally do NOT
 *      grant the referrer immediate Pro access here — that'd require
 *      synthesising a full subscriptionStatus/plan/premium update for
 *      a user whose billing state we shouldn't be re-shaping from a
 *      side channel.)
 *
 *   3. Write a `referralRedemptions/{id}` audit row capturing both
 *      sides + the triggering payment so an admin can reconcile any
 *      complaint later.
 *
 * Idempotency:
 *   - `users/{referee}.referralCreditRedeemed = true` is the flag.
 *     If already true, this function returns early — second + later
 *     subscriptions don't re-redeem.
 *
 * Anti-abuse guards:
 *   - Self-referral (referrer === referee) — blocked.
 *   - Referee has no `referredBy` — return silently (most users).
 *   - Referral code doesn't resolve — log + return (stale code).
 *   - Already redeemed — return silently.
 *
 * Why fire-and-forget from the success path:
 *   - The referee's subscription is ALREADY active when this runs
 *     (the markPaymentSuccessful transaction committed). The credit
 *     is a bonus on top. A failure here must NOT undo the activation
 *     they paid for.
 */

const admin = require("firebase-admin");

const REFERRAL_BONUS_DAYS = 30;

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  return new Date(value);
}

/**
 * Run referral-credit redemption for one referee. Idempotent + safe to
 * call from any payment-success path. All failures are caught + logged
 * — callers should NOT await this in a way that blocks the
 * subscription-activation response.
 *
 * @param {Object} args
 * @param {string} args.userId        Referee uid.
 * @param {string} [args.paymentId]   The successful payment ref id.
 * @param {string} [args.planId]      Plan that was just activated.
 * @returns {Promise<{status: 'redeemed'|'skipped', reason?: string}>}
 */
async function redeemReferralCredit({userId, paymentId = null, planId = null}) {
  if (!userId) return {status: "skipped", reason: "no-user-id"};

  const db = admin.firestore();
  const refereeRef = db.collection("users").doc(userId);

  try {
    return await db.runTransaction(async (tx) => {
      const refereeSnap = await tx.get(refereeRef);
      if (!refereeSnap.exists) {
        return {status: "skipped", reason: "referee-not-found"};
      }
      const refereeData = refereeSnap.data() || {};

      // Idempotency guard — already redeemed once.
      if (refereeData.referralCreditRedeemed === true) {
        return {status: "skipped", reason: "already-redeemed"};
      }

      const referredBy = String(refereeData.referredBy || "").trim().toUpperCase();
      if (!referredBy) {
        // Most users don't have a referredBy. Stamp the flag anyway
        // so subsequent renewals skip the lookup cheaply.
        tx.update(refereeRef, {referralCreditRedeemed: true});
        return {status: "skipped", reason: "no-referrer"};
      }

      // Resolve the code → referrer uid.
      const codeRef = db.collection("referralCodes").doc(referredBy);
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists) {
        // Stale or hand-edited code. Stamp the flag so we don't retry
        // every subscription renewal.
        tx.update(refereeRef, {referralCreditRedeemed: true});
        return {status: "skipped", reason: "code-not-found"};
      }
      const referrerUid = String(codeSnap.data()?.uid || "").trim();

      // Self-referral guard.
      if (!referrerUid || referrerUid === userId) {
        tx.update(refereeRef, {referralCreditRedeemed: true});
        return {status: "skipped", reason: "self-referral"};
      }

      const referrerRef = db.collection("users").doc(referrerUid);
      const referrerSnap = await tx.get(referrerRef);
      if (!referrerSnap.exists) {
        // The referrer's user doc was deleted (admin action). Stamp
        // the flag so we don't retry, but don't grant the referee
        // bonus either — there's nobody to attribute it to.
        tx.update(refereeRef, {referralCreditRedeemed: true});
        return {status: "skipped", reason: "referrer-not-found"};
      }

      // 1. Extend referee's subscriptionExpiry by 30 days.
      const currentExpiry = toDate(refereeData.subscriptionExpiry);
      const baseDate = currentExpiry && currentExpiry > new Date()
        ? currentExpiry
        : new Date();
      const newExpiry = new Date(baseDate);
      newExpiry.setDate(newExpiry.getDate() + REFERRAL_BONUS_DAYS);

      tx.update(refereeRef, {
        referralCreditRedeemed: true,
        subscriptionExpiry: admin.firestore.Timestamp.fromDate(newExpiry),
      });

      // 2. Increment referrer counters.
      tx.update(referrerRef, {
        referralCount: admin.firestore.FieldValue.increment(1),
        referralCredits: admin.firestore.FieldValue.increment(1),
      });

      // 3. Write the audit row. Doc id auto-generated; both sides
      // referenced so /admin can reconcile complaints later.
      const redemptionRef = db.collection("referralRedemptions").doc();
      tx.set(redemptionRef, {
        refereeUid: userId,
        referrerUid,
        referralCode: referredBy,
        refereePaymentId: paymentId,
        refereePlanId: planId,
        bonusDays: REFERRAL_BONUS_DAYS,
        newRefereeExpiry: admin.firestore.Timestamp.fromDate(newExpiry),
        redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {status: "redeemed", referrerUid, refereeUid: userId};
    });
  } catch (err) {
    // Never throws — callers run fire-and-forget. Log and move on.
    console.error("[referralRedemption] redemption failed for", userId, err);
    return {status: "skipped", reason: "error", error: String(err?.message || err).slice(0, 200)};
  }
}

module.exports = {redeemReferralCredit, REFERRAL_BONUS_DAYS};
