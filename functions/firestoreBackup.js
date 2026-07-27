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
 *      roles/datastore.importExportAdmin on the project. The export's WRITE to
 *      the bucket is performed by the Firestore service agent, which is granted
 *      bucket access automatically when managed export/import is used — so a
 *      broad roles/storage.objectAdmin grant on the runtime SA is usually NOT
 *      required. Add roles/storage.objectAdmin on the bucket ONLY if a write is
 *      actually denied (a 'destination'/permission failure in the alert).
 *   3. Set FIRESTORE_BACKUP_BUCKET (bucket name or gs:// uri) on the runtime
 *      (functions/.env.<project>). Until it's set the cron records status
 *      "misconfigured" (prod) / "skipped-non-production" (dev) — deploying first
 *      is safe.
 *   4. Consider enabling point-in-time recovery on the database as well
 *      (`gcloud firestore databases update --enable-pitr`) — PITR covers
 *      fat-finger deletes within 7 days; the export covers everything else.
 *
 * The exportDocuments call returns as soon as the operation is accepted — the
 * export itself continues server-side, so the daily run records "started"
 * (acceptance) and a separate completion checker (backupCompletionCheck, ~2h
 * later) flips the summary to "completed" once the long-running op finishes.
 *
 * Same-UTC-date collision hardening (DR-007): a manual export and the scheduled
 * export can share a UTC date-key. Each run writes its OWN immutable record at
 * opsBackupRuns/{correlationId}; a transactional LEASE lets only one run own a
 * date (a second run is "duplicate-skipped", never "failed"); and the daily
 * summary at opsBackups/{date} is owner-guarded + monotonic so a duplicate can
 * never downgrade a good "started"/"completed" to "failed".
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
  decideBackupOwnership,
  shouldWriteDailyStatus,
  decideCompletion,
} = require("./firestoreBackupCore");
const {sendOpsAlert} = require("./opsAlert");
const {opsAlertSecrets} = require("./opsAlertSecrets");

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
  IN_PROGRESS: "in_progress", // date claimed, export not yet accepted
  STARTED: "started", // export operation accepted (completion is async)
  COMPLETED: "completed", // operation finished OK (set by the completion check)
  DUPLICATE_SKIPPED: "duplicate-skipped", // date already had a valid export
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

  // IMMUTABLE per-execution record — one doc per run, keyed by correlationId,
  // so a duplicate run on the same UTC date writes its OWN record instead of
  // clobbering another run's. This is the tamper-evident audit trail.
  const runsRef = db.collection("opsBackupRuns").doc(correlationId);
  const recordRun = async (fields) => {
    const completeTime = new Date().toISOString();
    logBackupEvent({...base, ...fields, completeTime});
    await runsRef.set({...base, ...fields, completeTime}).catch(() => {});
  };

  // Owner-guarded write of the DAILY SUMMARY. Two distinct protections, NOT
  // conflated (the earlier WIP conflated them and would have blocked an owner
  // from recording its OWN acceptance failure, because 'failed' ranks below the
  // transient 'in_progress' claim):
  //   • requireOwner — a run that does NOT own this date's lease must never
  //     touch the summary. The OWNER, however, is authoritative for its own run
  //     lifecycle: in_progress → started (upgrade) OR in_progress → failed
  //     (a real acceptance failure) both land. This is safe because a duplicate
  //     run is already routed to duplicate-skip by the ownership lease and never
  //     reaches here as the owner.
  //   • monotonic (non-owner writes only) — protects a good summary from being
  //     downgraded by a run with no ownership context (misconfigured / skip).
  //     `force` lets the authoritative completion checker override it.
  const writeDaily = async (fields, {requireOwner = false, force = false} = {}) => {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(statusRef);
      const existing = snap.exists ? snap.data() : null;
      if (requireOwner) {
        // A different run owns the lease → never clobber its summary.
        if (existing && existing.owner && existing.owner !== correlationId) return;
        // Owner (or first claim): authoritative for its own lifecycle.
      } else if (existing &&
          !shouldWriteDailyStatus(existing.status, fields.status, {force})) {
        return;
      }
      tx.set(statusRef,
          {...base, ...fields, ranAt: startTime, completeTime: new Date().toISOString()},
          {merge: true});
    }).catch(() => {});
  };

  // ── Unconfigured: distinguish a real MISCONFIGURATION from a dev SKIP ─────
  if (!bucketUri) {
    if (!production) {
      const result = {status: BACKUP_STATUS.SKIPPED_NON_PROD};
      await recordRun(result);
      await writeDaily(result);
      return result;
    }
    const result = {
      status: BACKUP_STATUS.MISCONFIGURED,
      errorCategory: "config",
      errorCode: "FIRESTORE_BACKUP_BUCKET_UNSET",
    };
    await recordRun(result);
    await writeDaily(result);
    await Promise.resolve(alert({
      title: "Firestore backup MISCONFIGURED — no backups are running",
      severity: "error",
      lines: [
        `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
        "FIRESTORE_BACKUP_BUCKET is not set (or invalid) on the production " +
        "Functions runtime, so the daily export is NOT running. The database " +
        "currently has NO disaster-recovery export.",
        "Fix: create a cross-region GCS bucket and set FIRESTORE_BACKUP_BUCKET " +
        "(functions/.env.<project>). The runtime SA needs " +
        "roles/datastore.importExportAdmin; it can usually already WRITE to the " +
        "bucket via the Firestore service agent (roles/firestore.serviceAgent), " +
        "so grant roles/storage.objectAdmin on the bucket ONLY if it cannot. " +
        "See docs/production-readiness/runbooks/firestore-restore.md.",
      ],
    })).catch(() => {});
    return result;
  }

  // ── Configured: claim the date (lease), then export ──────────────────────
  // Only ONE run may own a given UTC date. If the date already carries a valid
  // (started/completed) export, this run is a no-op DUPLICATE-SKIP — NOT a
  // failure — so the scheduled run after a manual export doesn't turn a good
  // summary red.
  let ownership;
  try {
    ownership = await db.runTransaction(async (tx) => {
      const snap = await tx.get(statusRef);
      const existing = snap.exists ? snap.data() : null;
      const decision = decideBackupOwnership(existing);
      if (decision.action === "claim") {
        tx.set(statusRef, {
          ...base, status: BACKUP_STATUS.IN_PROGRESS,
          owner: correlationId, claimedAt: startTime, ranAt: startTime,
        }, {merge: true});
      }
      return decision;
    });
  } catch (err) {
    // Lease transaction failed — fail-open and attempt the backup anyway (a
    // missed backup is worse than a rare double-export into a dated folder).
    ownership = {action: "claim"};
  }

  if (ownership.action === "duplicate-skip") {
    const result = {
      status: BACKUP_STATUS.DUPLICATE_SKIPPED,
      reason: ownership.reason || "date already exported",
    };
    await recordRun(result); // own immutable record; daily summary untouched
    return result;
  }

  try {
    const request = buildExportRequest({projectId, bucketUri, dateKey});
    const client = adminClient ||
      new (require("@google-cloud/firestore").v1.FirestoreAdminClient)();
    const [operation] = await client.exportDocuments(request);
    const result = {
      status: BACKUP_STATUS.STARTED,
      operationName: (operation && operation.name) || null,
      exportPath: request.outputUriPrefix,
      completed: false, // acceptance ≠ completion; the checker stamps completed
    };
    await recordRun(result);
    await writeDaily({...result, owner: correlationId}, {requireOwner: true});
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
    await recordRun(result);
    // Owner-guarded + monotonic: a failure only lands if it doesn't clobber a
    // started/completed summary written by another (owning) run.
    await writeDaily(result, {requireOwner: true});
    await Promise.resolve(alert({
      title: "Firestore backup export FAILED",
      severity: "error",
      lines: [
        `Date: ${dateKey}  ·  correlationId: ${correlationId}`,
        `Category: ${category}  ·  Code: ${code}`,
        `Error: ${message}`,
        `Destination: ${bucketUri}/firestore-exports/${dateKey}`,
        "Check the runtime SA has roles/datastore.importExportAdmin and can " +
        "write to the bucket (usually already granted via the Firestore " +
        "service agent; add roles/storage.objectAdmin on the bucket only if " +
        "not) and that the bucket exists. See " +
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
  secrets: opsAlertSecrets([emailSmtpUser, emailSmtpPassword]),
};

const dailyFirestoreBackup = onSchedule(BACKUP_OPTS, async () => {
  await runFirestoreExport();
});

/**
 * ASYNCHRONOUS COMPLETION CHECKER. exportDocuments is a long-running operation,
 * so the daily run only records "started" (acceptance). This reads back the
 * recent "started" summaries and, via the injected getOperation, stamps
 * `completed: true` (status "completed") when the operation is done — or records
 * a real failure (force, so it overrides the monotonic guard: the operation is
 * authoritative about its own outcome). Idempotent: a completed/failed summary
 * is skipped. All I/O injected so it unit-tests without firebase or the LRO API.
 *
 * @param {object} deps
 * @param {FirebaseFirestore.Firestore} deps.db
 * @param {(operationName: string) => Promise<object>} deps.getOperation
 * @param {string[]} deps.dateKeys — UTC dates to check (e.g. today + yesterday)
 * @param {Function} [deps.alert]
 */
async function runBackupCompletionCheck({db, getOperation, dateKeys, alert = sendOpsAlert}) {
  const out = {checked: 0, completed: 0, failed: 0, pending: 0};
  for (const dateKey of (dateKeys || [])) {
    const ref = db.collection("opsBackups").doc(dateKey);
    let existing;
    try {
      const snap = await ref.get();
      existing = snap.exists ? snap.data() : null;
    } catch (_e) { continue; }
    // Only chase a summary that is "started" with an operation and not settled.
    if (!existing || existing.status !== BACKUP_STATUS.STARTED ||
        existing.completed === true || !existing.operationName) continue;
    out.checked += 1;
    let operation;
    try {
      operation = await getOperation(existing.operationName);
    } catch (_e) { out.pending += 1; continue; }
    const verdict = decideCompletion(operation);
    if (verdict.state === "pending") { out.pending += 1; continue; }
    const nowIso = new Date().toISOString();
    if (verdict.state === "completed") {
      out.completed += 1;
      logBackupEvent({event: "backup-completed", dateKey, operationName: existing.operationName});
      await ref.set({status: BACKUP_STATUS.COMPLETED, completed: true, completedAt: nowIso}, {merge: true}).catch(() => {});
    } else {
      out.failed += 1;
      logBackupEvent({event: "backup-operation-failed", dateKey, operationName: existing.operationName, error: verdict.error});
      // Authoritative: the operation genuinely failed after acceptance.
      await ref.set({status: BACKUP_STATUS.FAILED, completed: false, completionError: verdict.error, completedAt: nowIso}, {merge: true}).catch(() => {});
      await Promise.resolve(alert({
        title: "Firestore backup export operation FAILED (post-acceptance)",
        severity: "error",
        lines: [`Date: ${dateKey}`, `Operation: ${existing.operationName}`, `Error: ${verdict.error}`],
      })).catch(() => {});
    }
  }
  return out;
}

// Two recent UTC date-keys (today + yesterday) — a 01:30 Africa/Lusaka run
// stamps the PREVIOUS UTC day, so the checker (03:30 Lusaka) must look back one.
function recentUtcDateKeys(now = new Date()) {
  const today = dateKeyUtc(now);
  const yesterday = dateKeyUtc(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return [today, yesterday];
}

// Poll the real Firestore Admin LRO for an export operation.
async function getExportOperation(operationName) {
  const {v1} = require("@google-cloud/firestore");
  const client = new v1.FirestoreAdminClient();
  const [operation] = await client.operationsClient.getOperation({name: operationName});
  return operation;
}

// 03:30 Lusaka — ~2h after the 01:30 export, enough for a normal export to
// finish, so the summary flips started → completed unattended.
const backupCompletionCheck = onSchedule({
  schedule: "every day 03:30",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
  secrets: opsAlertSecrets([emailSmtpUser, emailSmtpPassword]),
}, async () => {
  await runBackupCompletionCheck({
    db: admin.firestore(),
    getOperation: getExportOperation,
    dateKeys: recentUtcDateKeys(),
  });
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
  runBackupCompletionCheck,
  recentUtcDateKeys,
  getExportOperation,
  backupCompletionCheck,
  dateKeyUtc,
  BACKUP_STATUS,
};
