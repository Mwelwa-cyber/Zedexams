/**
 * Cross-subsystem ops dead-man's-switch (OBS-004) — the watcher of the
 * watchers. The per-subsystem canaries (dailyFirestoreBackup, storageBackupCheck,
 * rateLimitHealthCheck, backupCompletionCheck) each alert when their subsystem
 * is unhealthy, but none can alert if their OWN scheduled trigger stops firing:
 * a dead cron writes no status doc and raises no alarm.
 *
 * This scheduled check reads each subsystem's heartbeat (its ops status doc)
 * and raises ONE ops alert (edge-triggered) listing any heartbeat that is stale
 * or missing — i.e. a scheduled job that has silently stopped. It closes the
 * last OBS-004 residual: alerting on the ABSENCE of a signal, not just on a
 * subsystem actively reporting a problem.
 *
 * See docs/production-readiness/11-observability-and-audit.md (OBS-004).
 */

const crypto = require("node:crypto");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {
  HEARTBEATS,
  HOUR_MS,
  docTimestampMs,
  classifyHeartbeat,
  summarizeHeartbeats,
  shouldAlertHeartbeat,
  recentUtcDateKeys,
} = require("./opsHeartbeatCore");
const {sendOpsAlert} = require("./opsAlert");
const {opsAlertSecrets} = require("./opsAlertSecrets");

const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

const STATUS_DOC = "status"; // opsHeartbeat/status — the last fleet verdict

function logEvent(fields) {
  try {
    console.log("[opsHeartbeat]", JSON.stringify(fields));
  } catch (_e) {
    console.log("[opsHeartbeat]", fields && fields.verdict);
  }
}

/**
 * Default production heartbeat probe: the freshest timestamp for one heartbeat.
 *   - 'doc'   → read the fixed status doc.
 *   - 'dated' → read the last few UTC date docs and take the newest timestamp
 *               (documentId is the UTC date; reading a small fixed set avoids
 *               needing an index/query).
 * @returns {Promise<number|null>} freshest heartbeat ms, or null
 */
async function readHeartbeatTimestamp(db, hb, now) {
  if (hb.kind === "doc") {
    const snap = await db.collection(hb.collection).doc(hb.doc).get();
    return snap.exists ? docTimestampMs(snap.data()) : null;
  }
  // dated
  let latest = null;
  for (const dateKey of recentUtcDateKeys(now, 3)) {
    let snap;
    try {
      snap = await db.collection(hb.collection).doc(dateKey).get();
    } catch (_e) { continue; }
    if (!snap.exists) continue;
    const ms = docTimestampMs(snap.data());
    if (ms != null && (latest == null || ms > latest)) latest = ms;
  }
  return latest;
}

/**
 * One dead-man's-switch run. All I/O injectable so the plain-node test drives
 * every path without firebase. Never throws.
 *
 * @param {object} [deps]
 * @param {FirebaseFirestore.Firestore} [deps.db]
 * @param {(db, hb, now) => Promise<number|null>} [deps.readTimestamp]
 * @param {Function} [deps.alert]
 * @param {Date} [deps.now]
 * @returns {Promise<{verdict: string, unhealthy: string[], alerted: boolean}>}
 */
async function runOpsHeartbeatCheck({
  db = admin.firestore(),
  readTimestamp = readHeartbeatTimestamp,
  alert = sendOpsAlert,
  now = new Date(),
  correlationId = crypto.randomUUID(),
} = {}) {
  const nowMs = now.getTime();

  const results = [];
  for (const hb of HEARTBEATS) {
    let latestTsMs = null;
    try {
      latestTsMs = await readTimestamp(db, hb, now);
    } catch (_e) {
      // Treat an unreadable heartbeat as missing rather than crashing the switch.
      latestTsMs = null;
    }
    const status = classifyHeartbeat({latestTsMs, nowMs, maxAgeMs: hb.maxAgeHours * HOUR_MS});
    results.push({
      name: hb.name, status, cron: hb.cron,
      ageHours: latestTsMs == null ? null : Math.round(((nowMs - latestTsMs) / HOUR_MS) * 10) / 10,
    });
  }

  const summary = summarizeHeartbeats(results);
  const checkedAt = now.toISOString();
  const statusRef = db.collection("opsHeartbeat").doc(STATUS_DOC);

  let previousVerdict = null;
  try {
    const snap = await statusRef.get();
    previousVerdict = snap.exists ? (snap.data() || {}).verdict || null : null;
  } catch (_e) { /* best-effort */ }

  const alerted = shouldAlertHeartbeat(summary.verdict, previousVerdict);
  logEvent({event: "ops_heartbeat", verdict: summary.verdict, unhealthy: summary.unhealthy, previousVerdict, alerted, correlationId, checkedAt});

  const statusDoc = {
    verdict: summary.verdict,
    unhealthy: summary.unhealthy,
    heartbeats: results,
    previousVerdict,
    checkedAt,
    correlationId,
  };
  if (alerted) statusDoc.lastAlertedAt = checkedAt;
  await statusRef.set(statusDoc, {merge: true}).catch(() => {});

  if (alerted) {
    const detail = results
      .filter((r) => r.status !== "fresh")
      .map((r) => `• ${r.name} (${r.cron}) — ${r.status}${r.ageHours != null ? ` (~${r.ageHours}h old)` : ""}`);
    await Promise.resolve(alert({
      title: "Ops monitoring heartbeat STALE — a scheduled job has stopped",
      severity: "error",
      lines: [
        `correlationId: ${correlationId}  ·  ${checkedAt}`,
        "The cross-subsystem dead-man's-switch found a stale/missing heartbeat — " +
        "the scheduled job that writes it appears to have stopped firing, so that " +
        "subsystem's own alerts would NOT fire either:",
        ...detail,
        "Check the function's schedule/quota/deploy in the Cloud console.",
      ],
    })).catch(() => {});
  }

  return {verdict: summary.verdict, unhealthy: summary.unhealthy, alerted};
}

// Every 6 hours — catches a stopped hourly limiter cron within ~6h and a stopped
// daily backup within its 30h window, without over-alerting. us-central1 per
// the repo region convention for scheduled functions.
const opsHeartbeatCheck = onSchedule({
  schedule: "every 6 hours",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
  secrets: opsAlertSecrets([emailSmtpUser, emailSmtpPassword]),
}, async () => {
  await runOpsHeartbeatCheck();
});

module.exports = {
  opsHeartbeatCheck,
  runOpsHeartbeatCheck,
  readHeartbeatTimestamp,
};
