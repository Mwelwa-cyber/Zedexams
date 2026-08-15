"use strict";

/**
 * The Storage re-sweep — the cleanup that closes the surviving-ID-token window
 * left open by account deletion.
 *
 * ## The window
 *
 * `runAccountDeletion` revokes the refresh tokens and deletes the Auth user
 * before it touches any data (accountDeletionFlow.js). Neither call reaches an
 * ID token that has ALREADY been minted — they stop the session being renewed,
 * not the credential in a tab's memory from working. Firebase ID tokens live
 * 60 minutes. So for up to an hour after an account is destroyed, a tab still
 * holding one can upload, and what it uploads lands after the auth-delete
 * cascade (storageCleanup/onUserDeleted.js) already walked the bucket.
 *
 * ## Why this and not a rules gate
 *
 * #2258 tried the obvious thing — refuse the write in `storage.rules` — and it
 * failed twice over. Mechanically: the Storage rules engine can only ask
 * Firestore whether a deletion is in progress with a CROSS-SERVICE
 * `firestore.exists`, and wiring that into `isVerified()` put one on 100% of
 * rule evaluations. It stopped resolving, every arm collapsed, and uploads
 * were down across the product for five days (#2399 removed it).
 *
 * Structurally, and this is the half that would still be true if the
 * cross-service read had worked perfectly: a rules predicate can only refuse a
 * NEW write. It does nothing about the objects that already landed between the
 * purge enumerating the bucket and the gate taking effect — which is most of
 * the leak it was written to stop.
 *
 * Cleanup off the request path has neither problem. It costs nothing per
 * request, it cannot take uploads down when a dependency is slow, and it
 * covers the whole window from both ends: whatever the token wrote, whenever
 * it wrote it, is gone once this runs.
 *
 * ## Shape
 *
 * Every 15 minutes, adopt every tombstone whose `resweepAfter` has passed and
 * whose `resweepDone` is not yet true, re-enumerate that uid's Storage
 * prefixes through the SAME list the purge-time cascade uses
 * (`collectUserPrefixes` → `USER_KEYED_PREFIXES`), delete what is there, and
 * close the job. Idempotent by construction: it deletes what it finds, so a
 * duplicate run is a no-op and a lost close costs one wasted enumeration.
 *
 * It is deliberately a SEPARATE function from `accountPurgeSweep`, which
 * retries failed Firestore purges. That one queries `status == "pending"` and
 * runs daily; this one queries `resweepDone == false` and runs every 15
 * minutes, and the jobs it wants are overwhelmingly `done`. Folding them
 * together would mean running the heavy purge-and-cleanup retry 96× a day to
 * get the cheap one on time.
 *
 * Every dependency is injectable and `firebase-admin` / `opsAlert` are
 * required lazily INSIDE the run, so the module loads (and tests) under the
 * root install alone — the convention accountPurgeSweeper.js follows.
 */

const {
  PURGE_JOBS_COLLECTION,
  isResweepDue,
} = require("./accountPurgeJobs");

/** Most jobs handled per run. */
const MAX_JOBS_PER_RUN = 50;

/** Failed re-sweeps after which one job raises an ops alert. */
const ALERT_AFTER_RESWEEP_ATTEMPTS = 3;

/**
 * Pick the jobs this run should re-sweep. Pure, so the window is testable
 * without a clock or a Firestore.
 *
 * @param {Array<{id: string, data: object}>} jobs
 * @param {object} [opts]
 * @param {number} [opts.now]
 * @param {number} [opts.limit]
 * @return {Array<{id: string, data: object}>}
 */
function selectResweepJobs(jobs, {now = Date.now(), limit = MAX_JOBS_PER_RUN} = {}) {
  return jobs
    // isResweepDue carries the guard that matters: a job must have reached
    // PHASE_IRREVERSIBLE, i.e. its Auth user is genuinely gone. Without it this
    // sweep would delete the Storage of accounts whose deletion FAILED before
    // the point of no return and who are still signed in. See its comment.
    .filter((j) => isResweepDue(j.data, {now}))
    .slice(0, limit);
}

/**
 * Re-enumerate and clear every user-keyed prefix for one uid.
 *
 * Reuses `collectUserPrefixes` — the same list the purge-time cascade walks —
 * rather than restating the prefixes here. A second copy would drift, and it
 * would drift in the direction where this sweep silently stops covering a
 * prefix the product started writing to.
 *
 * @param {string} uid
 * @param {object} deps
 * @param {object} deps.bucket
 * @param {Function} deps.collectPrefixes
 * @param {Function} deps.deletePrefix
 * @return {Promise<number>} objects deleted across all prefixes.
 */
async function resweepUidStorage(uid, {bucket, collectPrefixes, deletePrefix}) {
  let deleted = 0;
  for (const prefix of collectPrefixes(uid)) {
    // No try/catch: a prefix that cannot be enumerated must fail the whole
    // job so it stays open and is retried. Swallowing it here would close the
    // job having checked eleven prefixes out of fifteen, and report success.
    deleted += await deletePrefix(bucket, prefix);
  }
  return deleted;
}

