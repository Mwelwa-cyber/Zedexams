/**
 * Scheduled health check + daily curriculum watcher trigger.
 *
 * Two scheduled functions exported separately so they can be deployed
 * and observed independently:
 *
 *   - aiAgentHealthCheckScheduled: every 15 minutes. Reaps tasks stuck
 *     in non-terminal statuses for >10 minutes, refreshes
 *     liveAgentStates daily-stat counters, fails stuck tasks.
 *
 *   - curriculumUpdateCheckerScheduled: daily at 02:00 UTC. Invokes
 *     the Curriculum Watcher agent runner.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {runCurriculumWatcher} = require("./runners/curriculumWatcher");
const {writeAgentLog} = require("./logger");

const STUCK_MINUTES = 10;
const NON_TERMINAL = new Set([
  "queued",
  "supervisor_planning",
  "curriculum_read",
  "generating",
  "quality_check",
]);

async function reapStuckTasks() {
  const cutoffMs = Date.now() - STUCK_MINUTES * 60 * 1000;
  const cutoff = admin.firestore.Timestamp.fromMillis(cutoffMs);

  // Index used: (status ASC, createdAt DESC). We can only query one
  // status at a time without a special index, so we sweep each
  // non-terminal status separately.
  const reaped = [];
  for (const status of NON_TERMINAL) {
    const snap = await admin.firestore()
        .collection("aiAgentTasks")
        .where("status", "==", status)
        .where("createdAt", "<", cutoff)
        .limit(25)
        .get()
        .catch(() => null);
    if (!snap || snap.empty) continue;
    for (const doc of snap.docs) {
      await doc.ref.set({
        status: "failed",
        errorReason: `reaped_after_${STUCK_MINUTES}m_in_${status}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      reaped.push({taskId: doc.id, fromStatus: status});
    }
  }

  await writeAgentLog({
    agentId: "supervisor",
    action: "health_check",
    inputSummary: {stuckMinutes: STUCK_MINUTES},
    outputSummary: {reapedCount: reaped.length, reaped},
    level: reaped.length ? "warning" : "info",
    curriculumGrounded: false,
  });

  return reaped.length;
}

function createAiAgentHealthCheckScheduled() {
  return onSchedule(
      {
        schedule: "every 15 minutes",
        region: "us-central1",
        timeoutSeconds: 120,
      },
      async () => {
        try {
          await reapStuckTasks();
        } catch (err) {
          console.error("aiAgentHealthCheck failed", err);
        }
      },
  );
}

function createCurriculumUpdateCheckerScheduled() {
  return onSchedule(
      {
        schedule: "0 2 * * *",
        timeZone: "UTC",
        region: "us-central1",
        timeoutSeconds: 540,
      },
      async () => {
        try {
          await runCurriculumWatcher({task: {id: `scheduled-${Date.now()}`}});
        } catch (err) {
          console.error("curriculumUpdateChecker scheduled run failed", err);
        }
      },
  );
}

module.exports = {
  createAiAgentHealthCheckScheduled,
  createCurriculumUpdateCheckerScheduled,
  reapStuckTasks,
};
