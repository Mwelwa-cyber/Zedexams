/**
 * Content auto-publish gate — revives the Aria → Cala → Reva → Pubo line.
 *
 * The content pipeline already runs Aria → Cala → Reva whenever a content job
 * is created, then parks the result at status "awaiting_approval" for a human
 * to approve in /admin/agents (dispatcher.js). Nobody is staffed to click
 * Approve, so verified drafts rot in the queue and Pubo never publishes — the
 * single biggest reason the content agents "do nothing".
 *
 * This gate is the automated reviewer that does what a trusted human approver
 * would: it scans content jobs sitting at "awaiting_approval" and, for the
 * ones that clear a strict quality bar, flips status → "approved". That flip
 * fires the EXISTING dispatcher.agentJobsOnApproved trigger, which runs Pubo
 * and publishes — no new publish path, no change to the Aria/Cala/Reva chain.
 *
 * The bar (deliberately conservative — only what a reviewer would rubber-stamp):
 *   • Cala marked it CBC-aligned (output.cala.aligned === true), and
 *   • Cala left no open gaps (output.cala.gaps is empty), and
 *   • Reva's verdict is "approve" (her prompt uses "approve" only when no edit
 *     would block publishing).
 * Anything short of that stays "awaiting_approval" for a human — exactly the
 * current behaviour.
 *
 * OFF by default and reversible: it only acts when agentControl/content has
 * { autoPublish: true }. With the flag unset/false it evaluates nothing and
 * publishes nothing, so shipping it changes no behaviour until you opt in —
 * the "earn trust, then promote to auto" path. Pure + dependency-light (db
 * injected, no firebase-admin / LLM) so it unit-tests without Firebase.
 */

const MAX_JOBS = 50;

function clampMessage(err) {
  return String((err && err.message) || err || "").slice(0, 200);
}

/**
 * Decide whether a single content job may auto-publish. Pure.
 * @returns {{approve: boolean, reason: string}}
 */
function evaluateContentJob(job, config = {}) {
  if (!config || config.autoPublish !== true) {
    return {approve: false, reason: "auto-publish disabled"};
  }
  const out = (job && job.output) || {};
  const cala = out.cala || {};
  const reva = out.reva || {};

  if (cala.aligned !== true) {
    return {approve: false, reason: "held: not CBC-aligned (Cala)"};
  }
  const gaps = Array.isArray(cala.gaps) ? cala.gaps.length : 0;
  if (gaps > 0) {
    return {approve: false, reason: `held: ${gaps} open CBC gap(s) (Cala)`};
  }
  if (reva.verdict !== "approve") {
    return {approve: false, reason: `held: Reva verdict "${reva.verdict || "none"}"`};
  }
  return {approve: true, reason: "Cala aligned, no gaps, Reva approve"};
}

/**
 * Scan content jobs awaiting approval and auto-approve the ones that pass the
 * bar (which then publish via the existing Pubo trigger).
 *
 * @param {Object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {Object} [args.config]   { autoPublish: boolean } from agentControl/content.
 * @param {number} [args.now]
 * @param {number} [args.maxJobs]
 * @returns {Promise<Object>} summary
 */
async function runContentGate({db, config = {}, now = Date.now(), maxJobs = MAX_JOBS}) {
  const summary = {
    enabled: !!(config && config.autoPublish === true),
    evaluated: 0,
    autoApproved: [],
    held: [],
    errors: [],
  };

  const docs = [];
  try {
    // Uses the existing agentJobs (department, status, createdAt) composite
    // index — so only content jobs awaiting approval come back (qaEng rollups
    // that also sit at awaiting_approval never crowd this query).
    const snap = await db.collection("agentJobs")
        .where("department", "==", "content")
        .where("status", "==", "awaiting_approval")
        .orderBy("createdAt", "desc")
        .limit(maxJobs)
        .get();
    snap.forEach((doc) => docs.push({id: doc.id, data: doc.data() || {}}));
  } catch (err) {
    summary.errors.push({stage: "query", message: clampMessage(err)});
    return summary;
  }

  for (const {id, data} of docs) {
    if (data.seed === true) continue;
    // Only real generated content jobs carry Aria output; skip rollup/summary
    // docs that happen to sit at awaiting_approval.
    if (!(data.output && data.output.aria)) continue;

    summary.evaluated += 1;
    const tool = (data.input && data.input.tool) || null;
    const {approve, reason} = evaluateContentJob(data, config);
    if (!approve) {
      summary.held.push({id, tool, reason});
      continue;
    }

    try {
      // Mirrors the human approve path (AgentJobDetail.jsx) so Pubo and the
      // audit log treat it identically — just with reviewedBy "system".
      await db.collection("agentJobs").doc(id).set({
        status: "approved",
        reviewedBy: "system",
        autoApproved: true,
        autoApproveReason: reason,
        reviewedAt: new Date(now),
      }, {merge: true});
      summary.autoApproved.push({id, tool, reason});
    } catch (err) {
      summary.errors.push({id, stage: "approve", message: clampMessage(err)});
    }
  }

  return summary;
}

module.exports = {runContentGate, evaluateContentJob, MAX_JOBS};
