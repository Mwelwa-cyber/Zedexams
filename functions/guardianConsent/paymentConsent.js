"use strict";

/**
 * paymentConsent — record a parent's approval when their payment lands.
 *
 * Called post-commit from `activateSubscriptionFromPayment`, so it can only
 * ever follow money actually arriving: there is no route from "a child tapped
 * Pay" to an approved account, only from a charge that Lenco confirmed. The
 * decision itself is `paymentConsentCore.decidePaymentConsent`; this file is
 * the transaction around it.
 *
 * ── Why a transaction that re-reads the user ───────────────────────────
 *
 * The activation transaction has already committed by the time this runs, and
 * a guardian may have tapped "this wasn't me" in the seconds since. Deciding
 * from a copy read earlier would let a payment overwrite that decline.
 * Re-reading inside this transaction means the newest consent state wins.
 *
 * ── Best-effort, like every other post-commit step ─────────────────────
 *
 * The caller wraps it in try/catch. A failure here must never undo access the
 * parent paid for; the cost of a miss is that the account stays in limited
 * mode and the existing emailed-link approval still works.
 */

const {FieldValue} = require("firebase-admin/firestore");
const {grantedRecord} = require("./consentRecord");
const {decidePaymentConsent, paymentEvidence} = require("./paymentConsentCore");

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} args
 * @param {string} args.learnerUid   the account the payment credited
 * @param {string} args.paymentId    the payments/{id} that confirmed
 * @param {string} [args.phoneNumber] the number that approved the charge
 * @param {string} [args.operator]
 * @param {Function} [args.refreshEffective] test seam for the mirror refresh
 * @return {Promise<{recorded: boolean, reason: string}>}
 */
async function recordPaymentConsent(db, {
  learnerUid, paymentId, phoneNumber, operator, refreshEffective,
} = {}) {
  if (!learnerUid || !paymentId) return {recorded: false, reason: "missing-input"};

  const userRef = db.collection("users").doc(learnerUid);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const decision = decidePaymentConsent(snap.exists ? (snap.data() || {}) : null);
    if (!decision.apply) return {recorded: false, reason: decision.reason};

    tx.set(userRef, grantedRecord({
      now: FieldValue.serverTimestamp(),
      evidence: paymentEvidence({paymentId, phoneNumber, operator}),
    }), {merge: true});
    return {recorded: true, reason: decision.reason};
  });

  if (!outcome.recorded) return outcome;

  // `users.guardian.effective` is the cache `firestore.rules` reads for the
  // leaderboard write, because a rule cannot query the live state. Refreshing
  // it from the same code the link trigger runs keeps the two answers the
  // same; a failure here is covered by the live read in consentGuard.
  try {
    const refresh = refreshEffective ||
      require("../guardianLink/onLinkWritten").refreshLearnerEffectiveState;
    await refresh(db, learnerUid);
  } catch (err) {
    console.error("[paymentConsent] effective-state refresh failed", learnerUid, err?.message || err);
  }

  console.log("[paymentConsent] guardian consent recorded from payment", {
    learnerUid, paymentId, was: outcome.reason,
  });
  return outcome;
}

module.exports = {recordPaymentConsent};
