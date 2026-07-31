/**
 * Firebase Storage backup HEALTH CHECK — the Storage half of the DR floor
 * (DR-003). The Firestore export (firestoreBackup.js) backs up Firestore only;
 * generated images, uploads, exports and past papers live in the Storage
 * bucket with NO backup, and a delete is unrecoverable.
 *
 * Architecture: the cross-region COPY is a Storage Transfer Service (STS) job
 * the operator provisions once (a Cloud Function copying the whole bucket daily
 * would be the wrong tool — cost/timeouts/scale). This module is the piece that
 * makes that mirror TRUSTWORTHY, recording the outcome in
 * opsStorageBackups/{date} and alerting ops when the mirror is misconfigured,
 * empty, or stale. Same shape as the Firestore backup runner: injectable I/O,
 * never throws, one structured log + one status doc.
 *
 * TWO CRONS, AND THE ORDER IS THE DESIGN:
 *
 *   storageBackupHeartbeat  23:30 UTC  overwrite _ops/…heartbeat.json (primary)
 *   [STS transfer job]      00:30 UTC  mirror primary → backup
 *   storageBackupCheck      02:00 UTC  read the heartbeat in the BACKUP
 *                                      (= 04:00 Africa/Lusaka)
 *
 * The check used to ask "is the newest object in the backup recent?" and treat
 * that as "did the mirror run?". It isn't. The transfer runs with
 * `--overwrite-when=different`, so a night where nothing in the source changed
 * copies nothing — correctly — and the newest destination object just keeps
 * ageing until the check pages `stale` about a mirror that is provably fine.
 * This project's source bucket routinely goes 16–17 quiet hours and was
 * observed past the 26h default on day one. The failure is also asymmetric:
 * right after provisioning everything has just been copied, so the first check
 * reads `fresh` and hands the operator a false all-clear before the lying
 * `stale` shows up a day or two later.
 *
 * So the heartbeat is written first and read last: one small object, one fixed
 * path, overwritten nightly. An overwrite is a change, so the mirror MUST carry
 * it, and its mtime in the backup is proof the transfer ran end to end rather
 * than a job's report about itself. See storageBackupHeartbeatCore.js.
 *
 * One-time setup — `npm run provision:storage-backup` (see the script; it also
 * enables versioning, the lifecycle rules and every IAM binding). Afterwards set
 * STORAGE_BACKUP_BUCKET (bucket name or gs:// uri) on the runtime
 * (functions/.env.<project>), optionally STORAGE_BACKUP_MAX_AGE_HOURS. Until
 * it's set the checker records "misconfigured" (prod, alerts) /
 * "skipped-non-production" (dev) — deploying first is safe.
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
  resolveMaxAgeMs,
  DEFAULT_MAX_LAG_HOURS,
} = require("./storageBackupCore");
const {
  HEARTBEAT_PATH,
  STORAGE_HEARTBEAT_STATUS,
  classifyHeartbeat,
  buildHeartbeatBody,
} = require("./storageBackupHeartbeatCore");
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
  AWAITING: "awaiting-heartbeat", // our writer hasn't run yet (warns, never pages)
  WRITER_STOPPED: "heartbeat-writer-stopped", // our writer stopped, mirror is fine
  EMPTY: "empty", // heartbeat never reached the backup (alerts)
  STALE: "stale", // heartbeat in the backup older than the threshold (alerts)
  FRESH: "fresh", // the mirror carried a recent heartbeat across
  ERROR: "error", // the lookup itself failed (alerts)
});

function logStorageBackupEvent(fields) {
  try {
    console.log("[storageBackup]", JSON.stringify(fields));
  } catch (_e) {
    console.log("[storageBackup]", fields && fields.status);
  }
}

/**
 * Overwrite the heartbeat object in the PRIMARY bucket. Overwriting a fixed
 * path is the point: it guarantees the nightly transfer has a changed object to
 * carry, so a quiet night can no longer look like a stopped mirror.
 *
 * @returns {Promise<{path: string, writtenAtMs: number}>}
 */
async function writeStorageBackupHeartbeat({
  bucketName = undefined, now = new Date(), correlationId = crypto.randomUUID(),
} = {}) {
  const bucket = admin.storage().bucket(bucketName);
  await bucket.file(HEARTBEAT_PATH).save(buildHeartbeatBody(now, correlationId), {
    contentType: "application/json",
    resumable: false,
    // Never cached: a CDN-cached heartbeat would report a time that is not the
    // time the object was actually written.
    metadata: {cacheControl: "no-store"},
  });
  return {path: HEARTBEAT_PATH, writtenAtMs: now.getTime()};
}

