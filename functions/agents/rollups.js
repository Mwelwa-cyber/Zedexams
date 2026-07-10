/**
 * Rollup writes for the scheduled ops/growth agents (Vigil, Marshal, Till,
 * Echo, Quill, Compass, Anchor, the weekly Cala audit).
 *
 * Problem this solves: an agent on an hourly schedule that keeps finding the
 * same problem files a fresh `awaiting_approval` agentJobs doc EVERY run —
 * ~24 identical "Vigil — Site Monitor" cards a day flooding the approval
 * queue and the AI-agents badge. Nobody can (or should) acknowledge an
 * unchanged report once an hour.
 *
 * writeAgentRollup coalesces instead: when the new rollup is
 * `awaiting_approval` and an open (still-awaiting) rollup already exists for
 * the same agentId + input.runType, the existing doc is refreshed in place
 * with the latest report rather than adding a sibling. The queue then holds
 * at most ONE open card per agent per run type — always carrying the newest
 * findings — until an admin acknowledges it.
 *
 * Coalescing details:
 *   - `createdAt` is refreshed to now. Marshal's ran-in-window check and the
 *     dashboard's recency sort both read createdAt, so a coalesced run must
 *     still look like the fresh run it is.
 *   - The original createdAt is preserved as `firstSeenAt` (set once), and
 *     `coalescedRuns` counts how many runs folded into the card, so the
 *     admin can see how long the issue has been open.
 *   - Lookup is equality-only (agentId + status + input.runType), which
 *     Firestore serves from single-field indexes — no composite index needed.
 *
 * Non-awaiting statuses ('done', 'failed') never coalesce: quiet runs are
 * history, and each failure should be individually visible.
 */

/**
 * @param {object} db - Firestore instance (admin SDK).
 * @param {object} fieldValue - admin.firestore.FieldValue (injected for tests).
 * @param {object} job - Rollup fields: agentId, department, status, input
 *   (must carry runType), output, createdBy, runMs. createdAt is stamped here.
 * @returns {Promise<object>} the written document's ref.
 */
async function writeAgentRollup(db, fieldValue, job) {
  const col = db.collection("agentJobs");
  const runType = job.input && job.input.runType;

  if (job.status === "awaiting_approval" && runType) {
    const open = await col
        .where("agentId", "==", job.agentId)
        .where("status", "==", "awaiting_approval")
        .where("input.runType", "==", runType)
        .limit(1)
        .get();
    if (!open.empty) {
      const docSnap = open.docs[0];
      const existing = docSnap.data() || {};
      await docSnap.ref.update({
        ...job,
        createdAt: fieldValue.serverTimestamp(),
        firstSeenAt: existing.firstSeenAt || existing.createdAt ||
          fieldValue.serverTimestamp(),
        coalescedRuns: (Number(existing.coalescedRuns) || 1) + 1,
      });
      return docSnap.ref;
    }
  }

  return col.add({
    ...job,
    createdAt: fieldValue.serverTimestamp(),
  });
}

module.exports = {writeAgentRollup};
