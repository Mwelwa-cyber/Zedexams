/**
 * Daily Firestore backup export — the platform's disaster-recovery floor.
 *
 * Payments, users, subscriptions, all content, and the agent fleet's state
 * live in the single (default) africa-south1 database; before this cron there
 * was no export, no PITR runbook, nothing. Each run kicks off a Firestore
 * Admin exportDocuments long-running operation into a versioned GCS bucket
 * (dated folder per day) and records the outcome in opsBackups/{date} so the
 * admin surfaces (and a future Marshal check) can see whether backups run.
 *
 * One-time setup (documented here because the code can't do it):
 *   1. Create the destination bucket in a DIFFERENT region from the database
 *      (e.g. europe-west1) with a lifecycle rule expiring objects after ~30d.
 *   2. Grant the Functions runtime service account
 *      roles/datastore.importExportAdmin on the project and
 *      roles/storage.objectAdmin on the bucket.
 *   3. Set FIRESTORE_BACKUP_BUCKET (bucket name or gs:// uri) on the runtime
 *      (functions/.env.<project>). Until it's set the cron logs a warning and
 *      records status "skipped-unconfigured" — deploying first is safe.
 *   4. Consider enabling point-in-time recovery on the database as well
 *      (`gcloud firestore databases update --enable-pitr`) — PITR covers
 *      fat-finger deletes within 7 days; the export covers everything else.
 *
 * The exportDocuments call returns as soon as the operation is accepted —
 * the export itself continues server-side, so the function never waits on
 * (or times out with) a large database.
 */

const crypto = require("node:crypto");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {
  resolveBackupBucket,
  buildExportRequest,
  isProductionRuntime,
  classifyExportError,
} = require("./firestoreBackupCore");
const {sendOpsAlert} = require("./opsAlert");

// Same SMTP secrets the other alerting crons bind (duplicate defineSecret of
// one name across modules is the repo's established pattern).
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

function dateKeyUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Terminal run statuses. Deliberately DISTINCT so a skipped/misconfigured run
// is never mistaken for a real one:
//   misconfigured          — production runtime, no valid bucket (alerts).
//   skipped-non-production  — dev/emulator, no bucket (explicit, no alert).
//   started                 — export operation ACCEPTED by the Admin API. NOT
//                             the same as "completed": exportDocuments is a
//                             long-running op that finishes server-side, so the
//                             cron records acceptance, not completion. A
//                             completion check is a documented follow-up.
//   failed                  — the Admin API rejected the export (alerts).
const BACKUP_STATUS = Object.freeze({
  MISCONFIGURED: "misconfigured",
  SKIPPED_NON_PROD: "skipped-non-production",
  STARTED: "started",
  FAILED: "failed",
});

// One structured, greppable log line per run. Every backup execution emits
// exactly one of these with a stable field set (operation, project, bucket,
// timings, exportPath, status, error code/category, correlationId).
function logBackupEvent(fields) {
  try {
    console.log("[firestoreBackup]", JSON.stringify(fields));
  } catch (_e) {
    console.log("[firestoreBackup]", fields && fields.status);
  }
}

/**
 * One export run. All I/O is injectable so the plain-node test can drive
 * every path (skip / started / failed) without firebase or the Admin API.
 * Never throws — a backup failure must alert, not crash-loop the scheduler.
 *
 * @param {object} [deps]
 * @param {FirebaseFirestore.Firestore} [deps.db]
 * @param {{exportDocuments: Function}} [deps.adminClient] — v1.FirestoreAdminClient
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {Function} [deps.alert] — sendOpsAlert-compatible
 * @param {Date} [deps.now]
 * @returns {Promise<{status: string, outputUriPrefix?: string, error?: string}>}
 */
