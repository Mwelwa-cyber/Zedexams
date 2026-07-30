/**
 * Firebase Storage backup HEALTH CHECK — the Storage half of the DR floor
 * (DR-003). The Firestore export (firestoreBackup.js) backs up Firestore only;
 * generated images, uploads, exports and past papers live in the Storage
 * bucket with NO backup, and a delete is unrecoverable.
 *
 * Architecture: the cross-region COPY is a Storage Transfer Service (STS) job
 * the operator provisions once (a Cloud Function copying the whole bucket daily
 * would be the wrong tool — cost/timeouts/scale). This module is the piece that
 * makes that mirror TRUSTWORTHY: a daily check that the backup bucket received
 * a recent object, recording the outcome in opsStorageBackups/{date} and
 * alerting ops when the mirror is misconfigured, empty, or stale (a silently
 * stopped backup — the exact DR-003 risk). Same shape as the Firestore backup
 * runner: injectable I/O, never throws, one structured log + one status doc.
 *
 * One-time setup (documented here because the code can't do it):
 *   1. Enable Object Versioning on the PRIMARY bucket
 *      (gs://examsprepzambia.firebasestorage.app) — protects individual objects
 *      from overwrite/delete.
 *   2. Create a cross-region backup bucket (different region from the primary),
 *      uniform access, a retention lifecycle rule, and versioning.
 *   3. Create a Storage Transfer Service job: source = primary bucket,
 *      destination = backup bucket, daily schedule. Grant the STS service
 *      account roles/storage.objectViewer on the source and
 *      roles/storage.objectAdmin on the destination.
 *   4. Set STORAGE_BACKUP_BUCKET (bucket name or gs:// uri) on the runtime
 *      (functions/.env.<project>). Optionally STORAGE_BACKUP_PREFIX (scope the
 *      freshness scan to the mirror path) and STORAGE_BACKUP_MAX_AGE_HOURS.
 *      Until it's set the checker records "misconfigured" (prod, alerts) /
 *      "skipped-non-production" (dev) — deploying first is safe.
 *
 * See docs/production-readiness/14-backup-and-disaster-recovery.md (DR-003) +
 * runbooks/firestore-restore.md.
 */

const crypto = require("node:crypto");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {isProductionRuntime} = require("./firestoreBackupCore");
const {
  resolveStorageBackupBucket,
  classifyBackupFreshness,
  resolveMaxAgeMs,
} = require("./storageBackupCore");
const {sendOpsAlert} = require("./opsAlert");
const {opsAlertSecrets} = require("./opsAlertSecrets");

const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

function dateKeyUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

const STORAGE_BACKUP_STATUS = Object.freeze({
  MISCONFIGURED: "misconfigured", // prod, no backup bucket configured (alerts)
  SKIPPED_NON_PROD: "skipped-non-production", // dev/emulator (no alert)
  EMPTY: "empty", // backup destination has no objects (alerts)
  STALE: "stale", // newest object older than the threshold (alerts)
  FRESH: "fresh", // a recent object exists — mirror is healthy
  ERROR: "error", // the freshness lookup itself failed (alerts)
});

function logStorageBackupEvent(fields) {
  try {
    console.log("[storageBackup]", JSON.stringify(fields));
  } catch (_e) {
    console.log("[storageBackup]", fields && fields.status);
  }
}

/**
 * Default production freshness probe: the newest object mtime under `prefix` in
 * the backup bucket, via the Admin Storage SDK.
 *
 * GCS lists objects in LEXICOGRAPHIC NAME order, never by mtime, so "the newest
 * object" is only knowable by looking at every object in range. The first
 * version of this probe read one 5000-object page and stopped, and a Storage
 * Transfer Service mirror reproduces the source layout — there is no dated
 * path for STORAGE_BACKUP_PREFIX to point at — so past ~5000 objects the newest
 * one routinely sorts outside the page and a perfectly healthy mirror reads as
 * `stale`. A 04:00 alert that cries wolf is worse than no alert: it is how a
 * real one gets ignored. So the scan PAGES, and when it hits its page cap it
 * says so (`truncated`) rather than drawing a conclusion from a partial view.
 *
 * @returns {Promise<{latestUpdatedMs: number|null, scanned: number, truncated: boolean}>}
 */
