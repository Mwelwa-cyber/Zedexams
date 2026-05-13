const admin = require("firebase-admin");

/**
 * writeAuditLog — appends a sensitive-action entry to adminAuditLogs.
 *
 * The caller is responsible for verifying the actor has admin rights
 * before invoking; this helper just persists the record. Writes go
 * through the admin SDK so Firestore rules (which deny client writes
 * to this collection) are bypassed safely.
 */
async function writeAuditLog({
  actorUid,
  actorEmail = null,
  action,
  targetType = null,
  targetId = null,
  before = null,
  after = null,
  metadata = null,
}) {
  if (!actorUid || !action) {
    throw new Error("writeAuditLog: actorUid + action are required");
  }
  try {
    await admin.firestore().collection("adminAuditLogs").add({
      actorUid,
      actorEmail,
      action,
      targetType,
      targetId,
      before,
      after,
      metadata,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Audit failures must never break the underlying action — log and move on.
    console.error("[auditLog] write failed", { action, targetType, targetId, err: err?.message });
  }
}

module.exports = { writeAuditLog };
