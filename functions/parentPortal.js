/**
 * Parent portal — share-link infrastructure (audit A3 PR 1).
 *
 * Three callables:
 *
 *   createProgressShare({ parentEmail?, parentPhone?, parentDisplayName? })
 *     - Authenticated learner self-issues a share. Mints a 12-char
 *       token, sets a 90-day TTL, and returns { token, url }.
 *
 *   revokeProgressShare({ token })
 *     - Authenticated learner — sets revokedAt on their own share.
 *
 *   getProgressShare({ token })
 *     - PUBLIC (no auth) — admin SDK reads progressShares/{token},
 *       validates not revoked / not expired, then aggregates a
 *       parent-friendly summary of the learner's last 30 days
 *       (recent scores, subject breakdown, streak, current grade).
 *     - Bumps viewCount + lastViewedAt on the share doc.
 *     - Returns the rendered shape so the public /parent/:token
 *       route can render without doing N+1 reads through admin SDK.
 *
 * Note on `getProgressShare` being public: this matches the existing
 * `/shares/{token}` pattern — the token IS the permission. Tokens are
 * 12 chars from a 32-char alphabet (~10^18 combinations) so brute
 * forcing is infeasible.
 */

const {FieldValue, getFirestore} = require("firebase-admin/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const {aggregateProgress} = require("./parentPortalShared");

const REGION = "us-central1";
const STATS_WINDOW_DAYS = 30;

// RETIRED (parent portal 4c). The share-with-parent feature is gone: a learner
// now sends results on WhatsApp (src/shared/utils/parentShare.js). 4a removed
// the buttons but left this callable creating 90-day shares for any verified
// learner, so an older cached client or a direct call could still mint a link
// that outlives the date `cleanup:parent-portal:report` prints — and then
// deleting `weeklyParentDigest` on that date would silently stop it. It now
// refuses. The export stays so the client wrapper gets a clear error rather
// than "function not found"; `revokeProgressShare` and `getProgressShare` are
// untouched, so links already issued can still be revoked and viewed.
const createProgressShare = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  await assertVerifiedAuth(request, "Sign in required.");
  throw new HttpsError(
      "failed-precondition",
      "Parent links have been retired. Use the WhatsApp button on your results to tell a parent how you are doing.",
      {reason: "retired"},
  );
});

const revokeProgressShare = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const token = String(request.data?.token || "").trim().toUpperCase();
  if (!token) throw new HttpsError("invalid-argument", "token is required.");

  const db = getFirestore();
  const ref = db.collection("progressShares").doc(token);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Share not found.");
  const data = snap.data() || {};
  if (data.learnerUid !== uid) {
    throw new HttpsError("permission-denied", "You can only revoke your own share.");
  }
  await ref.update({
    revokedAt: FieldValue.serverTimestamp(),
  });
  return {ok: true};
});

const getProgressShare = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: "512MiB",
}, async (request) => {
  // PUBLIC — no auth required. The token IS the permission.
  const token = String(request.data?.token || "").trim().toUpperCase();
  if (!token || token.length < 6 || token.length > 32) {
    throw new HttpsError("invalid-argument", "A share token is required.");
  }

  const db = getFirestore();
  const ref = db.collection("progressShares").doc(token);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "This progress link is invalid.");
  }
  const share = snap.data() || {};
  if (share.revokedAt) {
    throw new HttpsError("failed-precondition", "This progress link has been revoked.");
  }
  if (share.expiresAt && share.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "This progress link has expired.");
  }

  // Best-effort: bump view tally so the learner can see how often
  // their parent has checked. Doesn't block on failure.
  ref.update({
    viewCount: FieldValue.increment(1),
    lastViewedAt: FieldValue.serverTimestamp(),
  }).catch((err) => console.warn("[parentPortal] view bump failed", err));

  // Learner profile — display name + grade. Admin SDK bypasses
  // user-doc read rules (which are normally self+admin only).
  const learnerSnap = await db.collection("users").doc(share.learnerUid).get();
  const learner = learnerSnap.exists ? (learnerSnap.data() || {}) : {};

  const stats = await aggregateProgress(db, share.learnerUid, {windowDays: STATS_WINDOW_DAYS});

  return {
    learnerDisplayName: learner.displayName || "your learner",
    learnerGrade: learner.grade || null,
    learnerSchool: learner.school || null,
    parentDisplayName: share.parentDisplayName || null,
    summary: stats.summary,
    subjectBreakdown: stats.subjectBreakdown,
    recentResults: stats.recentResults,
    sharedAtMs: share.createdAt?.toMillis ? share.createdAt.toMillis() : null,
    expiresAtMs: share.expiresAt?.toMillis ? share.expiresAt.toMillis() : null,
  };
});

module.exports = {
  createProgressShare,
  revokeProgressShare,
  getProgressShare,
};
