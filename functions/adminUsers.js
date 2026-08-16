const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {writeAuditLog} = require("./auditLog");
const {requireAdminMfa} = require("./security/requireAdminMfa");
const {syncUserRoleClaims} = require("./security/adminClaims");
const {isSelfTargeted, SELF_TARGET_MESSAGES} = require("./security/selfTargetGuardCore");
const {
  writeSecurityAudit,
  SECURITY_EVENTS,
  requestMetaFrom,
} = require("./security/securityAudit");

const ALLOWED_STATUS = new Set(["active", "suspended", "deleted"]);
const ALLOWED_ROLE = new Set(["learner", "teacher", "admin", "superAdmin"]);
const ADMIN_ROLES = new Set(["admin", "superAdmin"]);

// Managing users (suspend/delete, role changes) is privileged: require a
// signed-in, email-verified, non-suspended admin whose CURRENT session used a
// second factor (TOTP MFA). requireAdminMfa also covers the legacy accounts
// whose role claim hasn't been synced yet via its Firestore-role fallback.
async function assertCallerIsAdmin(request) {
  const actor = await requireAdminMfa(request);
  return {uid: actor.uid, email: actor.email, isSuperAdmin: actor.isSuperAdmin};
}

/**
 * Refuse a privileged user-management action aimed at the caller's own
 * account. See security/selfTargetGuardCore.js for the rule and why the two
 * callables below could otherwise lock the last admin out of the platform.
 *
 * The refusal is recorded before it is thrown. Reaching this point means the
 * request did NOT come from either admin screen — both disable the control —
 * so it is a stale client or a direct callable invocation, and which of those
 * it was is worth being able to answer later. writeSecurityAudit swallows its
 * own errors, so the ledger can never convert a refusal into a success.
 *
 * @param {{uid: string, isSuperAdmin: boolean}} actor authenticated caller.
 * @param {*} targetUid uid the request wants to act on.
 * @param {'role'|'status'} field which action was attempted.
 * @param {object} request the callable request, for requestMetaFrom.
 */
async function assertNotSelfTargeted(actor, targetUid, field, request) {
  if (!isSelfTargeted(actor.uid, targetUid)) return;
  await writeSecurityAudit({
    eventType: SECURITY_EVENTS.ADMIN_SELF_TARGET_DENIED,
    actorUid: actor.uid,
    targetUid: actor.uid,
    actorRole: actor.isSuperAdmin ? "superAdmin" : "admin",
    outcome: "denied",
    reason: `self-${field}-change`,
    ...requestMetaFrom(request),
  });
  throw new HttpsError("permission-denied", SELF_TARGET_MESSAGES[field]);
}

/**
 * adminSetUserStatus — flip a user's lifecycle status.
 *
 * status: 'active' | 'suspended' | 'deleted'
 *
 * The Firestore rule layer also gates this collection's status field, but
 * routing the change through this callable means we always write an audit
 * log entry and (for suspend/delete) revoke the user's Auth refresh
 * tokens so they're booted from every device immediately.
 */
