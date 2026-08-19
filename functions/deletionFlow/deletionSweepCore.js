"use strict";

/**
 * functions/deletionFlow/deletionSweepCore.js
 *
 * The two scheduled sweeps, with EVERY dependency injected — no
 * firebase-admin, no firebase-functions, no clock of its own.
 *
 * ── Why this is a `*Core.js` and not part of index.js ──────────────────
 *
 * The repo's Functions-coverage job runs `npm ci` at the ROOT only, so
 * `functions/node_modules` does not exist when these tests run. Anything it
 * executes has to load without `firebase-functions` — which is the whole
 * reason the `*Core.js` split exists across this codebase, and why the sweeps
 * live here rather than beside the callables that need `HttpsError`.
 *
 * Splitting them out is not only a test convenience. What these two functions
 * decide is the ORDER of a handful of writes, and the order is the safety
 * property. A module that can only be exercised with a live Firestore is one
 * whose ordering nobody checks until it is wrong in production, once.
 *
 * ── What each sweep guarantees ─────────────────────────────────────────
 *
 *   • **The escalation sweep** turns a request nobody answered into one a
 *     person handles. It is what makes "seven days" a promise rather than a
 *     hope, and it deliberately does not care whether the guardian parked it.
 *
 *   • **The executor** purges FIRST and writes `completed` SECOND. Reversing
 *     those would mark an account deleted that still exists — and because
 *     `completed` is terminal, nothing would ever look at it again. The data
 *     would sit there permanently while every screen said it was gone.
 *
 * Both are also resilient per-document: one failing request must not stop the
 * rest of the sweep, or a single bad row holds up every other family's.
 */

const core = require("./deletionRequestCore");

const REQUESTS = "accountDeletionRequests";

/** Cap on how many documents one sweep will touch. */
const SWEEP_LIMIT = 200;

/**
 * The 7-day escalation and the closing-window reminders, in one pass.
 *
 * Both read a single state each and both are cheap; running them as two
 * scheduled functions would double the invocations to do the same two queries.
 *
 * @param {object} deps
 * @param {object} deps.db                 Firestore (admin SDK)
 * @param {number} deps.now                epoch ms
 * @param {Function} deps.commitTransition writes the patch + audit entry
 * @param {Function} deps.notifyLearner    tells the child what happened
 * @param {*} [deps.serverTimestamp]       the sentinel for `graceReminderSentAt`
 * @return {Promise<{escalated: number, reminded: number, errors: object[]}>}
 */
async function runDeletionRequestSweep(deps = {}) {
  const {db, now, commitTransition, notifyLearner, serverTimestamp} = requireDeps(deps, [
    "db", "now", "commitTransition", "notifyLearner", "serverTimestamp",
  ]);
  const summary = {escalated: 0, reminded: 0, errors: []};

  const pendingSnap = await db.collection(REQUESTS)
    .where("state", "==", core.STATE.PENDING_GUARDIAN)
    .limit(SWEEP_LIMIT).get();

  for (const doc of pendingSnap.docs) {
    const stored = {id: doc.id, ...(doc.data() || {})};
    const out = core.escalateIfStale({request: stored, now});
    if (!out) continue;
    try {
      await commitTransition({
        requestId: doc.id, request: stored, patch: out.patch,
        actor: "system", actorUid: null, reason: "guardian_did_not_respond",
      });
      await notifyLearner(stored.learnerId, "escalated", {stamp: doc.id});
      summary.escalated += 1;
    } catch (err) {
      // Recorded and stepped over. One family's bad row must not hold up every
      // other child's seven-day guarantee.
      summary.errors.push({id: doc.id, step: "escalate", message: err?.message});
    }
  }

  const scheduledSnap = await db.collection(REQUESTS)
    .where("state", "==", core.STATE.SCHEDULED)
    .limit(SWEEP_LIMIT).get();

  for (const doc of scheduledSnap.docs) {
    const stored = {id: doc.id, ...(doc.data() || {})};
    const due = core.reminderDue({request: stored, now});
    if (!due) continue;
    try {
      // Stamped BEFORE the notification: a reminder that sent and failed to
      // record would send again on the next run, and the run after that. Five
      // reminders is worse than none.
      await doc.ref.set({graceReminderSentAt: serverTimestamp}, {merge: true});
      await notifyLearner(stored.learnerId, "reminder", {daysLeft: due.daysLeft, stamp: doc.id});
      summary.reminded += 1;
    } catch (err) {
      summary.errors.push({id: doc.id, step: "remind", message: err?.message});
    }
  }

  return summary;
}

/**
 * The 30-day window closing.
 *
 * The order is the whole safety property: purge FIRST, write `completed`
 * SECOND. A purge that throws leaves the request in `scheduled` and the next
 * sweep retries it — where writing `completed` first would mark an account
 * deleted that still exists, and nothing would ever look at it again.
 *
 * @param {object} deps
 * @param {(learnerId: string) => Promise<object>} deps.purge  the REAL deletion
 *   path, injected so this module never carries a second idea of what deletion
 *   means (`runAccountDeletion` owns the tombstone and the token revocation).
 * @return {Promise<{deleted: number, skipped: number, errors: object[]}>}
 */
async function runDeletionExecutionSweep(deps = {}) {
  const {db, now, commitTransition, purge, serverTimestamp} = requireDeps(deps, [
    "db", "now", "commitTransition", "purge", "serverTimestamp",
  ]);
  const summary = {deleted: 0, skipped: 0, errors: []};

  const snap = await db.collection(REQUESTS)
    .where("state", "==", core.STATE.SCHEDULED)
    .limit(SWEEP_LIMIT).get();

  for (const doc of snap.docs) {
    const stored = {id: doc.id, ...(doc.data() || {})};
    const due = core.dueForDeletion({request: stored, now});
    if (!due) { summary.skipped += 1; continue; }
    try {
      await purge(due.learnerId);
      // The purge removes this request document too — it carries the child's
      // display name, and `accountDeletion.js` lists the collection for that
      // reason. What the merge below leaves behind is therefore a deliberate
      // STUB: the state and the timestamp, no learnerId, no name. It records
      // that the window closed without re-creating anything personal, and
      // because it has no learnerId it can never match the purge query again.
      // The full trail is in `accountDeletionAudit`, which is retained.
      await commitTransition({
        requestId: doc.id, request: stored,
        patch: {state: core.STATE.COMPLETED, completedAt: serverTimestamp},
        actor: "system", actorUid: null, reason: "grace_window_closed",
      });
      summary.deleted += 1;
    } catch (err) {
      // Left in `scheduled` on purpose. The next sweep retries it.
      summary.errors.push({id: doc.id, learnerId: due.learnerId, message: err?.message});
    }
  }

  return summary;
}

/**
 * Every dependency is required, and a missing one throws here rather than
 * surfacing as `undefined is not a function` halfway through a sweep that has
 * already purged three accounts.
 */
function requireDeps(deps, names) {
  for (const name of names) {
    if (deps[name] === undefined || deps[name] === null) {
      throw new TypeError(`deletionSweepCore: \`${name}\` is required`);
    }
  }
  if (!Number.isFinite(deps.now)) {
    throw new TypeError("deletionSweepCore: `now` (epoch ms) is required");
  }
  return deps;
}

module.exports = {
  REQUESTS,
  SWEEP_LIMIT,
  runDeletionRequestSweep,
  runDeletionExecutionSweep,
};
