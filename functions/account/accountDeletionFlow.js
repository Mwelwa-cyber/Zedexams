"use strict";

/**
 * The order in which an account is deleted, and the order in which a missing
 * profile may be rebuilt. Both are decisions, not plumbing, so they live in
 * their own module with every dependency injected — no firebase-admin, no
 * firebase-functions — and are unit-tested under plain `node` against a faked
 * admin SDK (accountDeletionFlow.test.js).
 *
 * ## Why the order changed
 *
 * `deleteMyAccount` used to purge Firestore first and delete the Auth user
 * afterwards. The purge measured 21–25 s in production against ~16 uid-keyed
 * collections and ~35 field queries, and for that whole window the caller's
 * session was still valid — no token revocation, and the client only signed
 * out once the callable resolved. So the deletion of `users/{uid}` reached the
 * still-attached profile listener in AuthContext, which read "no profile" as
 * damage and called `bootstrapUserProfile` to repair it. That callable asked
 * Auth for the user, Auth still had one (it is deleted last), and it wrote a
 * fresh `learner` profile carrying the email and display name we had been
 * asked to erase. The purge finished seconds later over the top of a document
 * that had already been recreated, reported `errors: []`, and the user was
 * left sitting on a dashboard belonging to an account they had just deleted.
 * Three such orphans exist in production.
 *
 * The session is therefore destroyed FIRST: revoke the refresh tokens, delete
 * the Auth user, and only then touch Firestore. After that point there is no
 * session to re-attach a listener, and `getUser` fails — so the repair path
 * has nothing to repair with even if something did call it.
 *
 * ## What that costs, and what pays for it
 *
 * It inverts the failure mode. Before, a failed purge left an intact,
 * retryable account; now it leaves ownerless data and nobody who can retry.
 * The tombstone (`accountPurgeJobs/{uid}`, written before the Auth user goes)
 * is what pays for it: it is the sweeper's queue, and it is what the profile
 * bootstrap checks before writing anything.
 */

const {
  openPurgeJob,
  completePurgeJob,
  recordPurgeFailure,
  readPurgeJob,
  cancelPurgeJob,
  isPurgeComplete,
} = require("./accountPurgeJobs");

/**
 * A refusal or failure with a callable-shaped code on it. The handler maps it
 * to an `HttpsError`; keeping `firebase-functions` out of this module is what
 * lets the flow be tested with the root install alone.
 */
class AccountFlowError extends Error {
  /**
   * @param {string} code      A functions error code ("internal", …).
   * @param {string} message   User-facing sentence.
   * @param {object} [details] Structured detail for the client + support.
   */
  constructor(code, message, details) {
    super(message);
    this.name = "AccountFlowError";
    this.code = code;
    this.details = details;
  }
}

/** True for the one Auth error that means "already gone", i.e. success. */
function isUserNotFound(error) {
  return error && error.code === "auth/user-not-found";
}

/**
 * Delete `uid`'s account: session first, then data, then proof.
 *
 * Steps, in the order the tests pin:
 *   1. tombstone      — before anything irreversible, so recovery is possible
 *   2. revokeRefreshTokens — existing ID tokens stop being refreshable
 *   3. deleteUser     — the session is now unusable and `getUser` fails
 *   4. purgeUserData  — Firestore, best-effort per collection
 *   5. verify         — the purge re-reads `users/{uid}`; an unverified purge
 *                       is a FAILURE, not a success with a caveat
 *
 * @param {object} args
 * @param {string} args.uid
 * @param {string} [args.email]       Hashed into the tombstone.
 * @param {object} args.db            Admin Firestore.
 * @param {object} args.auth          Admin Auth (revokeRefreshTokens, deleteUser).
 * @param {object} args.FieldValue    admin.firestore.FieldValue.
 * @param {Function} args.purge       purgeUserData(db, uid, {FieldValue}).
 * @return {Promise<{success: true, summary: object}>}
 */
