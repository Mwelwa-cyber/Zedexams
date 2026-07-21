// Pure validation for the super-admin MFA recovery flow (resetAdminMfa). Split
// out so the safety rules — reason required, no self-reset, uid (not email)
// required — are node-testable without the Admin SDK.

// Minimum length for the mandatory human-written recovery reason.
const MIN_REASON_LENGTH = 5;

// How recently the acting super admin must have authenticated (auth_time) to run
// this destructive op. 30 min step-up window.
const RECENT_AUTH_MAX_AGE_SECONDS = 30 * 60;

function validateResetRequest({ actorUid, targetUid, reason }) {
  if (!targetUid || typeof targetUid !== "string") {
    return { ok: false, code: "invalid-argument", message: "Target administrator uid is required." };
  }
  const cleanReason = String(reason || "").trim();
  if (cleanReason.length < MIN_REASON_LENGTH) {
    return {
      ok: false,
      code: "invalid-argument",
      message: `A recovery reason (at least ${MIN_REASON_LENGTH} characters) is required.`,
    };
  }
  // An admin must not remove their own last factor via a single in-session
  // button — that would defeat the "can't disable your own final factor"
  // requirement. Recovery is always performed BY a different super admin.
  if (targetUid === actorUid) {
    return {
      ok: false,
      code: "failed-precondition",
      reason: "self-reset-forbidden",
      message: "You cannot reset your own MFA. Ask another super admin to do it.",
    };
  }
  return { ok: true, cleanReason };
}

// Confirm the target account is actually an administrator, from its claims
// and/or Firestore role. Pure so it's testable.
function targetIsAdministrator({ claims, firestoreRole }) {
  const c = claims || {};
  if (c.admin === true || c.superAdmin === true || c.role === "admin" || c.role === "superAdmin") {
    return true;
  }
  return firestoreRole === "admin" || firestoreRole === "superAdmin";
}

module.exports = {
  MIN_REASON_LENGTH,
  RECENT_AUTH_MAX_AGE_SECONDS,
  validateResetRequest,
  targetIsAdministrator,
};
