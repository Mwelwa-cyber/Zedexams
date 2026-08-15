"use strict";

/**
 * Account-purge tombstones — `accountPurgeJobs/{uid}`.
 *
 * `deleteMyAccount` now destroys the Firebase Auth user BEFORE it walks
 * Firestore (see accountDeletionFlow.js for why). That inverts the failure
 * mode: a purge that dies half-way used to leave an intact, retryable account,
 * and now leaves ownerless data behind a sign-in that no longer exists. Nobody
 * can retry it, because there is no longer anybody to retry it as.
 *
 * A tombstone is what makes that recoverable. It is written BEFORE the Auth
 * user is deleted, so the record of "this uid is being purged" exists even if
 * the process dies at the very next line, and it is the sweeper's work queue
 * (accountPurgeSweeper.js). It also stops the profile-repair path from
 * rebuilding a profile for a uid that is mid-deletion — an existing tombstone
 * is a refusal in `bootstrapUserProfile`.
 *
 * Two rules about its contents:
 *   • It outlives the account, so it holds NO PII. The address is stored as a
 *     SHA-256 of the lowercased email — enough for support to answer "did this
 *     person's deletion finish?" from an address they already have, and not a
 *     copy of the address we were asked to delete.
 *   • Server-only in firestore.rules (read+write denied to every client). A
 *     client that could delete its own tombstone could resurrect its profile.
 *
 * No firebase-admin / firebase-functions imports: `db` and `FieldValue` are
 * injected, so the whole module unit-tests under plain `node` with the root
 * install only (repo convention — see accountDeletionRequests.test.js).
 */

const crypto = require("node:crypto");

const PURGE_JOBS_COLLECTION = "accountPurgeJobs";

/** How long a job may sit `pending` before the sweeper adopts it. */
const STALE_AFTER_MS = 15 * 60 * 1000;

/** Failed attempts after which the sweeper raises an ops alert. */
const ALERT_AFTER_ATTEMPTS = 3;

/**
 * How long after the deletion starts the Storage re-sweep becomes due.
 *
 * A Firebase ID token lives 60 minutes and is not invalidated by
 * `revokeRefreshTokens` or by `deleteUser` — both stop the session being
 * RENEWED, neither reaches a token already minted. So for up to an hour after
 * an account is destroyed, a tab still holding one can write to Storage, and
 * anything it writes lands after the auth-delete cascade
 * (storageCleanup/onUserDeleted.js) already enumerated the bucket.
 *
 * 60 minutes for the token, plus 15 minutes of slack for clock skew between
 * the token's issuer and this server. Then the prefixes are enumerated again.
 *
 * This replaces the rules gate that #2258 tried and #2399 removed. Two reasons
 * it is the right shape and the gate was not: a rules predicate can only
 * refuse a NEW write, so it does nothing about the objects that already landed
 * between the purge starting and the gate taking effect — and on the Storage
 * side it could only ask the question with a cross-service `firestore.exists`,
 * which is what took uploads down for five days. Cleanup off the request path
 * costs nothing per request and covers the whole window, both ends.
 */
const RESWEEP_DELAY_MS = 75 * 60 * 1000;

/**
 * SHA-256 of the lowercased, trimmed address — never the address itself.
 *
 * @param {string} [email]
 * @return {string|null} hex digest, or null when there is no address.
 */
function hashEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Milliseconds for a Firestore Timestamp, a Date, an ISO string or a number.
 * Unreadable values return null, and the staleness test below treats null as
 * "old enough to sweep" — a job whose createdAt cannot be read is exactly the
 * job that must not be left sitting forever.
 *
 * @param {*} value
 * @return {number|null}
 */
