/**
 * Scheduled orphan reaper. Sweeps Storage daily and deletes blobs whose
 * parent Firestore doc no longer exists.
 *
 * Conservative by design — a false positive deletes real teacher
 * content. Two rules:
 *
 *   1. Deleted-user sweep
 *      For each user-keyed prefix (`lesson-files/`, `quiz-images/`, …)
 *      list the immediate child uids. Any uid that doesn't have a
 *      `users/{uid}` doc → wipe its subtree.
 *
 *   2. Orphaned lesson batches
 *      For `lesson-files/{uid}/{batch}/` and
 *      `lesson-presentations/{uid}/{batch}/`, batches not referenced by
 *      any `lessons/` doc with `createdBy === uid` are deleted, but
 *      only if every blob in the batch is older than `MIN_AGE_DAYS` so
 *      mid-upload drafts aren't reaped before their lesson doc lands.
 *
 * Other orphan classes (quiz-image / assessment-image / paper / invoice
 * with no parent doc) require building a reverse index across all
 * questions and are best handled by the on-demand `scripts/audit-storage.mjs`
 * script with --delete. The reaper deliberately doesn't touch them.
 *
 * Per-run caps (USER_LIMIT_PER_RUN, BATCH_LIMIT_PER_RUN) keep one
 * pathological run from blowing the function timeout or the audit log.
 *
 * Writes a summary doc to `storageOrphanReports/{YYYY-MM-DD}` so the
 * /admin surface can show what was reaped without scraping logs.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");

const {
  USER_KEYED_PREFIXES,
  deleteByPrefix,
  listChildDirs,
} = require("./helpers");

const MIN_AGE_DAYS = 7;
const USER_LIMIT_PER_RUN = 200;
const BATCH_LIMIT_PER_RUN = 500;

async function uidExists(db, uid) {
  if (!uid) return false;
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists;
}

async function sweepDeletedUsers(bucket, db, report) {
  for (const topPrefix of USER_KEYED_PREFIXES) {
    const uids = await listChildDirs(bucket, topPrefix, USER_LIMIT_PER_RUN);
    for (const uid of uids) {
      if (await uidExists(db, uid)) continue;
      const fullPrefix = `${topPrefix}${uid}/`;
      await deleteByPrefix(bucket, fullPrefix);
      report.deletedUserPrefixes.push(fullPrefix);
    }
  }
}

async function liveAssetBatchesForUid(db, uid) {
  const live = new Set();
  if (!uid) return live;
  const snap = await db.collection("lessons")
    .where("createdBy", "==", uid)
    .select("assetBatchId")
    .get();
  for (const doc of snap.docs) {
    const batch = doc.get("assetBatchId");
    if (batch) live.add(String(batch));
  }
  return live;
}

async function allBatchBlobsOlderThan(bucket, prefix, cutoffMs) {
  // Returns true iff every object under `prefix` has a creation time
  // strictly older than cutoffMs. An empty prefix is treated as "yes"
  // (nothing to protect).
  const [files] = await bucket.getFiles({prefix, maxResults: 1000});
  if (!files || files.length === 0) return true;
  for (const file of files) {
    const created = file.metadata && file.metadata.timeCreated;
    if (!created) return false;
    const ms = Date.parse(created);
    if (!Number.isFinite(ms)) return false;
    if (ms >= cutoffMs) return false;
  }
  return true;
}

async function sweepOrphanLessonBatches(bucket, db, report) {
  const cutoffMs = Date.now() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;

  for (const topPrefix of ["lesson-files/", "lesson-presentations/"]) {
    const uids = await listChildDirs(bucket, topPrefix, USER_LIMIT_PER_RUN);
    for (const uid of uids) {
      if (deleted >= BATCH_LIMIT_PER_RUN) return;
      // sweepDeletedUsers already wiped uids not in users/. Skip those
      // here so the two passes don't fight.
      if (!(await uidExists(db, uid))) continue;

      const live = await liveAssetBatchesForUid(db, uid);
      const batches = await listChildDirs(
        bucket, `${topPrefix}${uid}/`, BATCH_LIMIT_PER_RUN,
      );
      for (const batch of batches) {
        if (deleted >= BATCH_LIMIT_PER_RUN) return;
        if (live.has(batch)) continue;
        const fullPrefix = `${topPrefix}${uid}/${batch}/`;
        const safe = await allBatchBlobsOlderThan(bucket, fullPrefix, cutoffMs);
        if (!safe) continue;
        await deleteByPrefix(bucket, fullPrefix);
        report.deletedBatchPrefixes.push(fullPrefix);
        deleted += 1;
      }
    }
  }
}

const orphanStorageReaper = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "Africa/Lusaka",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const bucket = admin.storage().bucket();
    const db = admin.firestore();
    const startedAt = Date.now();
    const report = {
      deletedUserPrefixes: [],
      deletedBatchPrefixes: [],
      error: null,
    };

    try {
      await sweepDeletedUsers(bucket, db, report);
      await sweepOrphanLessonBatches(bucket, db, report);
    } catch (err) {
      report.error = (err && err.message) || String(err);
      console.error("[storageCleanup] orphanReaper failed", err);
    }

    const finishedAt = Date.now();
    const dateKey = new Date(startedAt).toISOString().slice(0, 10);
    try {
      await db.collection("storageOrphanReports").doc(dateKey).set({
        startedAt: admin.firestore.Timestamp.fromMillis(startedAt),
        finishedAt: admin.firestore.Timestamp.fromMillis(finishedAt),
        durationMs: finishedAt - startedAt,
        deletedUserPrefixCount: report.deletedUserPrefixes.length,
        deletedBatchPrefixCount: report.deletedBatchPrefixes.length,
        // Trim the arrays so a runaway sweep doesn't push the doc over
        // the 1 MiB Firestore limit. Counts above already capture the
        // full totals.
        deletedUserPrefixes: report.deletedUserPrefixes.slice(0, 200),
        deletedBatchPrefixes: report.deletedBatchPrefixes.slice(0, 200),
        error: report.error,
      }, {merge: true});
    } catch (err) {
      console.warn("[storageCleanup] orphanReaper report write failed",
        (err && err.message) || err);
    }
  },
);

module.exports = {
  orphanStorageReaper,
  // exported for tests
  liveAssetBatchesForUid,
  allBatchBlobsOlderThan,
};
