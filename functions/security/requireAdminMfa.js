// Reusable server-side guard: a privileged administrator action requires a
// signed-in, email-verified, non-suspended administrator whose CURRENT session
// completed a second factor (TOTP MFA). A frontend route guard is not enough —
// this is the real enforcement boundary for admin callables + HTTP endpoints.
//
// Composition:
//   assertVerifiedAuth(request)  → signed-in + email-verified/grace + not suspended
//   evaluateAdminMfa(token)      → admin claim present + sign_in_second_factor present
//
// HttpsError codes (as the task specifies):
//   unauthenticated     — no signed-in caller
//   permission-denied   — caller is not an admin (or not a super admin when required)
//   failed-precondition — caller is an admin but the session carries no MFA evidence
//
// The failed-precondition case carries details.reason = 'admin-mfa-required' so
// the client can route the admin to /admin/security/mfa-setup instead of
// showing a dead error.
//
// Enforcement mode (Phase 15): resolveEnforcement(process.env.ADMIN_MFA_ENFORCEMENT).
// "enforce" (default) blocks admins without MFA; "monitor" (documented,
// temporary rollout stage) lets them through but records the gap. Non-admins
// are always blocked in both modes.

const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { assertVerifiedAuth, assertDecodedVerified } = require("../authGuard");
const {
  evaluateAdminMfa,
  tokenIsAdmin,
  tokenIsSuperAdmin,
  tokenHasSecondFactor,
  secondFactorType,
  resolveEnforcement,
} = require("./requireAdminMfaCore");
const { writeSecurityAudit, SECURITY_EVENTS, requestMetaFrom } = require("./securityAudit");

function currentEnforcement() {
  return resolveEnforcement(process.env.ADMIN_MFA_ENFORCEMENT);
}

// Read the account's authoritative Firestore role. Only consulted when the
// token carries no admin claim, as a transition fallback for accounts promoted
// before claim-sync landed (AUTH-M4). Fails closed (null) on any read error.
async function readFirestoreRole(uid) {
  try {
    const snap = await admin.firestore().doc(`users/${uid}`).get();
    return snap.exists ? snap.data()?.role || null : null;
  } catch (err) {
    console.warn("[requireAdminMfa] role fallback read failed:", err?.message);
    return null;
  }
}

function toHttpsError(decision) {
  const message =
    decision.reason === "admin-mfa-required"
      ? "Multi-factor authentication is required for administrator actions."
      : decision.reason === "not-super-admin"
        ? "Super administrator access required."
        : decision.reason === "not-admin"
          ? "Administrator access required."
          : "Please sign in first.";
  const details =
    decision.reason === "admin-mfa-required" ? { reason: "admin-mfa-required" } : undefined;
  return new HttpsError(decision.code, message, details);
}

function successShape(token, uid, decision) {
  const isSuper = !!decision.isSuperAdmin || tokenIsSuperAdmin(token);
  return {
    uid,
    email: (token && token.email) || null,
    role: isSuper ? "superAdmin" : "admin",
    isSuperAdmin: isSuper,
    factor: decision.factor || secondFactorType(token),
    mfaSatisfied: !!decision.ok,
  };
}