async function probeLatestBackupObject(
    bucketName,
    {prefix = "", pageSize = 1000, maxPages = 200} = {},
) {
  const bucket = admin.storage().bucket(bucketName);
  let query = {prefix, maxResults: pageSize, autoPaginate: false};
  let latestUpdatedMs = null;
  let scanned = 0;
  let pages = 0;
  let truncated = false;

  while (query) {
    // autoPaginate:false resolves to [files, nextQuery] — nextQuery is null on
    // the last page. Paginating by hand keeps each round trip bounded.
    const [files, nextQuery] = await bucket.getFiles(query);
    pages += 1;
    for (const f of files || []) {
      const updated = f && f.metadata && (f.metadata.updated || f.metadata.timeCreated);
      const ms = updated ? Date.parse(updated) : NaN;
      if (Number.isFinite(ms) && (latestUpdatedMs == null || ms > latestUpdatedMs)) {
        latestUpdatedMs = ms;
      }
    }
    scanned += (files || []).length;
    if (!nextQuery) break;
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    query = nextQuery;
  }

  return {latestUpdatedMs, scanned, truncated};
}

/**
 * One Storage-backup health check. All I/O injectable so the plain-node test
 * drives every path (misconfigured / skip / empty / stale / fresh / error)
 * without firebase or GCS. Never throws.
 *
 * @param {object} [deps]
 * @param {FirebaseFirestore.Firestore} [deps.db]
 * @param {(bucketName: string, opts: object) => Promise<{latestUpdatedMs: number|null, scanned: number}>} [deps.probe]
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {Function} [deps.alert]
 * @param {Date} [deps.now]
 * @returns {Promise<{status: string, ageHours?: number|null}>}
 */
