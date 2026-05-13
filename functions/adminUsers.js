const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {writeAuditLog} = require("./auditLog");

const ALLOWED_STATUS = new Set(["active", "suspended", "deleted"]);
const ALLOWED_ROLE = new Set(["learner", "teacher", "admin"]);

async function assertCallerIsAdmin(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }
  const snap = await admin.firestore().doc(`users/${request.auth.uid}`).get();
  if (!snap.exists || snap.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role required.");
  }
  return {
    uid: request.auth.uid,
    email: snap.data()?.email || null,
  };
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

    await writeAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: "user.role_change",
      targetType: "user",
      targetId: uid,
      before: {role: before.role},
      after: {role},
    });

    return {ok: true, role};
  },
);
