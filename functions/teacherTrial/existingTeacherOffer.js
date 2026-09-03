"use strict";

/**
 * activateExistingTeacherTrialOffer — the callable behind "Start Free Trial"
 * on the existing-teacher offer card.
 *
 * All DECIDING happens in teacherTrialCore.js
 * (resolveExistingTeacherTrialActivation); this file only wires that pure
 * decision to a Firestore transaction on the caller's own user doc, so
 * concurrency safety comes from Firestore's normal optimistic-concurrency
 * retries — no separate lock document is needed because the operation is
 * already naturally keyed by uid (one users/{uid} doc, one trial).
 *
 * Never trusts the client for anything except "which uid is calling"
 * (request.auth.uid, via assertVerifiedAuth — never a uid in the payload).
 * Eligibility, the activation timestamp and the expiry are all derived
 * server-side from the document read inside the transaction and this
 * function's own clock.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const {
  EXISTING_TEACHER_OFFER_SOURCE,
  TEACHER_TRIAL_OFFER_STATUS,
  resolveExistingTeacherTrialActivation,
} = require("./teacherTrialCore");

// Human copy for each refusal reason — never leaks internal field names to
// the client, but is specific enough that "Maybe Later" vs "already used"
// vs "you're on a paid plan" read as different situations in the UI.
const INELIGIBLE_MESSAGES = {
  "no-profile": "We couldn't find your teacher profile. Please refresh and try again.",
  "not-a-teacher": "This offer is only available for teacher accounts.",
  "trial-already-used": "You've already used a Teacher Pro trial on this account.",
  "previously-paid": "This offer is for teachers who haven't subscribed to Teacher Pro before.",
  "active-paid-plan": "You already have an active Teacher Pro subscription.",
};

function ineligibleError(reason) {
  return new HttpsError(
      "failed-precondition",
      INELIGIBLE_MESSAGES[reason] || "You're not eligible for this trial offer right now.",
      {reason},
  );
}

exports.activateExistingTeacherTrialOffer = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      const {assertVerifiedAuth} = require("../authGuard");
      const uid = await assertVerifiedAuth(request, "Please sign in first.");

      const db = admin.firestore();
      const userRef = db.collection("users").doc(uid);

      const decision = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) {
          return {outcome: "ineligible", reason: "no-profile"};
        }
        const user = snap.data();
        const result = resolveExistingTeacherTrialActivation(user, new Date());

        if (result.outcome !== "granted") {
          return result;
        }

        const endsAt = admin.firestore.Timestamp.fromMillis(result.teacherTrialEndsAtMs);
        const offeredAt = result.preserveOfferedAt || admin.firestore.FieldValue.serverTimestamp();

        tx.update(userRef, {
          teacherPlan: "trial",
          teacherTrialEndsAt: endsAt,
          teacherTrialStartedAt: admin.firestore.FieldValue.serverTimestamp(),
          teacherTrialOffer: {
            status: TEACHER_TRIAL_OFFER_STATUS.ACTIVE,
            offeredAt,
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: endsAt,
            redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
            source: EXISTING_TEACHER_OFFER_SOURCE,
          },
        });

        return result;
      });

      if (decision.outcome === "ineligible") {
        throw ineligibleError(decision.reason);
      }

      // Best-effort audit trail — never blocks the response the teacher is
      // waiting on. writeAuditLog itself never throws (it alerts + returns
      // {written:false} on failure), so no try/catch is needed here, but the
      // call is still made after the transaction has resolved either way.
      try {
        const {writeAuditLog} = require("../auditLog");
        await writeAuditLog({
          actorUid: uid,
          action: decision.outcome === "already-active"
            ? "existing_teacher_trial_reactivation_noop"
            : "existing_teacher_trial_activated",
          targetType: "user",
          targetId: uid,
          after: {teacherPlan: "trial", teacherTrialEndsAtMs: decision.teacherTrialEndsAtMs},
          metadata: {source: EXISTING_TEACHER_OFFER_SOURCE},
        });
      } catch (err) {
        console.warn("[existingTeacherOffer] audit log failed", err);
      }

      return {
        ok: true,
        alreadyActive: decision.outcome === "already-active",
        teacherPlan: "trial",
        teacherTrialEndsAtMs: decision.teacherTrialEndsAtMs,
      };
    },
);
