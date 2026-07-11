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

const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {resolveBackupBucket, buildExportRequest} = require("./firestoreBackupCore");
const {sendOpsAlert} = require("./opsAlert");

// Same SMTP secrets the other alerting crons bind (duplicate defineSecret of
// one name across modules is the repo's established pattern).
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

function dateKeyUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
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
} = {}) {
  const dateKey = dateKeyUtc(now);
  const statusRef = db.collection("opsBackups").doc(dateKey);
  const stamp = {ranAt: now.toISOString()};

  const bucketUri = resolveBackupBucket(env.FIRESTORE_BACKUP_BUCKET);
  if (!bucketUri) {
    console.warn(
        "[firestoreBackup] FIRESTORE_BACKUP_BUCKET is not set (or invalid) — " +
        "no backup will run. See functions/firestoreBackup.js for setup.",
    );
    const result = {status: "skipped-unconfigured"};
    await statusRef.set({...stamp, ...result}, {merge: true}).catch(() => {});
    return result;
  }

  const projectId = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || "";
  try {
    const request = buildExportRequest({projectId, bucketUri, dateKey});
    const client = adminClient ||
      new (require("@google-cloud/firestore").v1.FirestoreAdminClient)();
    const [operation] = await client.exportDocuments(request);
    const result = {
      status: "started",
      outputUriPrefix: request.outputUriPrefix,
      operation: (operation && operation.name) || null,
    };
    console.log("[firestoreBackup] export started", result);
    await statusRef.set({...stamp, ...result}, {merge: true}).catch(() => {});
    return result;
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 500);
    console.error("[firestoreBackup] export failed", message);
    const result = {status: "failed", error: message};
    await statusRef.set({...stamp, ...result}, {merge: true}).catch(() => {});
    // A silently-failing backup is the whole risk this cron exists to remove.
    await Promise.resolve(alert({
      title: "Firestore backup export FAILED",
      severity: "error",
      lines: [
        `Date: ${dateKey}`,
        `Error: ${message}`,
        `Destination: ${bucketUri}/firestore-exports/${dateKey}`,
        "Check IAM (datastore.importExportAdmin + storage.objectAdmin) " +
        "and that the bucket exists. See functions/firestoreBackup.js.",
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

module.exports = {dailyFirestoreBackup, runFirestoreExport, dateKeyUtc};
