"use strict";

/**
 * The cleanup that runs AFTER an account's data is gone — in one place, so the
 * normal path and the recovery path cannot do different things.
 *
 * ## What was wrong
 *
 * `purgeUserData` walks Firestore, and both `deleteMyAccount` and the sweeper
 * called it, so the Firestore half was already shared. The two steps that are
 * NOT Firestore — closing the web deletion request, and deleting the PostHog
 * person — lived inline in the callable handler, below `runAccountDeletion`
 * and outside anything the sweeper could reach.
 *
 * So a deletion the handler completed honoured Privacy Policy §7, and a
 * deletion the SWEEPER completed did not: the account was gone, the Firestore
 * data was gone, and the analytics profile with its event history stayed. The
 * difference was invisible — the sweeper reported `completed`, because from
 * where it stood the purge had verified.
 *
 * Every future cleanup target would have been added to the handler for the
 * same reason the first two were: that is where the code that finishes a
 * deletion appears to live.
 *
 * ## The shape of the fix
 *
 * One exported routine, called by both. Adding a step here adds it to both
 * paths by construction, and `test:purge-cleanup-parity` fails the build if a
 * caller starts doing cleanup inline again.
 *
 * ## Identity, and the one place the two paths genuinely differ
 *
 * PostHog is keyed by uid, which both paths have. Full parity, no caveat.
 *
 * `deletionRequests` rows are keyed by EMAIL, and the recovery path does not
 * have one: the tombstone deliberately stores only a SHA-256 (it outlives the
 * account, so it holds no address), and the Auth user is already deleted by
 * then, so there is nowhere left to look it up. That is a property of having
 * kept the promise, not an oversight.
 *
 * So the routine takes whichever identifier its caller has and says which it
 * used. The handler passes the verified address off the session and gets the
 * indexed equality query; the sweeper passes the hash off the tombstone and
 * gets a scan of the open queue. Both close the same rows.
 *
 * The stated limit: a row written before `emailHash` was recorded on it carries
 * no hash, so the sweeper cannot match it and it stays open for a human. It is
 * skipped rather than guessed at, and it is not counted as closed — but nothing
 * reports it either, because the scan cannot tell "no open row for this person"
 * from "an open row that predates the field". Bounded and shrinking: every row
 * written since carries the hash.
 *
 * ## Never throws
 *
 * Every step here runs after the account is irreversibly gone. Turning a
 * completed deletion into an error invites the user to retry something that
 * has already happened, and gives the sweeper a reason to leave a job open
 * that is actually finished. Each step reports its outcome instead.
 *
 * Dependencies are injected so this unit-tests under plain `node` with the
 * root install alone (repo convention).
 */

/**
 * Run every post-purge cleanup step for one uid.
 *
 * @param {object} args
 * @param {string} args.uid                 The purged account.
 * @param {object} args.db                  Admin Firestore.
 * @param {string} [args.email]             Raw address, when the caller has a
 *                                          verified one. The handler does; the
 *                                          sweeper never can.
 * @param {string} [args.emailHash]         `hashEmail(email)` off the tombstone.
 * @param {Function} [args.closeRequests]   closeDeletionRequests(db, email).
 * @param {Function} [args.closeRequestsByHash]
 *                                          closeDeletionRequestsByEmailHash(db, hash).
 * @param {Function} [args.deleteAnalytics] deleteAnalyticsProfile(uid).
 * @return {Promise<{deletionRequestsClosed: number|string, analytics: object}>}
 */
async function runPostPurgeCleanup({
  uid,
  db,
  email,
  emailHash,
  closeRequests,
  closeRequestsByHash,
  deleteAnalytics,
} = {}) {
  // deletionRequestClosure, NOT accountDeletionRequests: the latter is an
  // onRequest endpoint and imports `firebase-functions`, which CI's node
  // runners do not install. Reaching the closing logic through the endpoint
  // would drag that dependency into every caller of this routine — including
  // the sweeper, whose whole test suite runs under the root install.
  const closure = require("./deletionRequestClosure");
  const closeByEmail = closeRequests || closure.closeDeletionRequests;
  const closeByHash = closeRequestsByHash || closure.closeDeletionRequestsByEmailHash;
  const purgeAnalytics = deleteAnalytics ||
    require("../analyticsPurge").deleteAnalyticsProfile;

  const summary = {};

  // 1. The web deletion request, so the support queue drains itself when the
  //    job is finished by either path rather than waiting on a human reply.
  try {
    if (email) {
      summary.deletionRequestsClosed = await closeByEmail(db, email);
      summary.deletionRequestsMatchedBy = "email";
    } else if (emailHash) {
      summary.deletionRequestsClosed = await closeByHash(db, emailHash);
      summary.deletionRequestsMatchedBy = "emailHash";
    } else {
      // Neither identifier. Distinct from "none matched": there was nothing to
      // match WITH, and a reader of this summary needs to be able to tell a
      // clean queue from a search that never ran.
      summary.deletionRequestsClosed = "no-identifier";
      summary.deletionRequestsMatchedBy = "none";
    }
  } catch (error) {
    console.error(`postPurgeCleanup: deletionRequests close failed uid=${uid}:`, error);
    summary.deletionRequestsClosed = "failed";
  }

  // 2. The PostHog person + their events (Privacy Policy §7). uid-keyed, so
  //    this is identical on both paths. A no-op unless POSTHOG_PERSONAL_API_KEY
  //    is configured, and it never throws on its own.
  try {
    summary.analytics = await purgeAnalytics(uid);
  } catch (error) {
    console.error(`postPurgeCleanup: analytics purge failed uid=${uid}:`, error);
    summary.analytics = {ok: false, error: "threw"};
  }

  return summary;
}

module.exports = {
  runPostPurgeCleanup,
};