/**
 * Read the heartbeat's mtime from one bucket. Returns null when the object is
 * absent — an expected state (new deploy, mirror not yet run), not an error.
 * A read FAILURE still throws, because "could not look" must never be reported
 * as "not there".
 *
 * @returns {Promise<number|null>}
 */
async function probeHeartbeat(bucketName) {
  const file = admin.storage().bucket(bucketName).file(HEARTBEAT_PATH);
  try {
    const [metadata] = await file.getMetadata();
    const updated = metadata && (metadata.updated || metadata.timeCreated);
    const ms = updated ? Date.parse(updated) : NaN;
    return Number.isFinite(ms) ? ms : null;
  } catch (err) {
    if (err && (err.code === 404 || err.status === 404)) return null;
    throw err;
  }
}

/**
 * One Storage-backup health check. All I/O injectable so the plain-node test
 * drives every path (misconfigured / skip / empty / stale / fresh / error)
 * without firebase or GCS. Never throws.
 *
 * @param {object} [deps]
 * @param {FirebaseFirestore.Firestore} [deps.db]
 * @param {(bucketName: string) => Promise<number|null>} [deps.heartbeat] mtime probe
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {Function} [deps.alert]
 * @param {Date} [deps.now]
 * @returns {Promise<{status: string, ageHours?: number|null}>}
 */
