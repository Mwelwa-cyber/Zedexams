/**
 * Scheduled health check + daily curriculum watcher trigger — v2.
 *
 *   - aiAgentHealthCheckScheduled: every 15 minutes. Reaps tasks stuck
 *     in non-terminal statuses for >10 minutes, marks them status:'error'.
 *   - curriculumUpdateCheckerScheduled: daily at 02:00 UTC. Invokes
 *     the Curriculum Watcher agent runner.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {runCurriculumWatcher} = require("./runners/curriculumWatcher");
const {writeAgentLog} = require("./logger");
const {COLLECTIONS, TASK_STATUS, SEVERITY} = require("./v2Collections");

const STUCK_MINUTES = 10;

// Non-terminal statuses that should be reaped if they sit too long.
const NON_TERMINAL = new Set([
  TASK_STATUS.QUEUED,
  TASK_STATUS.RUNNING,
  TASK_STATUS.THINKING,
  TASK_STATUS.GENERATING,
  TASK_STATUS.CHECKING,
  TASK_STATUS.WAITING,
  TASK_STATUS.REGENERATING,
]);

async function reapStuckTasks() {
  const cutoffMs = Date.now() - STUCK_MINUTES * 60 * 1000;
  const cutoff = admin.firestore.Timestamp.fromMillis(cutoffMs);

  const reaped = [];
  for (const status of NON_TERMINAL) {
    const snap = await admin.firestore()
        .collection(COLLECTIONS.TASKS)
        .where("status", "==", status)
        .where("createdAt", "<", cutoff)
        .limit(25)
        .get()
        .catch(() => null);
    if (!snap || snap.empty) continue;
    for (const doc of snap.docs) {
      await doc.ref.set({
        status: TASK_STATUS.ERROR,
        errorMessage: `reaped_after_${STUCK_MINUTES}m_in_${status}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      reaped.push({taskId: doc.id, fromStatus: status});
    }
  }

  await writeAgentLog({
    taskId: "scheduled",
    agentName: "AI Supervisor Agent",
    action: "health_check",
    message: `Reaped ${reaped.length} stuck task(s) older than ${STUCK_MINUTES}m`,
    taskType: "health_check",
    grade: null, subject: null, topic: null,
    severity: reaped.length ? SEVERITY.WARNING : SEVERITY.INFO,
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
