/**
 * Pubo — Publisher runner.
 *
 * The only agent allowed to publish. Runs when an admin flips an
 * agentJobs doc from `awaiting_approval` to `approved`. Pubo flips the
 * private `aiGenerations` doc Aria created over to `visibility: 'public'`
 * and stamps approval metadata.
 *
 * Pubo never creates a new aiGenerations doc — that would fork the
 * schema and double-count usage. The doc was reserved by the underlying
 * teacher-tool runner during Aria; Pubo just authorises its release.
 */

const admin = require("firebase-admin");

/**
 * @param {object} args
 * @param {object} args.job - The approved agentJobs document data (with id).
 * @returns {Promise<object>} { publishedRefs }
 */
async function runPubo({job}) {
  if (job.status !== "approved") {
    throw new Error(
      `Pubo refuses: job status is ${job.status}, expected "approved".`,
    );
  }
  const ariaOutput = job.output && job.output.aria;
  const generationId = ariaOutput && ariaOutput.generationId;
  if (!generationId) {
    throw new Error("Pubo refuses: no aria.generationId on the job.");
  }
  const calaOutput = job.output && job.output.cala;
  const revaOutput = job.output && job.output.reva;
  if (!calaOutput) {
    throw new Error("Pubo refuses: missing CBC alignment (Cala must run).");
  }
  if (!revaOutput) {
    throw new Error("Pubo refuses: missing review (Reva must run).");
  }

  const db = admin.firestore();
  const genRef = db.collection("aiGenerations").doc(generationId);
  const genSnap = await genRef.get();
  if (!genSnap.exists) {
    throw new Error(`Pubo refuses: aiGenerations/${generationId} not found.`);
  }

  // Capture an admin override when Cala flagged the draft as not
  // aligned but the admin still chose to publish. We surface this on
  // the published aiGenerations doc so the audit trail survives even if
  // the agentJobs row is later cleaned up. Override is "active" when
  // the alignment verdict was not clean AND the admin supplied a
  // reason — clean approvals carry neither field forward.
  const calaUnaligned =
    calaOutput.aligned === false ||
    (Array.isArray(calaOutput.gaps) && calaOutput.gaps.length > 0) ||
    (Array.isArray(calaOutput.drift) && calaOutput.drift.length > 0);
  const overrideReason = typeof job.overrideReason === "string" ?
    job.overrideReason.trim() : "";
  const overrideActive = calaUnaligned && overrideReason.length > 0;

  await genRef.set({
    visibility: "public",
    approvedBy: job.reviewedBy || null,
    approvedJobId: job.id || null,
    publishedBy: "agent:pubo",
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    approvedWithOverride: overrideActive,
    overrideReason: overrideActive ? overrideReason : null,
  }, {merge: true});

  return {
    publishedRefs: [{collection: "aiGenerations", docId: generationId}],
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    approvedWithOverride: overrideActive,
  };
}

module.exports = {runPubo};