function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === "function") {
    try {
      return value.toMillis();
    } catch (_e) {
      return null;
    }
  }
  if (typeof value.toDate === "function") {
    try {
      return value.toDate().getTime();
    } catch (_e) {
      return null;
    }
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Is this job the sweeper's to pick up? Pure, so the window is testable
 * without a clock or a Firestore.
 *
 * @param {object} job                    The tombstone's data.
 * @param {object} [opts]
 * @param {number} [opts.now]             Injected clock (ms).
 * @param {number} [opts.staleAfterMs]    Override the window.
 * @return {boolean}
 */
function isStalePurgeJob(job, {now = Date.now(), staleAfterMs = STALE_AFTER_MS} = {}) {
  if (!job || job.status !== "pending") return false;
  const createdAt = toMillis(job.createdAt);
  // Unreadable / missing timestamp: sweep it. A job we cannot age is a job
  // nothing else will ever finish.
  if (createdAt == null) return true;
  return now - createdAt >= staleAfterMs;
}

/**
 * Has a pre-destructive job been abandoned long enough to stop blocking
 * profile repair?
 *
 * Deliberately NOT `isStalePurgeJob`, though it answers a similar-sounding
 * question. That helper fails OPEN — a job whose `createdAt` cannot be read is
 * swept, because a job nothing can age is a job nothing else will ever finish.
 * Correct for the sweeper; exactly backwards here, where the same input would
 * license rebuilding the profile of an account that may be mid-deletion.
 *
 * So this one fails CLOSED: an unreadable or missing timestamp keeps blocking,
 * the same rule the unreadable-tombstone path already follows. It returns true
 * only for a job that is pending, never reached the point of no return, and has
 * a readable age past the window.
 *
 * @param {object} [job]
 * @param {object} [opts]
 * @param {number} [opts.now]
 * @param {number} [opts.staleAfterMs]
 * @return {boolean}
 */
function isAbandonedBeforeDeletion(job, {now = Date.now(), staleAfterMs = STALE_AFTER_MS} = {}) {
  if (!job || job.status !== "pending") return false;
  if (job.phase === PHASE_IRREVERSIBLE) return false;
  const createdAt = toMillis(job.createdAt);
  if (createdAt == null) return false;
  return now - createdAt >= staleAfterMs;
}

/**
 * Open (or re-open) the tombstone for `uid`. Called BEFORE the Auth user is
 * deleted; a failure here must therefore abort the deletion, which is safe
 * because nothing destructive has happened yet.
 *
 * `merge: true` so a second deletion attempt for the same uid — or the
 * sweeper's own bookkeeping — does not wipe `attempts`.
 *
 * @param {object} db                Admin Firestore.
 * @param {string} uid
 * @param {object} deps
 * @param {object} deps.FieldValue   admin.firestore.FieldValue.
 * @param {string} [deps.email]      Hashed, never stored raw.
 * @param {number} [deps.now]        Injected clock (ms), for the re-sweep due time.
 * @return {Promise<void>}
 */
async function openPurgeJob(db, uid, {FieldValue, email, now = Date.now()} = {}) {
  if (!uid) throw new Error("uid is required");
  if (!FieldValue) throw new Error("FieldValue dependency is required");
  await db.collection(PURGE_JOBS_COLLECTION).doc(uid).set({
    uid,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    emailHash: hashEmail(email),
    // increment(0), not 0: initialises a new job at zero while leaving an
    // existing failure count alone. Re-opening a job must not quietly reset
    // the count the sweeper's alert threshold reads.
    attempts: FieldValue.increment(0),
    // When the surviving ID token can no longer have been used (see
    // RESWEEP_DELAY_MS). A plain epoch-millis number rather than a Timestamp:
    // this module deliberately injects only `FieldValue` so it unit-tests
    // under the root install alone, and `toMillis()` already reads numbers.
    //
    // Both fields are RESET on a re-open, unlike `attempts`. They are not
    // bookkeeping about past runs — they describe the token window of the
    // attempt now starting, and a second attempt mints its own.
    resweepAfter: now + RESWEEP_DELAY_MS,
    resweepDone: false,
  }, {merge: true});
}

/**
 * Is this summary complete enough to close the job?
 *
 * `verified` proves only that `users/{uid}` is absent. `purgeUserData` collects
 * per-collection failures in `summary.errors` and keeps going, so a purge that
 * lost the users doc but failed to delete payments or results would arrive here
 * verified and NOT done (Codex P1 on #2228). Closing on that leaves the
 * remaining personal data unreachable by the sweeper, which only queries
 * pending jobs — the data would never be retried by anything.
 *
 * @param {object} [summary]
 * @return {boolean}
 */
function isPurgeComplete(summary) {
  if (!summary || summary.verified !== true) return false;
  return Array.isArray(summary.errors) && summary.errors.length === 0;
}

/**
 * Mark the purge finished. Only ever called with a COMPLETE summary — verified
 * AND error-free (see isPurgeComplete). Anything less leaves the job pending on
 * purpose, because pending is what the sweeper retries.
 *
 * @param {object} db
 * @param {string} uid
 * @param {object} deps
 * @param {object} deps.FieldValue
 * @param {object} [deps.summary]
 * @return {Promise<void>}
 */
async function completePurgeJob(db, uid, {FieldValue, summary} = {}) {
  await db.collection(PURGE_JOBS_COLLECTION).doc(uid).set({
    status: "done",
    completedAt: FieldValue.serverTimestamp(),
    lastError: null,
    ...(summary ? {lastSummary: summary} : {}),
  }, {merge: true});
}

/**
 * The phase written the moment the deletion becomes irreversible.
 *
 * `cancelled` (below) is a NEGATIVE marker: it records that a deletion failed
 * before the point of no return. It is only ever written by a `catch`, so it
 * cannot describe a run that had no catch — a 540 s timeout, an OOM kill, an
 * instance eviction. Such a run leaves the job `pending` between `openPurgeJob`
 * and `deleteUser`, and a sweeper that adopts bare `pending` would then delete
 * an account whose deletion never started, for a caller who saw a network error
 * rather than any message at all.
 *
 * So the load-bearing guard is this POSITIVE marker instead: written after
 * `deleteUser` succeeds and before the purge, it is present only on jobs that
 * genuinely cannot be abandoned. The sweeper requires it. Whatever way the
 * process dies before that write, the job is not adoptable — and `cancelled`
 * becomes an optimisation (a fast, explicit "don't bother") rather than the
 * thing safety rests on.
 */
const PHASE_IRREVERSIBLE = "irreversible";

/**
 * Mark the point of no return. Must be awaited BEFORE the purge starts: written
 * after, it would describe a state the process may never reach.
 *
 * @param {object} db
 * @param {string} uid
 * @param {object} deps
 * @param {object} deps.FieldValue
 * @return {Promise<void>}
 */
async function markPurgeIrreversible(db, uid, {FieldValue} = {}) {
  await db.collection(PURGE_JOBS_COLLECTION).doc(uid).set({
    phase: PHASE_IRREVERSIBLE,
    irreversibleAt: FieldValue.serverTimestamp(),
  }, {merge: true});
}

/**
 * Is this job safe for the sweeper to adopt and finish?
 *
 * Pending is not enough — see PHASE_IRREVERSIBLE.
 *
 * @param {object} [job]
 * @return {boolean}
 */
function isAdoptable(job) {
  return Boolean(job) && job.status === "pending" && job.phase === PHASE_IRREVERSIBLE;
}

/**
 * Is this job's Storage re-sweep due?
 *
 * Deliberately NOT `isAdoptable`, though it shares that function's phase
 * check, and the two differ on `status` in OPPOSITE directions:
 *
 *   • `isAdoptable` wants `pending` — an unfinished purge is what the daily
 *     sweeper retries, and a `done` job has nothing left to do.
 *   • This wants `done` as the NORMAL case. The purge takes ~25 s and the
 *     token window runs 75 minutes, so by the time a re-sweep is due almost
 *     every job is closed. Requiring `pending` here would re-sweep only the
 *     deletions that had already failed — precisely backwards.
 *
 * What it DOES share, and the reason it is a hard requirement rather than a
 * tidy filter: `phase === PHASE_IRREVERSIBLE`. A tombstone can carry
 * `resweepDone: false` and describe an account that was never deleted at all —
 * `runAccountDeletion` cancels the job when `revokeRefreshTokens` or
 * `deleteUser` fails, and a crash between `openPurgeJob` and
 * `markPurgeIrreversible` leaves it `pending` with no phase marker and a live
 * account behind it. Re-sweeping either would delete a SIGNED-IN user's
 * papers, images and invoices, for a deletion they were told had failed. The
 * phase marker is written only after the Auth user is actually gone, so
 * requiring it is what makes that impossible.
 *
 * `cancelled` is refused by the phase check on its own — a cancelled job never
 * reached the marker — but it is also named explicitly, because the whole
 * point of this guard is that it should not depend on noticing that.
 *
 * An unreadable or missing `resweepAfter` fails CLOSED (not due). This runs
 * every 15 minutes against jobs the equality query already narrowed to
 * `resweepDone === false`, so a job whose due time cannot be read is retried
 * on the next tick rather than swept early — and "early" here means during the
 * window the delay exists to wait out.
 *
 * @param {object} [job]
 * @param {object} [opts]
 * @param {number} [opts.now]
 * @return {boolean}
 */
function isResweepDue(job, {now = Date.now()} = {}) {
  if (!job) return false;
  if (job.phase !== PHASE_IRREVERSIBLE) return false;
  if (job.status === "cancelled") return false;
  if (job.resweepDone === true) return false;
  const due = toMillis(job.resweepAfter);
  if (due == null) return false;
  return now >= due;
}

/**
 * Close the re-sweep for `uid`.
 *
 * `deleted` is recorded even when it is zero, because zero is the interesting
 * number: it is the evidence that the surviving-token window was NOT used, and
 * a summary that omitted it could not tell "swept, found nothing" from "swept,
 * never counted".
 *
 * @param {object} db
 * @param {string} uid
 * @param {object} deps
 * @param {object} deps.FieldValue
 * @param {number} [deps.deleted]   Objects the re-sweep removed.
 * @return {Promise<void>}
 */
async function markResweepDone(db, uid, {FieldValue, deleted = 0} = {}) {
  await db.collection(PURGE_JOBS_COLLECTION).doc(uid).set({
    resweepDone: true,
    resweepAt: FieldValue.serverTimestamp(),
    resweepDeleted: deleted,
    resweepError: null,
  }, {merge: true});
}

/**
 * Record a failed re-sweep, leaving `resweepDone` false so the next run
 * retries. Never throws — same reasoning as `recordPurgeFailure`: this is the
 * error path of something that has already failed, and losing the original
 * error to a bookkeeping failure helps nobody. A lost write here costs a
 * duplicate retry, which is harmless because the re-sweep is idempotent.
 *
 * @param {object} db
 * @param {string} uid
 * @param {object} deps
 * @param {object} deps.FieldValue
 * @param {Error|string} [deps.error]
 * @return {Promise<void>}
 */
async function recordResweepFailure(db, uid, {FieldValue, error} = {}) {
  try {
    await db.collection(PURGE_JOBS_COLLECTION).doc(uid).set({
      resweepDone: false,
      resweepAttempts: FieldValue.increment(1),
      resweepFailedAt: FieldValue.serverTimestamp(),
      resweepError: String((error && error.message) || error || "unknown").slice(0, 500),
    }, {merge: true});
  } catch (err) {
    console.error(`accountPurgeJobs: could not record re-sweep failure for ${uid}:`, err);
  }
}

/**
 * Terminally CANCEL a job that never got past the pre-destructive steps.
 *
 * The sweeper adopts every stale `pending` job and calls `deleteUser` on it.
 * That is right for a job whose Auth user is already gone and whose data is
 * half-purged; it is badly wrong for one that failed at token revocation or at
 * the Auth delete itself, because nothing irreversible has happened yet and the
 * user was TOLD the deletion failed. Left `pending`, the sweeper would finish a
 * deletion the user had been invited to abandon (Codex P1 on #2228).
 *
 * `cancelled` is outside the sweeper's `status == "pending"` query, so a
 * cancelled job is never adopted. `bootstrapUserProfile` also skips it — the
 * account still exists, and a tombstone that blocked profile repair for ever
 * would turn a transient revoke failure into a permanently broken account.
 *
 * Never throws — it runs on the error path of an already-failing deletion — but
 * it REPORTS. The write is the whole safety property on this path, and a
 * swallowed failure puts the job straight back to `pending`, which is the state
 * this call exists to leave. The caller alerts on false and changes what it
 * tells the user, because at that point it cannot promise the deletion will not
 * proceed.
 *
 * @param {object} db
 * @param {string} uid
 * @param {object} deps
 * @param {object} deps.FieldValue
 * @param {string} [deps.reason]
 * @return {Promise<boolean>} true when the cancellation is recorded.
 */
async function cancelPurgeJob(db, uid, {FieldValue, reason} = {}) {
  try {
    await db.collection(PURGE_JOBS_COLLECTION).doc(uid).set({
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
      lastError: String(reason || "cancelled before deletion began").slice(0, 500),
    }, {merge: true});
    return true;
  } catch (err) {
    console.error(`accountPurgeJobs: could not cancel ${uid}:`, err);
    return false;
  }
}

/**
 * Record a failed attempt, leaving the job `pending` so the sweeper retries.
 * Never throws — it runs on the error path of an already-failing deletion, and
 * losing the original error to a bookkeeping failure helps nobody.
 *
 * @param {object} db
 * @param {string} uid
 * @param {object} deps
 * @param {object} deps.FieldValue
 * @param {Error|string} [deps.error]
 * @return {Promise<void>}
 */
async function recordPurgeFailure(db, uid, {FieldValue, error} = {}) {
  try {
    await db.collection(PURGE_JOBS_COLLECTION).doc(uid).set({
      status: "pending",
      attempts: FieldValue.increment(1),
      lastFailedAt: FieldValue.serverTimestamp(),
      lastError: String((error && error.message) || error || "unknown").slice(0, 500),
    }, {merge: true});
  } catch (err) {
    console.error(`accountPurgeJobs: could not record failure for ${uid}:`, err);
  }
}

/**
 * Read a tombstone. Returns null when there is none.
 *
 * @param {object} db
 * @param {string} uid
 * @return {Promise<object|null>}
 */
async function readPurgeJob(db, uid) {
  const snap = await db.collection(PURGE_JOBS_COLLECTION).doc(uid).get();
  return snap.exists ? {id: uid, ...snap.data()} : null;
}

module.exports = {
  PURGE_JOBS_COLLECTION,
  STALE_AFTER_MS,
  ALERT_AFTER_ATTEMPTS,
  RESWEEP_DELAY_MS,
  hashEmail,
  toMillis,
  PHASE_IRREVERSIBLE,
  isStalePurgeJob,
  isPurgeComplete,
  isAdoptable,
  isAbandonedBeforeDeletion,
  isResweepDue,
  markPurgeIrreversible,
  openPurgeJob,
  completePurgeJob,
  cancelPurgeJob,
  recordPurgeFailure,
  markResweepDone,
  recordResweepFailure,
  readPurgeJob,
};
