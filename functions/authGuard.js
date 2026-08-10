// Shared auth guard for callables + HTTP endpoints: signed in AND (for
// accounts that carry an email) email_verified, with the migration-granted
// grace window (users.verificationGraceUntil, admin-SDK-written only)
// honoured so legacy accounts aren't cut off mid-window. Mirrors the
// isVerified() helper in firestore.rules / storage.rules — the TOKEN claim
// is the source of truth, never the users.emailVerified display field.
//
// Deliberately NOT applied to:
//   - bootstrapUserProfile  — repairs a missing profile right after signup,
//     before the user has verified;
//   - deleteMyAccount       — a user who mistyped their email must be able
//     to delete the account they can never verify;
//   - sendPasswordResetEmail — pre-auth by design;
//   - lencoWebhook / apiWhatsAppWebhook — provider-authenticated, no user.
//
// The no-email arm (custom-token accounts, e.g. a future learner-ID/PIN
// flow, carry no email claim) passes intentionally: "verify your email"
// is meaningless for an account that has none.

const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

function tokenNeedsVerification(token) {
  return !!token && !!token.email && token.email_verified !== true;
}

async function isWithinGrace(uid) {
  try {
    const snap = await admin.firestore().doc(`users/${uid}`).get();
    const until = snap.exists ? snap.data()?.verificationGraceUntil : null;
    if (!until) return false;
    const millis = typeof until.toMillis === "function" ? until.toMillis() : NaN;
    return Number.isFinite(millis) && millis > Date.now();
  } catch (err) {
    // Fail closed: an unreadable grace field must not widen access.
    console.warn("[authGuard] grace lookup failed:", err?.message || err);
    return false;
  }
}

function unverifiedError() {
  // details.reason lets the client route straight to /verify-email.
  return new HttpsError(
    "permission-denied",
    "Please verify your email address to continue.",
    { reason: "email-unverified" },
  );
}

function suspendedError() {
  // details.reason lets the client show the account-suspended screen instead
  // of a generic permission error (and stop retrying).
  return new HttpsError(
    "permission-denied",
    "Your account has been suspended. Please contact support.",
    { reason: "account-suspended" },
  );
}

// Backend suspension enforcement (P0). The canonical lifecycle field is
// users/{uid}.status ('active'|'suspended'|'deleted'), written only by the
// admin adminSetUserStatus Cloud Function. Absence == active (legacy accounts
// predate the field). adminSetUserStatus revokes refresh tokens on suspend,
// but the already-issued ID token stays valid ~1h, so this status check — not
// token revocation — is what actually blocks a suspended caller mid-session.
//
// Fails OPEN on a transient read error: a moderation check must never lock the
// whole platform out during a Firestore blip. Revoked refresh tokens still
// bound the exposure window and the next successful call re-checks.
async function assertActiveAccount(uid) {
  try {
    const db = admin.firestore();
    // Both in one round trip. The tombstone is checked because the status field
    // cannot cover this case: the purge DELETES users/{uid}, so once it has,
    // `snap.exists` is false, `status` is null, and this function returns
    // happily — the deleted account's surviving ID token keeps calling.
    // revokeRefreshTokens only stops NEW tokens being minted; one already in
    // another tab is good for up to an hour (Codex P1 on #2228).
    const [userSnap, jobSnap] = await db.getAll(
      db.doc(`users/${uid}`),
      db.doc(`accountPurgeJobs/${uid}`),
    );
    if (jobSnap.exists && jobSnap.data()?.status !== "cancelled") {
      throw deletedError();
    }
    const status = userSnap.exists ? userSnap.data()?.status : null;
    if (status === "suspended" || status === "deleted") {
      throw suspendedError();
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    // Still fails OPEN on a transient read error, and deliberately: a
    // moderation-or-deletion check that locks the whole platform out during a
    // Firestore blip is a worse outcome than the bounded window it closes.
    // What is NOT fail-open is a successful read that finds a tombstone —
    // that is deterministic, and it throws above.
    console.warn("[authGuard] status lookup failed:", err?.message || err);
  }
}

function deletedError() {
  return new HttpsError(
    "failed-precondition",
    "This account has been deleted.",
  );
}

// Callable entry guard. Replaces the bare `if (!request.auth) throw` line.
// Verifies sign-in + email (or grace) AND that the account is not suspended.
// Returns the caller's uid.
async function assertVerifiedAuth(request, message = "Please sign in first.") {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", message);
  }
  if (tokenNeedsVerification(request.auth.token)) {
    if (!(await isWithinGrace(request.auth.uid))) {
      throw unverifiedError();
    }
  }
  await assertActiveAccount(request.auth.uid);
  return request.auth.uid;
}

// Same predicate for HTTP endpoints, applied to a decoded verifyIdToken()
// result (which carries email/email_verified directly).
async function assertDecodedVerified(decoded) {
  if (tokenNeedsVerification(decoded)) {
    if (!(await isWithinGrace(decoded.uid))) {
      throw unverifiedError();
    }
  }
  await assertActiveAccount(decoded.uid);
  return decoded;
}

module.exports = {
  assertVerifiedAuth,
  assertDecodedVerified,
  assertActiveAccount,
  tokenNeedsVerification,
};