/**
 * Run the re-sweep.
 *
 * @param {object} [deps]
 * @param {object} [deps.db]                Admin Firestore.
 * @param {object} [deps.bucket]            Admin Storage bucket.
 * @param {object} [deps.FieldValue]        admin.firestore.FieldValue.
 * @param {Function} [deps.collectPrefixes] collectUserPrefixes.
 * @param {Function} [deps.deletePrefix]    deleteByPrefixCounted.
 * @param {Function} [deps.alert]           sendOpsAlert.
 * @param {number} [deps.now]
 * @return {Promise<{scanned:number, due:number, completed:number, failed:number,
 *   objectsDeleted:number, leaked:number, alerted:number}>}
 */
async function runAccountPurgeResweep(deps = {}) {
  const needsAdmin = !deps.db || !deps.bucket || !deps.FieldValue;
  const admin = needsAdmin ? require("firebase-admin") : null;
  const db = deps.db || admin.firestore();
  const bucket = deps.bucket || admin.storage().bucket();
  const FieldValue = deps.FieldValue || admin.firestore.FieldValue;
  const storageHelpers = deps.collectPrefixes && deps.deletePrefix ?
    null :
    require("../storageCleanup/helpers");
  const collectPrefixes = deps.collectPrefixes || storageHelpers.collectUserPrefixes;
  const deletePrefix = deps.deletePrefix || storageHelpers.deleteByPrefixCounted;
  const alert = deps.alert || require("../opsAlert").sendOpsAlert;
  const now = deps.now || Date.now();

  const {markResweepDone, recordResweepFailure} = require("./accountPurgeJobs");

  // Equality on ONE field, so this needs no composite index — the same
  // constraint accountPurgeSweeper.js works under, for the same reason (an
  // index has to be deployed before the code that queries against it).
  //
  // Queried on `resweepDone` rather than on `resweepAfter <= now` on purpose.
  // The `false` set is small and self-draining: a job enters it at deletion and
  // leaves it 75 minutes later, for ever. The range query's set only grows —
  // every account ever deleted matches it — so the oldest, long-closed jobs
  // would sort first and crowd out the ones that actually need sweeping.
  //
  // Tombstones written before this field existed match NEITHER query: a
  // missing field is not equal to false. That is correct rather than a gap —
  // those deletions are hours to months old and their token windows shut long
  // ago — but it does mean this sweep starts empty rather than with a backlog.
  const snap = await db
    .collection(PURGE_JOBS_COLLECTION)
    .where("resweepDone", "==", false)
    .limit(MAX_JOBS_PER_RUN * 4)
    .get();

  const pending = snap.docs.map((d) => ({id: d.id, data: d.data()}));
  const due = selectResweepJobs(pending, {now});

  const result = {
    scanned: pending.length,
    due: due.length,
    completed: 0,
    failed: 0,
    objectsDeleted: 0,
    // Jobs where the re-sweep actually found something. This is the number the
    // whole mechanism exists to learn: it is the count of deletions whose
    // surviving ID token was USED. Zero for ever means the window is theory;
    // anything else means it is not.
    leaked: 0,
    alerted: 0,
  };

  for (const job of due) {
    const uid = job.id;
    try {
      const deleted = await resweepUidStorage(uid, {bucket, collectPrefixes, deletePrefix});
      await markResweepDone(db, uid, {FieldValue, deleted});
      result.completed += 1;
      result.objectsDeleted += deleted;

      if (deleted > 0) {
        result.leaked += 1;
        // Not a failure — the cleanup worked exactly as designed. It is an
        // observation worth paging on once, because it is the first evidence
        // that a deleted account's token was used to write after deletion, and
        // that is worth a human deciding whether 75 minutes is still the right
        // window.
        try {
          await alert({
            title: "Storage written after account deletion (re-sweep cleared it)",
            severity: "info",
            lines: [
              `uid: ${uid}`,
              `objects removed: ${deleted}`,
              "These landed after the purge enumerated the bucket, from an ID " +
                "token that outlived its account. They are now deleted.",
              `Job: ${PURGE_JOBS_COLLECTION}/${uid}`,
            ],
          });
          result.alerted += 1;
        } catch (alertErr) {
          console.error("accountPurgeResweep: alert failed:", alertErr);
        }
      }
    } catch (error) {
      console.error(`accountPurgeResweep: uid=${uid} failed:`, error);
      await recordResweepFailure(db, uid, {FieldValue, error});
      result.failed += 1;

      // Attempts already recorded, plus the one that just failed — so the
      // alert fires on the run that reaches the threshold, not the run after.
      const attempts = Number(job.data.resweepAttempts || 0) + 1;
      if (attempts >= ALERT_AFTER_RESWEEP_ATTEMPTS) {
        try {
          await alert({
            title: "Account Storage re-sweep has not completed",
            severity: "critical",
            lines: [
              `uid: ${uid}`,
              `attempts: ${attempts}`,
              `last error: ${error.message || error}`,
              "Storage objects may survive from the deleted account's token window.",
              `Job: ${PURGE_JOBS_COLLECTION}/${uid}`,
            ],
          });
          result.alerted += 1;
        } catch (alertErr) {
          console.error("accountPurgeResweep: alert failed:", alertErr);
        }
      }
    }
  }

  console.log(`accountPurgeResweep ${JSON.stringify(result)}`);
  return result;
}

module.exports = {
  MAX_JOBS_PER_RUN,
  ALERT_AFTER_RESWEEP_ATTEMPTS,
  selectResweepJobs,
  resweepUidStorage,
  runAccountPurgeResweep,
};
