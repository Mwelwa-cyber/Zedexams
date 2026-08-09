"use strict";

/**
 * Daily sweep over `accountPurgeJobs` — the recovery half of the new deletion
 * order (accountDeletionFlow.js).
 *
 * Deleting the Auth user before the Firestore purge means a purge that dies
 * half-way leaves data nobody can retry: the account it belonged to no longer
 * exists, so there is no session to run `deleteMyAccount` from again. This
 * cron is the retry. It adopts every tombstone still `pending` after the
 * staleness window, re-runs the purge (idempotent by construction — it deletes
 * what it finds), and closes the job only when the purge VERIFIES that
 * `users/{uid}` is gone.
 *
 * It also re-runs `deleteUser` first. A job can be pending because the handler
 * died between the tombstone and the Auth deletion, in which case the sign-in
 * is still live and must go before the data does — same order, same reason.
 *
 * Alerting is on repetition, not on a single failure: a job that has failed
 * ALERT_AFTER_ATTEMPTS times is not a transient Firestore hiccup, it is data
 * we have promised to delete and have not.
 *
 * Every dependency is injectable and `firebase-admin` / `opsAlert` are
 * required lazily INSIDE the run, so the module loads (and tests) under the
 * root install alone.
 */

const {
  PURGE_JOBS_COLLECTION,
  STALE_AFTER_MS,
  ALERT_AFTER_ATTEMPTS,
  isStalePurgeJob,
  isAdoptable,
} = require("./accountPurgeJobs");

/** Most jobs handled per run. A backlog past this is an ops problem, not a cron one. */
const MAX_JOBS_PER_RUN = 50;

/**
 * Pick the jobs this run should adopt. Pure — staleness is filtered in memory
 * rather than in the query so the sweep needs no composite index.
 *
 * @param {Array<{id: string, data: object}>} jobs
 * @param {object} [opts]
 * @param {number} [opts.now]
 * @param {number} [opts.staleAfterMs]
 * @param {number} [opts.limit]
 * @return {Array<{id: string, data: object}>}
 */
function selectStaleJobs(jobs, {now = Date.now(), staleAfterMs = STALE_AFTER_MS, limit = MAX_JOBS_PER_RUN} = {}) {
  return jobs
    // The phase gate, and it is load-bearing rather than tidy. A job without it
    // never passed `deleteUser`, so adopting it would delete an account whose
    // deletion never started — including on the crash paths (timeout, OOM,
    // eviction) where no `catch` ran to cancel anything. See PHASE_IRREVERSIBLE.
    //
    // Filtered here rather than added to the Firestore query on purpose: a
    // second equality makes it a composite query needing an index deployed
    // before the code that uses it, and the collection holds one document per
    // deleted account. Revisit if the pending backlog ever approaches the
    // over-fetch limit — at that point unadoptable jobs could crowd out real
    // ones, and the index becomes worth its deploy ordering.
    .filter((j) => isAdoptable({status: "pending", ...j.data}))
    .filter((j) => isStalePurgeJob(j.data, {now, staleAfterMs}))
    .slice(0, limit);
}

/**
 * Run the sweep.
 *
 * @param {object} [deps]
 * @param {object} [deps.db]            Admin Firestore.
 * @param {object} [deps.auth]          Admin Auth.
 * @param {object} [deps.FieldValue]    admin.firestore.FieldValue.
 * @param {Function} [deps.purge]       purgeUserData.
 * @param {Function} [deps.alert]       sendOpsAlert.
 * @param {number} [deps.now]
 * @param {number} [deps.staleAfterMs]
 * @return {Promise<{scanned:number, swept:number, completed:number, failed:number, alerted:number}>}
 */
async function runAccountPurgeSweep(deps = {}) {
  const admin = deps.db && deps.auth && deps.FieldValue ? null : require("firebase-admin");
  const db = deps.db || admin.firestore();
  const auth = deps.auth || admin.auth();
  const FieldValue = deps.FieldValue || admin.firestore.FieldValue;
  const purge = deps.purge || require("../accountDeletion").purgeUserData;
  const alert = deps.alert || require("../opsAlert").sendOpsAlert;
  const now = deps.now || Date.now();
  const staleAfterMs = deps.staleAfterMs || STALE_AFTER_MS;

  const {
    completePurgeJob,
    recordPurgeFailure,
    isPurgeComplete,
  } = require("./accountPurgeJobs");

  const snap = await db
    .collection(PURGE_JOBS_COLLECTION)
    .where("status", "==", "pending")
    .limit(MAX_JOBS_PER_RUN * 4)
    .get();

  const pending = snap.docs.map((d) => ({id: d.id, data: d.data()}));
  const due = selectStaleJobs(pending, {now, staleAfterMs});

  const result = {
    scanned: pending.length,
    swept: due.length,
    completed: 0,
    failed: 0,
    alerted: 0,
  };

  for (const job of due) {
    const uid = job.id;
    // Attempts already recorded, plus the one about to happen — so the alert
    // fires on the run that reaches the threshold, not the run after it.
    const attempts = Number(job.data.attempts || 0) + 1;
    let failure = null;

    try {
      // Same order as the handler: sign-in first, data second.
      try {
        await auth.deleteUser(uid);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") throw error;
      }
      const summary = await purge(db, uid, {FieldValue});
      // isPurgeComplete, not `verified` alone: the recovery path closing a job
      // whose purge reported collection-level errors strands that data exactly
      // as the handler's version did, and there is no third actor to catch it.
      if (isPurgeComplete(summary)) {
        await completePurgeJob(db, uid, {FieldValue, summary});
        result.completed += 1;
      } else {
        failure = new Error(
          `purge incomplete (summary=${JSON.stringify(summary)})`,
        );
      }
    } catch (error) {
      failure = error;
    }

    if (failure) {
      console.error(`accountPurgeSweep: uid=${uid} attempt ${attempts} failed:`, failure);
      await recordPurgeFailure(db, uid, {FieldValue, error: failure});
      result.failed += 1;

      if (attempts >= ALERT_AFTER_ATTEMPTS) {
        try {
          await alert({
            title: "Account deletion has not completed",
            severity: "critical",
            lines: [
              `uid: ${uid}`,
              `attempts: ${attempts}`,
              `last error: ${failure.message || failure}`,
              "The Firebase Auth user is gone but Firestore data remains.",
              `Job: ${PURGE_JOBS_COLLECTION}/${uid}`,
            ],
          });
          result.alerted += 1;
        } catch (alertErr) {
          console.error("accountPurgeSweep: alert failed:", alertErr);
        }
      }
    }
  }

  console.log(`accountPurgeSweep ${JSON.stringify(result)}`);
  return result;
}

module.exports = {
  MAX_JOBS_PER_RUN,
  selectStaleJobs,
  runAccountPurgeSweep,
};
