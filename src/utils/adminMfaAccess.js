/**
 * src/utils/adminMfaAccess.js
 *
 * Pure decision logic for the mandatory-admin-MFA route guard. Kept free of
 * React/Firebase so the redirect rules are unit-tested directly (see
 * adminMfaAccess.spec.js) and shared by AdminRoute + the MFA setup page.
 *
 * The client route guard is UX only — the real boundary is Firestore rules +
 * the requireAdminMfa Cloud Function guard. This just decides where to send an
 * administrator so they can never reach an admin surface without first
 * enrolling MFA, without ever looping the setup page onto itself.
 */

export const MFA_SETUP_PATH = "/admin/security/mfa-setup";

/**
 * @param {object} s resolved auth state
 *   loading           — auth/profile still resolving
 *   hasUser           — a Firebase user exists
 *   isAdmin           — resolved admin/superAdmin
 *   mfaEnrolled       — Firebase Auth reports ≥1 enrolled factor
 *   isSetupRoute      — the current route IS the MFA setup page
 *   needsVerification — unverified email/password account (outside grace)
 *   profileIssue      — profile unreadable/missing
 * @returns {{action:string, to?:string, reason:string}}
 *   action: 'loading' | 'recovery' | 'allow' | 'redirect'
 *   to (for redirect): a path, or the sentinel 'role-landing' the caller maps
 *   to the user's own landing page.
 */
export function resolveAdminRouteAccess(s) {
  if (s.loading) return { action: "loading", reason: "loading" };
  if (!s.hasUser) return { action: "redirect", to: "/login", reason: "signed-out" };
  if (s.profileIssue) return { action: "recovery", reason: "profile-issue" };
  if (s.needsVerification) return { action: "redirect", to: "/verify-email", reason: "unverified" };
  if (!s.isAdmin) return { action: "redirect", to: "role-landing", reason: "not-admin" };

  // Administrator from here down.
  // The setup page itself is always reachable for an admin — otherwise a
  // not-yet-enrolled admin would be redirected to setup and then bounced off it,
  // an infinite loop. Enrolment happens here.
  if (s.isSetupRoute) return { action: "allow", reason: "setup" };
  if (!s.mfaEnrolled) return { action: "redirect", to: MFA_SETUP_PATH, reason: "mfa-required" };
  return { action: "allow", reason: "ok" };
}