// Callable guard. Returns { uid, email, role, isSuperAdmin, factor, mfaSatisfied }
// on success; throws HttpsError otherwise. Runs the shared verified/active check
// first so a suspended or unverified admin is stopped exactly as elsewhere.
async function requireAdminMfa(request, { requireSuperAdmin = false, enforcement = currentEnforcement() } = {}) {
  await assertVerifiedAuth(request);
  const token = request.auth && request.auth.token;
  const uid = request.auth && request.auth.uid;
  // Only pay for the Firestore role read when the token doesn't already prove
  // admin (post claim-sync, that read never happens).
  const firestoreRole = tokenIsAdmin(token) ? null : await readFirestoreRole(uid);
  const decision = evaluateAdminMfa(token, { requireSuperAdmin, firestoreRole });

  if (decision.ok) return successShape(token, uid, decision);

  // Only the missing-second-factor case is affected by enforcement mode.
  // not-admin / not-super-admin / unauthenticated always throw.
  if (decision.reason === "admin-mfa-required") {
    if (enforcement === "monitor") {
      console.warn("[requireAdminMfa] monitor mode: admin without MFA allowed", uid);
      await writeSecurityAudit({
        eventType: SECURITY_EVENTS.ADMIN_ACCESS_DENIED_NO_MFA,
        actorUid: uid,
        actorRole: tokenIsSuperAdmin(token) ? "superAdmin" : "admin",
        outcome: "monitor",
        reason: "monitor-mode-allow",
        ...requestMetaFrom(request),
      });
      // Allowed through, but the caller can see MFA was not actually satisfied.
      return { ...successShape(token, uid, { ...decision, ok: false }), mfaSatisfied: false, monitored: true };
    }
    await writeSecurityAudit({
      eventType: SECURITY_EVENTS.ADMIN_ACCESS_DENIED_NO_MFA,
      actorUid: uid,
      actorRole: tokenIsSuperAdmin(token) ? "superAdmin" : "admin",
      outcome: "denied",
      reason: "admin-mfa-required",
      ...requestMetaFrom(request),
    });
  }
  throw toHttpsError(decision);
}

// HTTP variant for onRequest endpoints, applied to a decoded verifyIdToken()
// result. Same success shape + enforcement handling (minus the callable-only
// request metadata).
async function requireAdminMfaDecoded(decoded, { requireSuperAdmin = false, enforcement = currentEnforcement() } = {}) {
  await assertDecodedVerified(decoded);
  const decision = evaluateAdminMfa(decoded, { requireSuperAdmin });
  if (decision.ok) return successShape(decoded, decoded.uid, decision);
  if (decision.reason === "admin-mfa-required") {
    if (enforcement === "monitor") {
      await writeSecurityAudit({
        eventType: SECURITY_EVENTS.ADMIN_ACCESS_DENIED_NO_MFA,
        actorUid: decoded.uid,
        outcome: "monitor",
        reason: "monitor-mode-allow",
      });
      return { ...successShape(decoded, decoded.uid, { ...decision, ok: false }), mfaSatisfied: false, monitored: true };
    }
    await writeSecurityAudit({
      eventType: SECURITY_EVENTS.ADMIN_ACCESS_DENIED_NO_MFA,
      actorUid: decoded.uid,
      outcome: "denied",
      reason: "admin-mfa-required",
    });
  }
  throw toHttpsError(decision);
}

// Lightweight second-factor gate for callables that ALREADY confirm the caller
// is an admin their own way (e.g. an inline `role !== 'admin'` check). Enforces
// only the MFA-evidence requirement + rollout enforcement mode, so it composes
// with existing admin gating without a second Firestore role read. Returns true
// when MFA is present, false when allowed-through under monitor mode; throws
// failed-precondition when enforced and MFA is absent.
async function assertAdminSecondFactor(request, { actorRole = "admin", enforcement = currentEnforcement() } = {}) {
  const token = request.auth && request.auth.token;
  const uid = request.auth && request.auth.uid;
  if (tokenHasSecondFactor(token)) return true;
  if (enforcement === "monitor") {
    await writeSecurityAudit({
      eventType: SECURITY_EVENTS.ADMIN_ACCESS_DENIED_NO_MFA,
      actorUid: uid,
      actorRole,
      outcome: "monitor",
      reason: "monitor-mode-allow",
      ...requestMetaFrom(request),
    });
    return false;
  }
  await writeSecurityAudit({
    eventType: SECURITY_EVENTS.ADMIN_ACCESS_DENIED_NO_MFA,
    actorUid: uid,
    actorRole,
    outcome: "denied",
    reason: "admin-mfa-required",
    ...requestMetaFrom(request),
  });
  throw new HttpsError(
    "failed-precondition",
    "Multi-factor authentication is required for administrator actions.",
    { reason: "admin-mfa-required" },
  );
}

module.exports = {
  requireAdminMfa,
  requireAdminMfaDecoded,
  assertAdminSecondFactor,
  currentEnforcement,
  // re-exported for callers that only need the boolean predicates
  tokenIsAdmin,
  tokenIsSuperAdmin,
};