async function runStorageBackupCheck({
  db = admin.firestore(),
  probe = probeLatestBackupObject,
  env = process.env,
  alert = sendOpsAlert,
  now = new Date(),
  correlationId = crypto.randomUUID(),
} = {}) {
  const dateKey = dateKeyUtc(now);
  const nowMs = now.getTime();
  const production = isProductionRuntime(env);
  const bucketName = resolveStorageBackupBucket(env.STORAGE_BACKUP_BUCKET);
  const prefix = String(env.STORAGE_BACKUP_PREFIX || "");
  const maxAgeMs = resolveMaxAgeMs(env.STORAGE_BACKUP_MAX_AGE_HOURS);

  const base = {
    correlationId, dateKey, production,
    backupBucket: bucketName || null, prefix: prefix || null,
    maxAgeHours: Math.round(maxAgeMs / (60 * 60 * 1000)),
    checkedAt: now.toISOString(),
  };
  const statusRef = db.collection("opsStorageBackups").doc(dateKey);
  const record = async (fields) => {
    logStorageBackupEvent({...base, ...fields});
    await statusRef.set({...base, ...fields}, {merge: true}).catch(() => {});
  };
  const raise = async (title, lines, severity = "error") =>
    Promise.resolve(alert({title, severity, lines})).catch(() => {});

  // ── Unconfigured: prod MISCONFIGURATION vs dev SKIP ──────────────────────
  if (!bucketName) {
    if (!production) {
      const result = {status: STORAGE_BACKUP_STATUS.SKIPPED_NON_PROD};
      await record(result);
      return result;
    }
    const result = {
      status: STORAGE_BACKUP_STATUS.MISCONFIGURED,
      errorCode: "STORAGE_BACKUP_BUCKET_UNSET",
    };
    await record(result);
    await raise(
        "Storage backup MISCONFIGURED — the Storage bucket has NO backup",
        [
          `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
          "STORAGE_BACKUP_BUCKET is not set on the production Functions " +
          "runtime, so nothing verifies a Storage mirror exists. Generated " +
          "images, uploads, exports and past papers may have NO backup — a " +
          "delete would be unrecoverable.",
          "Fix: enable Object Versioning on the primary bucket, create a " +
          "cross-region backup bucket + a Storage Transfer Service job, and " +
          "set STORAGE_BACKUP_BUCKET (functions/.env.<project>). See " +
          "docs/production-readiness/14-backup-and-disaster-recovery.md (DR-003).",
        ],
    );
    return result;
  }

  // ── Configured: probe the newest backed-up object ────────────────────────
  let probeResult;
  try {
    probeResult = await probe(bucketName, {prefix});
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 500);
    const result = {status: STORAGE_BACKUP_STATUS.ERROR, error: message};
    await record(result);
    await raise(
        "Storage backup check ERRORED — mirror health is UNKNOWN",
        [
          `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
          `Backup bucket: ${bucketName}${prefix ? ` (prefix ${prefix})` : ""}`,
          `Could not read the backup bucket: ${message}`,
          "Check the runtime SA can list the backup bucket (roles/storage." +
          "objectViewer) and that the bucket exists.",
        ],
    );
    return result;
  }

  const {status: freshness, ageMs} = classifyBackupFreshness({
    latestUpdatedMs: probeResult.latestUpdatedMs, nowMs, maxAgeMs,
  });
  const ageHours = ageMs == null ? null : Math.round((ageMs / (60 * 60 * 1000)) * 10) / 10;

  // A truncated scan can PROVE freshness (a recent object was actually seen)
  // but it can never prove the absence of one — the newest object may sort past
  // where the scan stopped. Reporting "stale"/"empty" from a partial view is
  // asserting something about objects nobody looked at, so an inconclusive scan
  // is reported as what it is: health UNKNOWN.
  const inconclusive = probeResult.truncated === true &&
    freshness !== STORAGE_BACKUP_STATUS.FRESH;
  const status = inconclusive ? STORAGE_BACKUP_STATUS.ERROR : freshness;

  const result = {
    status,
    ageHours,
    scanned: probeResult.scanned,
    truncated: probeResult.truncated === true,
    latestObjectAt: probeResult.latestUpdatedMs
      ? new Date(probeResult.latestUpdatedMs).toISOString()
      : null,
    ...(inconclusive
      ? {errorCode: "STORAGE_BACKUP_SCAN_TRUNCATED", freshnessSeen: freshness}
      : {}),
  };
  await record(result);

  if (inconclusive) {
    await raise(
        "Storage backup check INCONCLUSIVE — mirror health is UNKNOWN",
        [
          `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
          `Backup bucket: ${bucketName}${prefix ? ` (prefix ${prefix})` : ""}`,
          `The freshness scan stopped after ${probeResult.scanned} objects ` +
          "without reaching the end of the bucket, and saw no recent object in " +
          "that range. GCS lists by NAME, not by time, so this proves nothing " +
          "either way — the mirror may be healthy.",
          "Fix: set STORAGE_BACKUP_PREFIX to narrow the scan to a path the " +
          "mirror writes to, or raise the probe's page cap.",
        ],
        "warning",
    );
  } else if (status === STORAGE_BACKUP_STATUS.EMPTY) {
    await raise(
        "Storage backup EMPTY — the mirror has produced no objects",
        [
          `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
          `Backup bucket: ${bucketName}${prefix ? ` (prefix ${prefix})` : ""}`,
          "The backup destination is empty — the Storage Transfer Service job " +
          "has never run, is disabled, or points at the wrong bucket/prefix. " +
          "The Storage bucket effectively has no backup.",
        ],
    );
  } else if (status === STORAGE_BACKUP_STATUS.STALE) {
    await raise(
        "Storage backup STALE — the mirror has stopped running",
        [
          `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
          `Backup bucket: ${bucketName}${prefix ? ` (prefix ${prefix})` : ""}`,
          `Newest backed-up object is ~${ageHours}h old (threshold ` +
          `${base.maxAgeHours}h). The Storage Transfer Service job appears to ` +
          "have stopped — new uploads since then are not backed up.",
        ],
    );
  }
  return result;
}

// 04:00 Lusaka — a morning check, after the operator's overnight Storage
// Transfer Service mirror is expected to have finished. Scheduled functions
// stay in us-central1 per the repo region convention.
const storageBackupCheck = onSchedule({
  schedule: "every day 04:00",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
  secrets: opsAlertSecrets([emailSmtpUser, emailSmtpPassword]),
}, async () => {
  await runStorageBackupCheck();
});

module.exports = {
  storageBackupCheck,
  runStorageBackupCheck,
  probeLatestBackupObject,
  dateKeyUtc,
  STORAGE_BACKUP_STATUS,
};
