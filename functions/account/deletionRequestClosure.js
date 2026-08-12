"use strict";

/**
 * Closing out a web deletion request — the half of `deletionRequests` that
 * belongs to the DELETION pipeline rather than to the public intake endpoint.
 *
 * ## Why it lives here and not in accountDeletionRequests.js
 *
 * That file is an `onRequest` endpoint, so it imports `firebase-functions` at
 * load. CI's node runners install root deps only, so every test that reaches
 * it is skipped — including in the Functions coverage job, which also runs
 * `npm ci` at the root. Leaving the closing logic there meant it could only be
 * covered by tests that never execute, which reads as coverage and is worse
 * than none.
 *
 * It is also where it belongs by responsibility: intake records a request,
 * this closes one, and the caller of the second is the account purge.
 *
 * ## Two lookups, because the two deletion paths know different things
 *
 * `deleteMyAccount` has the verified address off the session and gets the
 * indexed equality query. The purge SWEEPER never can: by the time it runs the
 * Auth user is deleted, and the tombstone deliberately stores only
 * `hashEmail(address)` because it outlives the account. So it matches on that
 * hash instead — the same hash, from the same function, written onto the row
 * at intake.
 *
 * ## Redaction is the point, not the status flip
 *
 * A record that a deletion was requested and honoured is worth keeping; the
 * requester's address is not, and keeping it would contradict Privacy Policy §7
 * in the one collection created by exercising that very promise. What survives
 * — timestamps, role, status — carries no identity.
 *
 * `firebase-admin` is required lazily and only when `serverTimestamp` was not
 * injected, so this unit-tests under plain `node`.
 */

const crypto = require("node:crypto");

const COLLECTION = "deletionRequests";

/**
 * Statuses meaning "a human still owes this request an action". A repeat
 * submission while one of these is open is a no-op rather than a new row.
 */
const OPEN_STATUSES = ["pending", "verified"];

/**
 * How many open rows the hash lookup will scan.
 *
 * Matched in memory rather than by a second composite index: `emailHash` +
 * `status in […]` would need its own index deployed before the code that
 * queries it, the open queue is bounded by how fast support works through it,
 * and this runs only on the rare recovered deletion. Same trade the sweeper's
 * `selectStaleJobs` already makes. This is the ceiling past which a scan would
 * be the wrong tool — not a size anyone expects to reach.
 */
const OPEN_QUEUE_SCAN_LIMIT = 500;

/**
 * Stable, non-reversible key for the per-email rate-limit bucket and for the
 * redacted address left on a closed row. Same address always lands in the same
 * bucket; the address itself never reaches `rateLimits`.
 *
 * @param {string} email
 * @return {string}
 */
function emailBucketKey(email) {
  return crypto.createHash("sha256").update(String(email)).digest("hex").slice(0, 32);
}

function defaultServerTimestamp() {
  return require("firebase-admin").firestore.FieldValue.serverTimestamp();
}

/**
 * Mark rows completed and redact them.
 *
 * The address comes from each ROW rather than from the caller — it is the only
 * one available on the hash path, and using it in both keeps the two lookups
 * from redacting differently.
 *
 * @param {Array} docs
 * @param {object} [deps]
 * @return {Promise<number>} rows closed
 */
async function closeRows(docs, deps = {}) {
  const serverTimestamp = deps.serverTimestamp || defaultServerTimestamp;

  for (const doc of docs) {
    const stored = String(doc.data()?.email || "").trim().toLowerCase();
    await doc.ref.update({
      status: "completed",
      completedAt: serverTimestamp(),
      email: stored ? `redacted:${emailBucketKey(stored)}` : "redacted:",
      name: "",
      details: "",
      ip: null,
      userAgent: "",
      redactedAt: serverTimestamp(),
    });
  }
  return docs.length;
}

/**
 * Close every open request for `email`. The `deleteMyAccount` path.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} email
 * @param {object} [deps]
 * @return {Promise<number>}
 */
async function closeDeletionRequests(db, email, deps = {}) {
  const address = String(email || "").trim().toLowerCase();
  if (!address) return 0;

  const snap = await db.collection(COLLECTION)
      .where("email", "==", address)
      .where("status", "in", OPEN_STATUSES)
      .get();
  if (snap.empty) return 0;

  return closeRows(snap.docs, deps);
}

/**
 * The same close, reached by the SHA-256 of the address. The sweeper's path.
 *
 * A row written before `emailHash` was recorded carries no hash and cannot be
 * matched this way. It is skipped, not guessed at — the handler path still
 * closes it by address.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} emailHash  hex SHA-256 of the lowercased, trimmed address
 * @param {object} [deps]
 * @return {Promise<number>}
 */
async function closeDeletionRequestsByEmailHash(db, emailHash, deps = {}) {
  const hash = String(emailHash || "").trim().toLowerCase();
  if (!hash) return 0;

  const snap = await db.collection(COLLECTION)
      .where("status", "in", OPEN_STATUSES)
      .limit(deps.limit || OPEN_QUEUE_SCAN_LIMIT)
      .get();
  if (snap.empty) return 0;

  const matched = snap.docs.filter((d) => d.data()?.emailHash === hash);
  if (!matched.length) return 0;

  return closeRows(matched, deps);
}

module.exports = {
  COLLECTION,
  OPEN_STATUSES,
  OPEN_QUEUE_SCAN_LIMIT,
  emailBucketKey,
  closeDeletionRequests,
  closeDeletionRequestsByEmailHash,
};
