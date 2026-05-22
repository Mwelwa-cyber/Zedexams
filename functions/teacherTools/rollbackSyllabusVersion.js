/**
 * rollbackSyllabusVersion — admin-only HTTPS callable.
 *
 * Phase D one-click rollback. Reverses the most recent
 * activateSyllabusVersion by flipping the active-version pointer back
 * to whatever was previously active. No data movement — `topics/*` for
 * the previous version was left in place by the activate flow, so the
 * pointer flip is sufficient.
 *
 * Behaviour:
 *  1. Reads cbcKnowledgeBase/_meta. Refuses if there's no
 *     previousVersion (nothing to roll back to).
 *  2. Optional `expectedCurrentVersion` race guard: refuses if a second
 *     admin has activated something else in the meantime.
 *  3. Atomically writes:
 *       _meta = {
 *         version: previousVersion,            // swap
 *         previousVersion: current,            // so we can ping-pong
 *         usePrivateCurriculum: true,          // restore legacy fallback
 *         cacheBust: increment(1),             // propagate to warm
 *         rolledBackBy, rolledBackAt, updatedAt
 *       }
 *  4. Locally invalidates the in-process caches and reads back the new
 *     cacheBust for the client.
 *
 * Returns { ok, version, previousVersion, cacheBust }.
 *
 * Why restore usePrivateCurriculum=true on rollback:
 * the only time we ever turn the RAG path off is during
 * activateSyllabusVersion (Phase C). The seed version + any pre-Phase-C
 * deploys ran with the RAG path on. Restoring it on rollback matches
 * "undo what activate did" without needing to remember per-activation
 * whether RAG was on or off before.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {
  getUserRole,
} = require("../aiService");
const {
  invalidateKbCache,
  getActiveKbState,
} = require("./cbcKnowledge");

exports.rollbackSyllabusVersion = onCall(
  {region: "us-central1", timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const role = await getUserRole(uid);
    if (role !== "admin" && role !== "superAdmin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }

    const expectedCurrent =
      request.data && typeof request.data.expectedCurrentVersion === "string" ?
        request.data.expectedCurrentVersion : null;

    const activeBefore = await getActiveKbState();
    if (expectedCurrent !== null && activeBefore.version !== expectedCurrent) {
      throw new HttpsError(
        "failed-precondition",
        `Active version is now "${activeBefore.version}", not the ` +
        `"${expectedCurrent}" the rollback request was based on. ` +
        "Reload the page and try again.",
      );
    }

    const db = admin.firestore();
    const metaRef = db.doc("cbcKnowledgeBase/_meta");
    const metaSnap = await metaRef.get();
    if (!metaSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "No active-version pointer exists yet — nothing to roll back to.",
      );
    }
    const metaData = metaSnap.data() || {};
    const previousVersion =
      typeof metaData.previousVersion === "string" && metaData.previousVersion ?
        metaData.previousVersion : null;
    if (!previousVersion) {
      throw new HttpsError(
        "failed-precondition",
        "No previousVersion recorded — nothing to roll back to.",
      );
    }
    if (previousVersion === activeBefore.version) {
      // Defensive: shouldn't happen, but if it does, refuse rather than
      // create a corrupt pointer.
      throw new HttpsError(
        "failed-precondition",
        "previousVersion equals current version — pointer is corrupt. " +
        "Set _meta manually in the Firestore Console.",
      );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    await metaRef.set({
      version: previousVersion,
      previousVersion: activeBefore.version,
      usePrivateCurriculum: true,
      cacheBust: admin.firestore.FieldValue.increment(1),
      rolledBackBy: uid,
      rolledBackAt: now,
      updatedAt: now,
    }, {merge: true});

    try {
      invalidateKbCache();
    } catch {
      // Best effort.
    }

    let cacheBust = null;
    try {
      const after = await metaRef.get();
      cacheBust = after.exists ? (Number(after.data()?.cacheBust) || 0) : 0;
    } catch {
      // Best effort.
    }

    return {
      ok: true,
      version: previousVersion,
      previousVersion: activeBefore.version,
      cacheBust,
    };
  },
);