async function runFirestoreExport({
  db = admin.firestore(),
  adminClient = null,
  env = process.env,
  alert = sendOpsAlert,
  now = new Date(),
  correlationId = crypto.randomUUID(),
} = {}) {
  const dateKey = dateKeyUtc(now);
  const startTime = now.toISOString();
  const statusRef = db.collection("opsBackups").doc(dateKey);
  const projectId = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || "";
  const production = isProductionRuntime(env);
  const bucketUri = resolveBackupBucket(env.FIRESTORE_BACKUP_BUCKET);

  const base = {
    correlationId, projectId, bucket: bucketUri || null,
    dateKey, startTime, production,
  };
  // Persist the run outcome; opsBackups doc is the durable record the admin
  // surfaces + a future Marshal freshness-check read. Emits exactly one
  // structured log line and one status-doc write per run.
  const record = async (fields) => {
    const completeTime = new Date().toISOString();
    logBackupEvent({...base, ...fields, completeTime});
    await statusRef.set(
        {...base, ...fields, ranAt: startTime, completeTime},
        {merge: true},
    ).catch(() => {});
  };

  // ── Unconfigured: distinguish a real MISCONFIGURATION from a dev SKIP ─────
  if (!bucketUri) {
    if (!production) {
      const result = {status: BACKUP_STATUS.SKIPPED_NON_PROD};
      await record(result);
      return result;
    }
    // Production with no valid bucket = the DR floor is OFF. Alert loudly.
    const result = {
      status: BACKUP_STATUS.MISCONFIGURED,
      errorCategory: "config",
      errorCode: "FIRESTORE_BACKUP_BUCKET_UNSET",
    };
    await record(result);
    await Promise.resolve(alert({
      title: "Firestore backup MISCONFIGURED — no backups are running",
      severity: "error",
      lines: [
        `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
        "FIRESTORE_BACKUP_BUCKET is not set (or invalid) on the production " +
        "Functions runtime, so the daily export is NOT running. The database " +
        "currently has NO disaster-recovery export.",
        "Fix: create a cross-region GCS bucket, grant the runtime SA " +
        "datastore.importExportAdmin + storage.objectAdmin, and set " +
        "FIRESTORE_BACKUP_BUCKET (functions/.env.<project>). See " +
        "docs/production-readiness/runbooks/firestore-restore.md.",
      ],
    })).catch(() => {});
    return result;
  }

  // ── Configured: kick off the export operation ────────────────────────────
  try {
    const request = buildExportRequest({projectId, bucketUri, dateKey});
    const client = adminClient ||
      new (require("@google-cloud/firestore").v1.FirestoreAdminClient)();
    const [operation] = await client.exportDocuments(request);
    const result = {
      status: BACKUP_STATUS.STARTED,
      operationName: (operation && operation.name) || null,
      exportPath: request.outputUriPrefix,
      // Explicit: acceptance ≠ completion (long-running op finishes async).
      completed: false,
    };
    await record(result);
    return result;
  } catch (err) {
    const {code, category} = classifyExportError(err);
    const message = String((err && err.message) || err).slice(0, 500);
    const result = {
      status: BACKUP_STATUS.FAILED,
      error: message,
      errorCode: code,
      errorCategory: category,
      exportPath: `${bucketUri}/firestore-exports/${dateKey}`,
    };
    await record(result);
    // A silently-failing backup is the whole risk this cron exists to remove.
    await Promise.resolve(alert({
      title: "Firestore backup export FAILED",
      severity: "error",
      lines: [
        `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
        `Category: ${category}  ·  Code: ${code}`,
        `Error: ${message}`,
        `Destination: ${bucketUri}/firestore-exports/${dateKey}`,
        "Check IAM (datastore.importExportAdmin + storage.objectAdmin) " +
        "and that the bucket exists. See " +
        "docs/production-readiness/runbooks/firestore-restore.md.",
      ],
    })).catch(() => {});
    return result;
  }
}

// 01:30 Lusaka — after the daily-exam picker (05:00 is picker; content crons
// run 02:00-03:00) but on the quiet side of the night, and before the
// business day starts. Scheduled functions stay in us-central1 per the
// repo's region convention (only Firestore *triggers* pin to africa-south1);
// the export operation itself runs server-side next to the database.
const BACKUP_OPTS = {
  schedule: "every day 01:30",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
  secrets: [emailSmtpUser, emailSmtpPassword],
};

const dailyFirestoreBackup = onSchedule(BACKUP_OPTS, async () => {
  await runFirestoreExport();
});

/**
 * Optional retention cleanup. PRIMARY retention is a GCS bucket lifecycle rule
 * (see the runbook) — this is a code-level safeguard, kept DRY-RUN BY DEFAULT
 * and intentionally NOT scheduled in this phase (deleting real exports without
 * a rehearsed drill is exactly what change-control forbids). All I/O is
 * injected so it is unit-testable and can never delete outside a controlled,
 * explicitly `apply:true` invocation. Delegates the "what to delete" decision
 * to the pure, tested selectExportsToDelete (never the newest, never an
 * incomplete/unverified export, always keep >= keepMinimum).
 *
 * @param {object} deps
 * @param {() => Promise<Array>} deps.listExports — returns [{path,dateKey,
 *   createdAtMs,completed}]
 * @param {(path: string) => Promise<void>} deps.deleteExport
 * @param {boolean} [deps.apply=false] — false = dry run (log only)
 * @param {number} [deps.retentionDays]
 * @param {number} [deps.keepMinimum]
 * @param {number} [deps.nowMs]
 */
async function runBackupRetention({
  listExports, deleteExport, apply = false,
  retentionDays = 30, keepMinimum = 7, nowMs = Date.now(),
}) {
  const {selectExportsToDelete} = require("./firestoreBackupCore");
  const exports = (await listExports()) || [];
  const {toDelete, kept} = selectExportsToDelete(exports, {
    retentionDays, keepMinimum, nowMs,
  });
  for (const e of toDelete) {
    logBackupEvent({
      action: "retention-delete", apply, path: e && e.path,
      dateKey: e && e.dateKey,
    });
    if (apply && e && e.path) {
      // Never abort the sweep on a single failed delete.
      await Promise.resolve(deleteExport(e.path)).catch((err) => {
        logBackupEvent({
          action: "retention-delete-failed", path: e.path,
          error: String((err && err.message) || err).slice(0, 200),
        });
      });
    }
  }
  return {deleted: apply ? toDelete.length : 0, planned: toDelete.length, kept: kept.length};
}

module.exports = {
  dailyFirestoreBackup,
  runFirestoreExport,
  runBackupRetention,
  dateKeyUtc,
  BACKUP_STATUS,
};
