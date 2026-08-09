/**
 * Account-deletion tombstones — the record that says "this uid is being, or
 * has been, deleted; do not rebuild anything for it."
 *
 * ## The bug this exists to close
 *
 * `deleteMyAccount` purges Firestore first and deletes the Auth user second,
 * and the purge takes 21-25 seconds on a real account. Throughout that window
 * the caller's session is still completely valid. The moment the purge removes
 * `users/{uid}`, the client's profile listener (`AuthContext.jsx`) sees the
 * document vanish, reads that as damage, and calls `bootstrapUserProfile` to
 * repair it. That handler's only existence check is `admin.auth().getUser(uid)`
 * — which still SUCCEEDS, because the Auth user has not been deleted yet — so
 * it writes a brand-new profile with the default role. The purge then finishes
 * over the top of a document recreated seconds earlier, re-checks nothing, and
 * returns `errors: []`. The UI reports a successful deletion. The profile is
 * still there.
 *
 * Reproduced 3/3 in production, with the resurrecting call landing +5s, +5s
 * and +2s into the purge.
 *
 * ## Why a tombstone rather than the two obvious alternatives
 *
 * **Not "delete the Auth user first."** That closes this race, but it inverts a
 * deliberate failure mode: today, if auth deletion fails, the data is gone and
 * the login remains, which is recoverable — support finishes the job and the
 * user can still sign in. Reversed, a failed purge leaves a user who cannot
 * sign in to retry and whose data is still live. That is a worse outcome than
 * the bug being fixed.
 *
 * **Not "revoke refresh tokens" alone.** Revocation stops NEW ID tokens; it
 * does not invalidate the one the client is already holding, and callables do
 * not verify revocation (`verifyIdToken` is called without `checkRevoked`). The
 * existing token stays acceptable for up to an hour. Revocation is still worth
 * doing — it is defence in depth, and it is done — but it cannot be the guard.
 *
 * A tombstone is checked explicitly, on the server, by the one handler that
 * rebuilds profiles. It does not depend on token lifetimes, client behaviour,
 * or how long a purge happens to take.
 *
 * ## Why it is permanent
 *
 * The record is never removed. A client that wakes an hour after the deletion
 * with a still-valid cached token must not be able to resurrect the profile
 * either, and a "deletion finished, tombstone cleared" design reopens exactly
 * the window it was built to close.
 *
 * Keeping it forever is safe because it is keyed by **uid**, and Firebase mints
 * a NEW uid when someone registers again — even with the same email address. A
 * returning user is therefore never blocked by their own tombstone.
 */
const DELETION_TOMBSTONES = "accountDeletions";

/**
 * Record that deletion has begun. Called BEFORE the purge, so the guard is in
 * place before the first document disappears — a tombstone written after the
 * purge would be written after the race it prevents.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid
 * @param {{FieldValue: object}} deps
 */
async function markDeletionStarted(db, uid, {FieldValue}) {
  if (!uid) throw new Error("uid is required");
  if (!FieldValue) throw new Error("FieldValue dependency is required");
  await db.collection(DELETION_TOMBSTONES).doc(uid).set({
    status: "in_progress",
    startedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
}

/**
 * Mark the deletion finished. Purely a breadcrumb for operators — `isDeleting`
 * refuses on ANY tombstone, in_progress or complete, so nothing depends on
 * this call having run.
 */
async function markDeletionComplete(db, uid, {FieldValue}) {
  if (!uid) throw new Error("uid is required");
  if (!FieldValue) throw new Error("FieldValue dependency is required");
  await db.collection(DELETION_TOMBSTONES).doc(uid).set({
    status: "complete",
    completedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
}

/**
 * Is this uid deleted, or mid-deletion?
 *
 * **Fails CLOSED.** If the tombstone cannot be read, this reports `true` —
 * "we cannot prove this account is alive". The only caller is profile
 * reconstruction, so the cost of a false positive is that a genuine repair is
 * declined and retried, while the cost of a false negative is a deleted
 * account coming back. Those are not comparable, so the unreadable case is not
 * treated as "no tombstone".
 *
 * @returns {Promise<boolean>}
 */
async function isDeleting(db, uid) {
  if (!uid) return true;
  try {
    const snap = await db.collection(DELETION_TOMBSTONES).doc(uid).get();
    return snap.exists;
  } catch (err) {
    console.error("deletionTombstone read failed, failing closed:", err?.message || err);
    return true;
  }
}

module.exports = {
  DELETION_TOMBSTONES,
  markDeletionStarted,
  markDeletionComplete,
  isDeleting,
};
