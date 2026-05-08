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

  await genRef.set({
    visibility: "public",
    approvedBy: job.reviewedBy || null,
    approvedJobId: job.id || null,
    publishedBy: "agent:pubo",
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return {
    publishedRefs: [{collection: "aiGenerations", docId: generationId}],
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

module.exports = {runPubo};