async function runStorageBackupCheck({
  db = admin.firestore(),
  heartbeat = probeHeartbeat,
  env = process.env,
  alert = sendOpsAlert,
  now = new Date(),
  correlationId = crypto.randomUUID(),
} = {}) {
  const dateKey = dateKeyUtc(now);
  const nowMs = now.getTime();
  const production = isProductionRuntime(env);
  const bucketName = resolveStorageBackupBucket(env.STORAGE_BACKUP_BUCKET);
  const maxAgeMs = resolveMaxAgeMs(env.STORAGE_BACKUP_MAX_AGE_HOURS);

  const base = {
    correlationId, dateKey, production,
    backupBucket: bucketName || null,
    maxAgeHours: Math.round(maxAgeMs / (60 * 60 * 1000)),
    // Recorded alongside, because a verdict reached by the lag test is
    // unreadable without the constant it was compared against.
    maxLagHours: DEFAULT_MAX_LAG_HOURS,
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

  // ── Configured: read the heartbeat on BOTH sides ─────────────────────────
  // Both, not just the backup, because "our writer never ran" and "the mirror
  // is broken" have different fixes and must not collapse into one alert.
  let primaryUpdatedMs;
  let backupUpdatedMs;
  try {
    [primaryUpdatedMs, backupUpdatedMs] = await Promise.all([
      heartbeat(undefined), // undefined → the default (primary) bucket
      heartbeat(bucketName),
    ]);
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 500);
    const result = {status: STORAGE_BACKUP_STATUS.ERROR, error: message};
    await record(result);
    await raise(
        "Storage backup check ERRORED — mirror health is UNKNOWN",
        [
          `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
          `Backup bucket: ${bucketName}`,
          `Could not read ${HEARTBEAT_PATH}: ${message}`,
          "Check the runtime SA can read the backup bucket (roles/storage." +
          "objectViewer) and that the bucket exists.",
        ],
    );
    return result;
  }

  const {status, ageMs, lagMs} = classifyHeartbeat({
    primaryUpdatedMs, backupUpdatedMs, nowMs, maxAgeMs,
  });
  const hours = (ms) => (ms == null ? null : Math.round((ms / (60 * 60 * 1000)) * 10) / 10);
  const ageHours = hours(ageMs);

  const result = {
    status,
    ageHours,
    // How far the mirror trails the source. Reported on every verdict, because
    // a lag climbing towards the threshold is the warning that precedes a real
    // `stale` — and the number that tells them apart afterwards.
    mirrorLagHours: hours(lagMs),
    heartbeatPath: HEARTBEAT_PATH,
    heartbeatWrittenAt: primaryUpdatedMs ? new Date(primaryUpdatedMs).toISOString() : null,
    heartbeatMirroredAt: backupUpdatedMs ? new Date(backupUpdatedMs).toISOString() : null,
  };
  await record(result);

  if (status === STORAGE_HEARTBEAT_STATUS.AWAITING) {
    // Deliberately a WARNING. A freshly-deployed system looks exactly like
    // this, and paging on the expected state of a first night is how an alert
    // channel earns the mute it later gets when something is really wrong.
    await raise(
        "Storage backup heartbeat NOT YET WRITTEN — mirror health unverified",
        [
          `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
          `No ${HEARTBEAT_PATH} in the primary bucket, so there is nothing for ` +
          "the mirror to carry and nothing to verify against. This is the " +
          "expected state for the first night after deploy.",
          "If it persists: storageBackupHeartbeat (23:30 UTC) is not running, " +
          "or cannot write to the primary bucket.",
        ],
        "warning",
    );
  } else if (status === STORAGE_HEARTBEAT_STATUS.WRITER_STOPPED) {
    // The mirror is caught up; it is our own cron that stopped. Naming the
    // right system matters more than the severity here — the previous version
    // reported this as `stale` and sent the reader to a transfer job that was
    // working perfectly.
    await raise(
        "Storage backup heartbeat STOPPED — the mirror is fine, our cron isn't",
        [
          `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
          `${HEARTBEAT_PATH} in the PRIMARY bucket is ~${ageHours}h old and the ` +
          "backup's copy is level with it, so the transfer is still running — " +
          "it is storageBackupHeartbeat (23:30 UTC) that has stopped writing.",
          "Until it resumes, nothing new is being proved about the mirror even " +
          "though the mirror itself looks healthy. Check that function's logs " +
          "and that its Cloud Scheduler job exists and is ENABLED.",
        ],
    );
  } else if (status === STORAGE_HEARTBEAT_STATUS.MISSING_AT_BACKUP) {
    await raise(
        "Storage backup EMPTY — the mirror has never copied the heartbeat",
        [
          `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
          `Backup bucket: ${bucketName}`,
          `${HEARTBEAT_PATH} exists in the primary bucket but has never ` +
          "appeared in the backup. The Storage Transfer Service job has never " +
          "run, is disabled, points at the wrong bucket, or excludes the " +
          "_ops/ prefix. The Storage bucket effectively has no backup.",
        ],
    );
  } else if (status === STORAGE_HEARTBEAT_STATUS.STALE) {
    await raise(
        "Storage backup STALE — the mirror has stopped running",
        [
          `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
          `Backup bucket: ${bucketName}`,
          `The heartbeat is rewritten nightly, so the mirror always has a ` +
          `changed object to copy. Its copy in the backup is ~${ageHours}h old ` +
          `(threshold ${base.maxAgeHours}h), which means the transfer itself ` +
          "has stopped — this is not a quiet night. Uploads since then are " +
          "not backed up.",
          "Check the transfer job's last operation: " +
          "`gcloud transfer operations list --job-names=transferJobs/" +
          "zedexams-storage-mirror`.",
        ],
    );
  }
  return result;
}

// 23:30 UTC (01:30 Lusaka) — an hour before the 00:30 UTC transfer, so the
// mirror always has a freshly-changed object to carry. Ordering is the whole
// design: write → transfer → check. Moving either schedule without the other
// breaks the chain, which is why both times are named in the comment on each.
const storageBackupHeartbeat = onSchedule({
  schedule: "30 23 * * *",
  timeZone: "Etc/UTC",
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, async () => {
  try {
    const {path, writtenAtMs} = await writeStorageBackupHeartbeat();
    logStorageBackupEvent({
      status: "heartbeat-written", path, writtenAt: new Date(writtenAtMs).toISOString(),
    });
  } catch (err) {
    // Never throw: a failed heartbeat must not retry-storm. The check reports
    // it the next morning as `awaiting-heartbeat`, which is the honest verdict
    // — nothing is known about the mirror, rather than something is wrong.
    logStorageBackupEvent({
      status: "heartbeat-failed", error: String((err && err.message) || err).slice(0, 500),
    });
  }
});

// 04:00 Lusaka (02:00 UTC) — after the 00:30 UTC transfer is expected to have
// finished. Scheduled functions stay in us-central1 per the repo region
// convention.
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
  storageBackupHeartbeat,
  runStorageBackupCheck,
  writeStorageBackupHeartbeat,
  probeHeartbeat,
  dateKeyUtc,
  STORAGE_BACKUP_STATUS,
};