async function runAccountDeletion({uid, email, db, auth, FieldValue, purge}) {
  if (!uid) throw new AccountFlowError("internal", "uid is required");

  // 1. Tombstone. Nothing destructive has happened yet, so failing here is
  // safe to surface as a plain retry — and it is the only point at which a
  // retry is genuinely free.
  try {
    await openPurgeJob(db, uid, {FieldValue, email});
  } catch (error) {
    console.error("deleteMyAccount could not open the purge job:", error);
    throw new AccountFlowError(
      "internal",
      "We could not start the deletion right now. Please try again, or contact support.",
      {reason: "tombstone-failed"},
    );
  }

  // 2. Revoke first. deleteUser alone leaves an already-minted ID token valid
  // until it expires (up to an hour), which is precisely the window that let a
  // still-signed-in tab rebuild the profile mid-purge.
  try {
    await auth.revokeRefreshTokens(uid);
  } catch (error) {
    if (!isUserNotFound(error)) {
      console.error("deleteMyAccount token revocation failed:", error);
      // Nothing irreversible has happened. Cancel the tombstone so the sweeper
      // cannot later finish a deletion this caller was told had failed.
      await cancelPurgeJob(db, uid, {FieldValue, reason: "revoke-failed"});
      throw new AccountFlowError(
        "internal",
        "We could not sign you out of your other sessions. Please try again, or contact support.",
        {reason: "revoke-failed"},
      );
    }
  }

  // 3. Delete the Auth user. Already gone is success — this callable has to be
  // safe to call twice.
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (!isUserNotFound(error)) {
      console.error("deleteMyAccount auth deletion failed:", error);
      // Still pre-destructive: the tokens are revoked but the account and its
      // data are intact, and the user is being told to retry. Same reasoning.
      await cancelPurgeJob(db, uid, {FieldValue, reason: "auth-delete-failed"});
      throw new AccountFlowError(
        "internal",
        "We could not delete your sign-in. Please try again, or contact support.",
        {reason: "auth-delete-failed"},
      );
    }
  }

  // 4. The data. From here on the account cannot be restored, so every failure
  // path below leaves the tombstone `pending` for the sweeper and says nothing
  // that invites the user to "try again" — there is nothing left to try.
  let summary;
  try {
    summary = await purge(db, uid, {FieldValue});
  } catch (error) {
    console.error(`deleteMyAccount purge failed uid=${uid}:`, error);
    await recordPurgeFailure(db, uid, {FieldValue, error});
    throw new AccountFlowError(
      "internal",
      "Your sign-in has been removed and the rest of your data is still being deleted. " +
      "You do not need to do anything else — contact support if you would like confirmation.",
      {reason: "purge-failed"},
    );
  }

  // 5. Proof. `verified` is the purge's own re-read of users/{uid}; false means
  // the PII home survived, which is the exact failure this whole change is
  // about. Reporting success over it is how three orphans reached production.
  if (!isPurgeComplete(summary)) {
    const unverified = !summary || summary.verified !== true;
    console.error(
      `deleteMyAccount could not ${unverified ? "verify" : "complete"} the purge ` +
      `uid=${uid} summary=${JSON.stringify(summary)}`,
    );
    await recordPurgeFailure(db, uid, {
      FieldValue,
      error: unverified ?
        "users doc still present after purge" :
        `purge finished with errors: ${JSON.stringify(summary.errors)}`,
    });
    throw new AccountFlowError(
      "internal",
      "Your sign-in has been removed and the rest of your data is still being deleted. " +
      "You do not need to do anything else — contact support if you would like confirmation.",
      {reason: unverified ? "purge-unverified" : "purge-incomplete"},
    );
  }

  await completePurgeJob(db, uid, {FieldValue, summary});
  return {success: true, summary};
}

/**
 * Rebuild a missing `users/{uid}` — but only for a uid that still has an
 * account behind it.
 *
 * Two refusals, both `failed-precondition`, both writing nothing:
 *   • the Auth user does not exist. Every error used to collapse into a
 *     generic `internal`, which hid this case entirely; it is the case that
 *     matters, because "no Auth user" means this uid is not a damaged profile,
 *     it is a deleted account.
 *   • a purge tombstone exists. Belt to the same brace: a deletion in flight
 *     (or finished) must never be undone by a repair, even in the window
 *     before the Auth user is gone.
 *
 * @param {object} args
 * @param {string} args.uid
 * @param {string} [args.tokenRole]
 * @param {object} args.db
 * @param {object} args.auth           Admin Auth (getUser).
 * @param {Function} args.buildProfile ({authUser, tokenRole}) → profile doc.
 * @return {Promise<{created: boolean, profile: object}>}
 */
async function runProfileBootstrap({uid, tokenRole, db, auth, buildProfile}) {
  const userRef = db.doc(`users/${uid}`);
  const existingSnap = await userRef.get();
  if (existingSnap.exists) {
    return {created: false, profile: {id: uid, ...existingSnap.data()}};
  }

  // Fail CLOSED on an unreadable tombstone: not knowing whether this uid is
  // being deleted is not a licence to write its profile back.
  let purgeJob;
  try {
    purgeJob = await readPurgeJob(db, uid);
  } catch (error) {
    console.error("bootstrapUserProfile could not read the purge job:", error);
    throw new AccountFlowError(
      "internal",
      "We could not restore your profile right now. Please try again.",
    );
  }
  // A CANCELLED job is not a deletion — it is one that never got past the
  // pre-destructive steps and was abandoned. The account still exists, so
  // refusing here would turn a transient revoke failure into an account that
  // can never repair its own profile again.
  if (purgeJob && purgeJob.status !== "cancelled") {
    console.warn(
      `bootstrapUserProfile refused: accountPurgeJobs/${uid} is ${purgeJob.status}`,
    );
    throw new AccountFlowError(
      "failed-precondition",
      "This account has been deleted.",
      {reason: "account-deleted"},
    );
  }

  let authUser;
  try {
    authUser = await auth.getUser(uid);
  } catch (error) {
    if (isUserNotFound(error)) {
      console.warn(`bootstrapUserProfile refused: no auth user for ${uid}`);
      throw new AccountFlowError(
        "failed-precondition",
        "This account has been deleted.",
        {reason: "account-deleted"},
      );
    }
    console.error("bootstrapUserProfile:", error);
    throw new AccountFlowError(
      "internal",
      "We could not restore your profile right now. Please try again.",
    );
  }

  try {
    await userRef.set(buildProfile({authUser, tokenRole}));
    const repairedSnap = await userRef.get();
    return {created: true, profile: {id: uid, ...repairedSnap.data()}};
  } catch (error) {
    console.error("bootstrapUserProfile:", error);
    throw new AccountFlowError(
      "internal",
      "We could not restore your profile right now. Please try again.",
    );
  }
}

module.exports = {
  AccountFlowError,
  isUserNotFound,
  runAccountDeletion,
  runProfileBootstrap,
};
