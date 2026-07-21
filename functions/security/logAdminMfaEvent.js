// logAdminMfaEvent — a tightly-scoped callable the client uses to record MFA
// ENROLMENT events (started / completed / failed) in the security audit log.
//
// Enrolment itself is a client SDK operation (Firebase multi-factor enroll), so
// there is no server callable in the enrol path to audit from — hence this thin
// logger. It deliberately does NOT require an MFA-verified session: enrolment
// precedes MFA, so the caller has no second factor yet. It DOES require a
// signed-in, verified admin, only accepts the fixed enrolment event types, and
// for `completed` it verifies against the Admin SDK that a factor is really
// enrolled before trusting the event or mirroring the (non-authoritative)
// mfaEnrolled status field.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { assertVerifiedAuth } = require("../authGuard");
const { tokenIsAdmin, tokenIsSuperAdmin } = require("./requireAdminMfaCore");
const {
  writeSecurityAudit,
  SECURITY_EVENTS,
  requestMetaFrom,
} = require("./securityAudit");

const EVENT_MAP = {
  started: SECURITY_EVENTS.MFA_ENROLL_STARTED,
  completed: SECURITY_EVENTS.MFA_ENROLL_COMPLETED,
  failed: SECURITY_EVENTS.MFA_ENROLL_FAILED,
};

async function isCallerAdmin(request) {
  const token = request.auth.token;
  if (tokenIsAdmin(token)) return true;
  // Fallback for accounts promoted before claim-sync (AUTH-M4).
  try {
    const snap = await admin.firestore().doc(`users/${request.auth.uid}`).get();
    const role = snap.exists ? snap.data()?.role : null;
    return role === "admin" || role === "superAdmin";
  } catch {
    return false;
  }
}

exports.logAdminMfaEvent = onCall({ region: "us-central1", timeoutSeconds: 15 }, async (request) => {
  await assertVerifiedAuth(request);
  if (!(await isCallerAdmin(request))) {
    throw new HttpsError("permission-denied", "Administrator access required.");
  }

  const kind = String(request.data?.event || "");
  const eventType = EVENT_MAP[kind];
  if (!eventType) {
    throw new HttpsError("invalid-argument", "Unknown MFA event.");
  }

  const uid = request.auth.uid;
  const token = request.auth.token;
  const actorRole = tokenIsSuperAdmin(token) ? "superAdmin" : "admin";
  const outcome = kind === "failed" ? "failure" : kind === "completed" ? "success" : "started";
  // A short, non-sensitive reason code (e.g. an error code) for failures only.
  const reasonCode = kind === "failed" ? String(request.data?.reasonCode || "").slice(0, 80) : null;

  // For a "completed" claim, verify with the Admin SDK that a factor is really
  // enrolled — this makes the event authoritative and lets us safely mirror the
  // reporting-only mfaEnrolled field (never a security control).
  if (kind === "completed") {
    let enrolled = false;
    try {
      const authUser = await admin.auth().getUser(uid);
      enrolled = (authUser.multiFactor?.enrolledFactors || []).length > 0;
    } catch {
      enrolled = false;
    }
    if (!enrolled) {
      throw new HttpsError("failed-precondition", "No MFA factor is enrolled on this account.");
    }
    try {
      await admin.firestore().doc(`users/${uid}`).set(
        { mfaEnrolled: true, mfaEnrolledAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
    } catch {
      /* mirror is best-effort, reporting only */
    }
  }

  await writeSecurityAudit({
    eventType,
    actorUid: uid,
    actorRole,
    outcome,
    reason: reasonCode,
    ...requestMetaFrom(request),
  });

  return { ok: true };
});
