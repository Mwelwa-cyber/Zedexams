"use strict";

/**
 * consentRecord — the shape a guardian consent decision writes, in one
 * place.
 *
 * THREE routes now reach the same decision and they must not each carry
 * their own idea of what "approved" looks like on a user document:
 *
 *   1. the emailed approval link  (guardianConsent/index.js applyDecision)
 *   2. linking by family code     (familyPortal.js, once the child accepts)
 *   3. the parent app             (parentApp setGuardianConsent)
 *
 * `/child-safety` — the published standards page named in the Play
 * Console declaration — promises that a guardian approves the account and
 * can later view, change and withdraw that approval. A second route that
 * created a link WITHOUT the consent record would mean a child whose
 * account is guarded, whose parent sees everything, and whose consent
 * evidence is absent from the only field a regulator would be shown. That
 * is the gap this module closes.
 *
 * Pure: no firebase-admin, no clock. Callers pass `now` (a server
 * timestamp sentinel in production, a number in tests) and the deletion
 * date, so the same functions test under plain node.
 */

/** How long a withdrawn-consent account survives before deletion. */
const WITHDRAWN_DELETION_DAYS = 30;

/**
 * Approved. `evidence` is what we would show a regulator or Google on
 * appeal to demonstrate a real guardian really approved — so it records
 * HOW the approval arrived, not merely that it did. `via` is the field
 * that tells apart a click on an emailed link from a family code typed by
 * somebody standing next to the child.
 */
function grantedRecord({now, evidence = {}} = {}) {
  return {
    guardian: {
      consentStatus: "granted",
      decidedAt: now,
      evidence: {
        via: evidence.via || "link",
        ip: evidence.ip || "",
        userAgent: evidence.userAgent || "",
        ...(evidence.tokenId ? {tokenId: evidence.tokenId} : {}),
        ...(evidence.guardianUid ? {guardianUid: evidence.guardianUid} : {}),
        ...(evidence.guardianEmail ? {guardianEmail: evidence.guardianEmail} : {}),
        ...(evidence.code ? {code: evidence.code} : {}),
      },
    },
  };
}

/**
 * Declined or withdrawn. The account is suspended immediately and
 * scheduled for deletion, because that is what the guardian was told
 * would happen — a decline that only flipped a flag would leave a child
 * using an account their guardian refused.
 *
 * `reason` distinguishes the two ways to arrive here so the restore path
 * knows which suspensions it owns: `guardian_declined` (the emailed "this
 * wasn't me") and `guardian_withdrew` (the parent app).
 */
function deniedRecord({now, evidence = {}, reason = "guardian_declined", deletionAt} = {}) {
  return {
    guardian: {
      consentStatus: "denied",
      decidedAt: now,
      evidence: {
        via: evidence.via || "link",
        ip: evidence.ip || "",
        userAgent: evidence.userAgent || "",
        ...(evidence.tokenId ? {tokenId: evidence.tokenId} : {}),
        ...(evidence.guardianUid ? {guardianUid: evidence.guardianUid} : {}),
      },
    },
    suspended: true,
    suspendedReason: reason,
    scheduledDeletionAt: deletionAt,
  };
}

/**
 * Re-granting after a withdrawal: the consent record, plus the reversal
 * of the suspension the withdrawal caused.
 *
 * The caller must only apply this when the CURRENT suspension is one of
 * ours (`SUSPENSION_REASONS`). Clearing `suspended` unconditionally would
 * let a guardian re-approval reinstate an account an administrator
 * suspended for something else entirely — a consent decision must never
 * be a route around moderation.
 */
function restoredRecord({now, evidence = {}} = {}) {
  return {
    ...grantedRecord({now, evidence}),
    suspended: false,
    suspendedReason: null,
    scheduledDeletionAt: null,
  };
}

/** Suspension reasons a guardian re-approval is allowed to lift. */
const SUSPENSION_REASONS = ["guardian_declined", "guardian_withdrew"];

/** True when this account's suspension is one a re-approval may clear. */
function isGuardianSuspension(user) {
  const u = user && typeof user === "object" ? user : {};
  if (u.suspended !== true) return false;
  return SUSPENSION_REASONS.includes(u.suspendedReason);
}

module.exports = {
  WITHDRAWN_DELETION_DAYS,
  SUSPENSION_REASONS,
  grantedRecord,
  deniedRecord,
  restoredRecord,
  isGuardianSuspension,
};
