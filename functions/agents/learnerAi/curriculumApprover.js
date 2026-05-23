/**
 * Curriculum approval trigger — fires when an admin flips a
 * `curriculumUpdateReports/{reportId}` doc to `'approved'` or
 * `'rejected'`. Writes an audit log entry mirroring the pattern in
 * `dispatcher.js createAiAgentTasksOnApproved`.
 *
 * Per the spec, curriculum updates NEVER auto-apply. This trigger
 * does NOT mutate `cbcKnowledgeBase` — that's an explicit admin
 * action via `/admin/cbc-kb`. The trigger only records who
 * approved / rejected the report so the audit trail covers
 * curriculum-update decisions the same way it covers learner-AI
 * artifact approvals.
 *
 * Companion to dispatcher.js. Exported via functions/index.js as the
 * `curriculumUpdateReportsOnApproved` Cloud Function.
 */

const admin = require("firebase-admin");
const {onDocumentUpdated} = require("firebase-functions/v2/firestore");

const TRIGGER_OPTS = {
  document: "curriculumUpdateReports/{reportId}",
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
};

const TERMINAL_STATUSES = new Set(["approved", "rejected", "applied"]);

function createCurriculumUpdateReportsOnApproved() {
  return onDocumentUpdated(TRIGGER_OPTS, async (event) => {
    const before = event.data && event.data.before && event.data.before.data();
    const after = event.data && event.data.after && event.data.after.data();
    if (!before || !after) return;
    if (before.status === after.status) return;

    const beforeStatus = String(before.status || "");
    const afterStatus = String(after.status || "");
    if (!TERMINAL_STATUSES.has(afterStatus)) return;
    // Only fire on the FIRST transition into a terminal state. Skip
    // approved → applied transitions for now (they would need a
    // separate audit action; revisit if the "applied" workflow lands).
    if (beforeStatus !== "pending_review") return;

    const reportId = event.params.reportId;
    const actorUid = String(after.reviewedBy || "system");
    let action;
    if (afterStatus === "approved") action = "learner_ai.curriculum_approve";
    else if (afterStatus === "rejected") action = "learner_ai.curriculum_reject";
    else action = `learner_ai.curriculum_${afterStatus}`;

    try {
      const {writeAuditLog} = require("../../auditLog");
      await writeAuditLog({
        actorUid,
        action,
        targetType: "curriculumUpdateReport",
        targetId: reportId,
        metadata: {
          sourceName: after.sourceName || null,
          sourceUrl: after.sourceUrl || null,
          trustLevel: after.trustLevel || null,
          affectedGrades: Array.isArray(after.affectedGrades) ?
            after.affectedGrades : null,
          affectedSubjects: Array.isArray(after.affectedSubjects) ?
            after.affectedSubjects : null,
        },
      });
    } catch (err) {
      console.warn("[curriculumApprover] audit log write failed",
          err && err.message);
    }
  });
}

module.exports = {createCurriculumUpdateReportsOnApproved};
