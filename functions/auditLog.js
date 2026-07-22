const admin = require("firebase-admin");
const {sendOpsAlert} = require("./opsAlert");

/**
 * Shape (and validate) a sensitive-action audit entry, minus the server
 * timestamp. Pure — no I/O — so the record shape is unit-testable and a
 * malformed call fails fast at the boundary rather than writing junk.
 *
 * @returns {object} the adminAuditLogs document body (sans createdAt)
 */
function buildAuditEntry({
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
  return {actorUid, actorEmail, action, targetType, targetId, before, after, metadata};
}

/**
 * writeAuditLog — appends a sensitive-action entry to adminAuditLogs.
 *
 * The caller verifies the actor has admin rights before invoking; this helper
 * just persists the record. Writes go through the admin SDK so Firestore rules
 * (which deny client writes to this collection) are bypassed safely.
 *
 * A failed audit write MUST NOT break the underlying action (a role change /
 * payment confirmation must still succeed) — but it must no longer be SILENT
 * (OBS-002: a swallowed failure meant an action could succeed with no ledger
 * entry and nobody the wiser — a forensic gap for a platform handling money +
 * child data). On failure this now raises an ops alert and returns
 * `{written: false}` so the gap is loud and the caller can react if it wants.
 *
 * Back-compat: the second arg is optional injected deps ({db, alert}); existing
 * callers that pass only the fields object are unchanged.
 *
 * @returns {Promise<{written: boolean, id?: string, error?: string}>}
 */
async function writeAuditLog(fields, {db, alert = sendOpsAlert} = {}) {
  const entry = buildAuditEntry(fields); // throws on missing actorUid/action
  const firestore = db || admin.firestore();
  try {
    const ref = await firestore.collection("adminAuditLogs").add({
      ...entry,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {written: true, id: ref.id};
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 300);
    // Keep the underlying action alive, but make the ledger gap LOUD.
    console.error("[auditLog] write failed", {
      action: entry.action, targetType: entry.targetType, targetId: entry.targetId, err: message,
    });
    await Promise.resolve(alert({
      title: "Audit ledger write FAILED — a sensitive action has no record",
      severity: "error",
      lines: [
        `Action: ${entry.action}`,
        `Actor: ${entry.actorUid}${entry.actorEmail ? ` (${entry.actorEmail})` : ""}`,
        `Target: ${entry.targetType || "?"} / ${entry.targetId || "?"}`,
        `Error: ${message}`,
        "The underlying action still succeeded, but adminAuditLogs has NO entry " +
        "for it. Investigate Firestore health; the forensic record is incomplete.",
      ],
    })).catch(() => {});
    return {written: false, error: message};
  }
}

module.exports = {writeAuditLog, buildAuditEntry};
