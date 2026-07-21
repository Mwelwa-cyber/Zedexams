// Pure, dependency-free decision logic for the administrator MFA guard.
//
// Split out of requireAdminMfa.js (which needs firebase-functions/firebase-admin)
// so these predicates run under plain `node` in tests. Everything here operates
// on a DECODED Firebase ID token object (request.auth.token for callables, or a
// verifyIdToken() result for HTTP endpoints) — never on raw strings.
//
// Two independent signals gate a privileged admin action:
//   1. the caller is an administrator (admin/superAdmin), and
//   2. the caller's CURRENT session was completed with a second factor.
//
// Signal 2 is the whole point of this feature: an admin who has enrolled TOTP
// but is somehow holding a token minted WITHOUT the second factor (an old
// pre-enrolment session, a token from a first-factor-only path) must still be
// rejected. Firebase stamps `firebase.sign_in_second_factor` on the ID token
// only when the sign-in actually resolved an MFA challenge, so it is the
// tamper-proof evidence — a client cannot forge it.

// Administrator detection. Accepts BOTH the boolean claims the task mandates
// (`admin === true` / `superAdmin === true`) AND the pre-existing string `role`
// claim (set at onCreate from ADMIN_EMAILS and by grant-superadmin.mjs) plus
// the `platformAdmin` break-glass claim, so existing admins are recognised
// before their claims are re-minted. Fail-closed: anything unrecognised → false.
function tokenIsAdmin(token) {
  if (!token || typeof token !== "object") return false;
  return (
    token.admin === true ||
    token.superAdmin === true ||
    token.platformAdmin === true ||
    token.role === "admin" ||
    token.role === "superAdmin"
  );
}

// Stricter check for actions reserved to super admins (e.g. resetting another
// admin's MFA). Boolean `superAdmin` claim OR the `role` claim.
function tokenIsSuperAdmin(token) {
  if (!token || typeof token !== "object") return false;
  return token.superAdmin === true || token.role === "superAdmin";
}

// Second-factor evidence. Firebase sets token.firebase.sign_in_second_factor to
// the factor type (e.g. "totp") ONLY for a session that completed an MFA
// challenge; it is absent/empty otherwise. Presence of any non-empty string is
// the signal. `sign_in_provider === 'custom'` (admin-minted custom tokens)
// never carries a second factor and is intentionally NOT treated as MFA.
function tokenHasSecondFactor(token) {
  const factor = token && token.firebase && token.firebase.sign_in_second_factor;
  return typeof factor === "string" && factor.length > 0;
}

// The factor type string, or null. Recorded (as coarse metadata) in the audit
// log — never anything sensitive.
function secondFactorType(token) {
  return tokenHasSecondFactor(token) ? token.firebase.sign_in_second_factor : null;
}

// Server-controlled enforcement mode (Phase 15 rollout safety). Secure by
// default: anything other than the explicit string "monitor" resolves to
// "enforce". "monitor" is the documented, temporary rollout stage — the guard
// still blocks non-admins and still records the MFA gap, but allows an admin
// whose session predates enrolment through so deploying the guards can't lock
// the team out before they enrol. Removing the env var returns to enforce; it
// is NOT a per-account or client-triggerable bypass.
function resolveEnforcement(envValue) {
  return String(envValue || "").trim().toLowerCase() === "monitor" ? "monitor" : "enforce";
}

// auth_time freshness. Firebase stamps `auth_time` (seconds since epoch) with
// the moment the FIRST factor completed for the current session. Used by the
// most destructive op (resetAdminMfa) to require reasonably recent
// authentication. now is injected for testability.
function authTimeAgeSeconds(token, now = Date.now()) {
  const authTime = token && Number(token.auth_time);
  if (!Number.isFinite(authTime) || authTime <= 0) return Infinity;
  return Math.max(0, Math.floor(now / 1000) - authTime);
}

function isRecentAuth(token, maxAgeSeconds, now = Date.now()) {
  return authTimeAgeSeconds(token, now) <= maxAgeSeconds;
}

// Single decision used by both callable and HTTP guards. Returns a plain object
// so the throwing wrappers can map `code` → HttpsError / HTTP status without
// duplicating the precedence logic. Precedence matters: unauthenticated is
// reported before not-admin, and not-admin before mfa-required, so we never
// leak "this is an admin account" to a non-admin caller.
// `firestoreRole` is an optional defence-in-depth fallback: when the token
// carries no admin claim (e.g. a legacy account promoted before claims were
// synced — docs AUTH-M4), the caller may pass the account's authoritative
// Firestore role so a real admin is not locked out while claim-sync propagates.
// It only ever GRANTS admin when the claim is missing; it never downgrades a
// token that already proves admin, and it is never used to satisfy the
// second-factor requirement (that is always token-only, and unforgeable).
function evaluateAdminMfa(token, { requireSuperAdmin = false, firestoreRole = null } = {}) {
  if (!token || typeof token !== "object") {
    return { ok: false, code: "unauthenticated", reason: "no-auth" };
  }
  const roleIsAdmin = firestoreRole === "admin" || firestoreRole === "superAdmin";
  const isAdmin = tokenIsAdmin(token) || roleIsAdmin;
  const isSuper = tokenIsSuperAdmin(token) || firestoreRole === "superAdmin";
  if (!isAdmin) {
    return { ok: false, code: "permission-denied", reason: "not-admin" };
  }
  if (requireSuperAdmin && !isSuper) {
    return { ok: false, code: "permission-denied", reason: "not-super-admin" };
  }
  if (!tokenHasSecondFactor(token)) {
    return { ok: false, code: "failed-precondition", reason: "admin-mfa-required" };
  }
  return {
    ok: true,
    reason: "ok",
    isSuperAdmin: isSuper,
    factor: secondFactorType(token),
  };
}

module.exports = {
  tokenIsAdmin,
  tokenIsSuperAdmin,
  tokenHasSecondFactor,
  secondFactorType,
  evaluateAdminMfa,
  resolveEnforcement,
  authTimeAgeSeconds,
  isRecentAuth,
};
