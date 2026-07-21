// resetAdminMfa — super-admin recovery for an administrator who has lost their
// authenticator (Phase 10). Removes the target admin's enrolled MFA factors via
// the Admin SDK, revokes their refresh tokens (invalidating every existing
// session), writes a full audit trail, and — because tokens are revoked and the
// factors are gone — forces the target to re-enrol MFA on their next sign-in.
//
// Safety rails (see resetAdminMfaCore for the pure checks):
//   - caller must be a super admin whose CURRENT session used a second factor
//     (requireAdminMfa { requireSuperAdmin:true }) — a normal admin cannot reset
//     anyone, so a normal admin can never reset a super admin;
//   - caller must have authenticated recently (auth_time step-up window);
//   - a mandatory free-text reason is recorded;
//   - self-reset is refused (no removing your own last factor from a button);
//   - the target is resolved by UID (never by a bare email) and confirmed to be
//     an administrator before anything is removed.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { requireAdminMfa } = require("./requireAdminMfa");
const { isRecentAuth } = require("./requireAdminMfaCore");
const {
  validateResetRequest,
  targetIsAdministrator,
  RECENT_AUTH_MAX_AGE_SECONDS,
} = require("./resetAdminMfaCore");
const { writeSecurityAudit, SECURITY_EVENTS, requestMetaFrom } = require("./securityAudit");
const { writeAuditLog } = require("../auditLog");

exports.resetAdminMfa = onCall({ region: "us-central1", timeoutSeconds: 30 }, async (request) => {
  // 1. Caller must be a super admin with an MFA-verified session.
  const actor = await requireAdminMfa(request, { requireSuperAdmin: true });
  const token = request.auth.token;
  const meta = requestMetaFrom(request);

  // 2. Recent-auth (step-up) requirement for this destructive operation.
  if (!isRecentAuth(token, RECENT_AUTH_MAX_AGE_SECONDS)) {
    throw new HttpsError(
      "failed-precondition",
      "Please sign in again to perform this sensitive action.",
      { reason: "requires-recent-login" },
    );
  }

  // 3. Validate inputs (uid + reason, not self).
  const { uid: targetUid, reason } = request.data || {};
  const check = validateResetRequest({ actorUid: actor.uid, targetUid, reason });
  if (!check.ok) {
    throw new HttpsError(check.code, check.message, check.reason ? { reason: check.reason } : undefined);
  }
  const cleanReason = check.cleanReason;

  // 4. Resolve the target securely by UID and confirm they are an administrator.
  let targetUser;
  try {
    targetUser = await admin.auth().getUser(targetUid);
  } catch {
    throw new HttpsError("not-found", "Target user not found.");
  }
  let firestoreRole = null;
  try {
    const snap = await admin.firestore().doc(`users/${targetUid}`).get();
    firestoreRole = snap.exists ? snap.data()?.role : null;
  } catch {
    /* fall through to claims-only check */
  }
  if (!targetIsAdministrator({ claims: targetUser.customClaims, firestoreRole })) {
    throw new HttpsError("failed-precondition", "Target account is not an administrator.", {
      reason: "target-not-admin",
    });
  }

  await writeSecurityAudit({
    eventType: SECURITY_EVENTS.MFA_RESET_REQUESTED,
    actorUid: actor.uid,
    targetUid,
    actorRole: "superAdmin",
    outcome: "started",
    reason: cleanReason,
    ...meta,
  });

  const factorCount = (targetUser.multiFactor?.enrolledFactors || []).length;

  // 5. Remove all enrolled MFA factors (Admin SDK: enrolledFactors: null clears).
  try {
    await admin.auth().updateUser(targetUid, { multiFactor: { enrolledFactors: null } });
  } catch (err) {
    await writeSecurityAudit({
      eventType: SECURITY_EVENTS.MFA_RESET_APPROVED,
      actorUid: actor.uid,
      targetUid,
      actorRole: "superAdmin",
      outcome: "failure",
      reason: cleanReason,
      metadata: { step: "remove-factors", error: err?.code || "unknown" },
      ...meta,
    });
    throw new HttpsError("internal", "Failed to remove the administrator's MFA factors.");
  }
  await writeSecurityAudit({
    eventType: SECURITY_EVENTS.MFA_FACTORS_REMOVED,
    actorUid: actor.uid,
    targetUid,
    actorRole: "superAdmin",
    outcome: "success",
    reason: cleanReason,
    metadata: { factorsRemoved: factorCount },
    ...meta,
  });

  // 6. Revoke refresh tokens → every existing session for the target is
  //    invalidated; combined with the removed factors, the next sign-in forces
  //    a fresh first-factor login AND re-enrolment.
  try {
    await admin.auth().revokeRefreshTokens(targetUid);
    await writeSecurityAudit({
      eventType: SECURITY_EVENTS.ADMIN_SESSIONS_REVOKED,
      actorUid: actor.uid,
      targetUid,
      actorRole: "superAdmin",
      outcome: "success",
      reason: cleanReason,
      ...meta,
    });
  } catch (err) {
    // Factors are already gone; a revoke failure still leaves the account
    // MFA-less. Log it but don't fail the whole recovery.
    console.warn("[resetAdminMfa] revokeRefreshTokens failed:", err?.message);
  }

  // 7. Mirror status for UI/reporting only — server-written, never a security
  //    control (Firebase enrolment state remains the source of truth).
  try {
    await admin.firestore().doc(`users/${targetUid}`).set(
      {
        mfaEnrolled: false,
        mfaResetAt: admin.firestore.FieldValue.serverTimestamp(),
        mfaResetBy: actor.uid,
      },
      { merge: true },
    );
  } catch {
    /* mirror is best-effort */
  }

  await writeSecurityAudit({
    eventType: SECURITY_EVENTS.MFA_RESET_APPROVED,
    actorUid: actor.uid,
    targetUid,
    actorRole: "superAdmin",
    outcome: "success",
    reason: cleanReason,
    metadata: { factorsRemoved: factorCount },
    ...meta,
  });
  // Also drop a line in the general admin ledger so it shows in /admin/activity.
  await writeAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: "admin.mfa_reset",
    targetType: "user",
    targetId: targetUid,
    metadata: { reason: cleanReason, factorsRemoved: factorCount },
  });

  return { ok: true, targetUid, factorsRemoved: factorCount };
});