exports.adminSetUserStatus = onCall(
  {region: "us-central1", timeoutSeconds: 30},
  async (request) => {
    const actor = await assertCallerIsAdmin(request);
    const {uid, status, reason = ""} = request.data || {};
    if (!uid || typeof uid !== "string") {
      throw new HttpsError("invalid-argument", "uid is required.");
    }
    await assertNotSelfTargeted(actor, uid, "status", request);
    if (!ALLOWED_STATUS.has(status)) {
      throw new HttpsError("invalid-argument", `Invalid status: ${status}`);
    }

    const userRef = admin.firestore().doc(`users/${uid}`);
    const beforeSnap = await userRef.get();
    if (!beforeSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }
    const before = beforeSnap.data();

    const update = {
      status,
      suspendedAt: status === "suspended" ? admin.firestore.FieldValue.serverTimestamp() : null,
      suspendedBy: status === "suspended" ? actor.uid : null,
      suspendReason: status === "suspended" ? String(reason).slice(0, 500) : "",
      deletedAt: status === "deleted" ? admin.firestore.FieldValue.serverTimestamp() : null,
      deletedBy: status === "deleted" ? actor.uid : null,
    };
    await userRef.update(update);

    if (status === "suspended" || status === "deleted") {
      try {
        await admin.auth().revokeRefreshTokens(uid);
      } catch (err) {
        // Auth user may not exist (deleted from Auth but kept in Firestore).
        console.warn("[adminSetUserStatus] revokeRefreshTokens", err?.message);
      }
    }

    await writeAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: status === "suspended"
        ? "user.suspend"
        : status === "deleted"
          ? "user.delete"
          : "user.unsuspend",
      targetType: "user",
      targetId: uid,
      before: {status: before.status || "active", role: before.role},
      after: {status},
      metadata: {reason: update.suspendReason || null},
    });

    return {ok: true, status};
  },
);

/**
 * adminSetUserRole — change a user's role with audit log.
 *
 * Mirrors the existing client-side updateUserRole but enforces admin
 * caller via the Cloud Function and records the change.
 */
exports.adminSetUserRole = onCall(
  {region: "us-central1", timeoutSeconds: 30},
  async (request) => {
    const actor = await assertCallerIsAdmin(request);
    const {uid, role} = request.data || {};
    if (!uid || typeof uid !== "string") {
      throw new HttpsError("invalid-argument", "uid is required.");
    }
    await assertNotSelfTargeted(actor, uid, "role", request);
    if (!ALLOWED_ROLE.has(role)) {
      throw new HttpsError("invalid-argument", `Invalid role: ${role}`);
    }

    const userRef = admin.firestore().doc(`users/${uid}`);
    const beforeSnap = await userRef.get();
    if (!beforeSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }
    const before = beforeSnap.data();
    await userRef.update({role});

    // Keep the Auth custom claims in step with the role (fixes the long-standing
    // AUTH-M4 drift where only the Firestore field was updated) and mint the
    // boolean admin/superAdmin claims the MFA guard reads. Then revoke refresh
    // tokens so the new claims take effect on the target's next token refresh
    // rather than up to an hour later — critical when GRANTING admin (they must
    // re-login → then be forced into MFA setup) and when REVOKING it (stale
    // admin sessions must not linger).
    let claimsSynced = false;
    try {
      await syncUserRoleClaims(uid, role);
      await admin.auth().revokeRefreshTokens(uid);
      claimsSynced = true;
    } catch (err) {
      // Auth user may not exist (Firestore-only record). Log; the Firestore
      // role still changed and the fallback path keeps access consistent.
      console.warn("[adminSetUserRole] claim sync / token revoke failed", err?.message);
    }

    await writeAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: "user.role_change",
      targetType: "user",
      targetId: uid,
      before: {role: before.role},
      after: {role},
    });

    // Security ledger: a role change that adds/removes admin is a security
    // event. ADMIN_ROLE_GRANTED when the target becomes admin/superAdmin,
    // ADMIN_ROLE_REMOVED when it loses admin.
    const wasAdmin = ADMIN_ROLES.has(before.role);
    const nowAdmin = ADMIN_ROLES.has(role);
    if (wasAdmin !== nowAdmin) {
      await writeSecurityAudit({
        eventType: nowAdmin ?
          SECURITY_EVENTS.ADMIN_ROLE_GRANTED :
          SECURITY_EVENTS.ADMIN_ROLE_REMOVED,
        actorUid: actor.uid,
        targetUid: uid,
        actorRole: actor.isSuperAdmin ? "superAdmin" : "admin",
        outcome: "success",
        metadata: {fromRole: before.role || null, toRole: role, claimsSynced},
        ...requestMetaFrom(request),
      });
    }

    return {ok: true, role};
  },
);
