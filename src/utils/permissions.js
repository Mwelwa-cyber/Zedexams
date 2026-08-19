// Central authority for admin / super-admin access checks.
//
// Every admin gate in the app should funnel through isSuperAdmin() instead
// of re-deriving `role === 'admin'` inline. Both the legacy 'admin' role and
// the new 'superAdmin' role get full, unlimited, premium access to every
// portal (learner / teacher / admin) and bypass subscription, daily-limit,
// grade, and subject restrictions.
//
// Kept dependency-free on purpose so subscriptionConfig.js (and anything
// else low in the import graph) can import it without a cycle.

export const SUPER_ADMIN_ROLES = Object.freeze(['admin', 'superAdmin'])

// ── What counts as a learner ────────────────────────────────────────────
//
// 'student' is the legacy spelling. Nothing writes it any more (registration
// has written 'learner' for a long time), but the admin console counts it in
// four places, so accounts carrying it are expected to exist.
//
// It had drifted into TWO answers. `getRoleLandingPath` accepted it and sent
// such an account to /dashboard; `AuthContext`'s `isLearner` did not, so
// `LearnerOnlyRoute` refused the very page the redirect had chosen. The two
// then handed the account back and forth: the refusal card's only button goes
// to '/', RootRedirect resolves '/' to /dashboard, and /dashboard renders the
// card again. A learner, locked out of the learner app, in a loop, being told
// their account "doesn't open the learner dashboard".
//
// The mirror image was worse and quieter: a PREMIUM legacy account took
// `LearnerOnlyRoute`'s portal-access branch instead, which returns children
// directly — so it never met `LearnerGradeGate` and got the learner app
// regardless of the Grade-7-only rollout.
//
// ── Scope, deliberately ─────────────────────────────────────────────────
//
// This answers "does this account use the learner portal", for ROUTING and
// portal access. It is NOT the vocabulary the server's consent gate uses:
// `functions/shared/consent/guardianConsentCore.js` keeps its own allow-list,
// which treats an unrecognised role as a minor with browse-only capabilities.
// That is a fail-closed default, and widening it would GRANT capabilities to
// accounts that do not hold them today — a consent decision, with a child's
// AI access behind it, not a routing one. Left alone on purpose.
export const LEARNER_ROLES = Object.freeze(['learner', 'student'])

// Accepts a user/profile object OR a bare role string, like isSuperAdmin.
export function isLearnerRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role
  return LEARNER_ROLES.includes(role)
}

// Accepts a user/profile object OR a bare role string.
export function isSuperAdmin(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role
  return role === 'admin' || role === 'superAdmin'
}

// Readability alias for call sites that just mean "is this an admin account".
export const isAdminRole = isSuperAdmin

// The canonical capability set an admin / super-admin account always has,
// regardless of what (if anything) is stored on the Firestore profile.
// Used by the gates and the admin debug panel so there is a single source
// of truth for "what can a super admin do".
export function adminPermissionFlags() {
  return {
    canAccessAllGrades: true,
    canAccessAllSubjects: true,
    canCreateContent: true,
    canPublishContent: true,
    canAssignQuizzes: true,
    canManageUsers: true,
    canViewReports: true,
  }
}

// Effective permission flags for any user: super admins always get the
// full set; everyone else keeps whatever their profile grants (defaulting
// to false). Never downgrades a flag a non-admin already has.
export function resolvePermissionFlags(userProfile) {
  const base = {
    canAccessAllGrades: userProfile?.canAccessAllGrades === true,
    canAccessAllSubjects: userProfile?.canAccessAllSubjects === true,
    canCreateContent: userProfile?.canCreateContent === true,
    canPublishContent: userProfile?.canPublishContent === true,
    canAssignQuizzes: userProfile?.canAssignQuizzes === true,
    canManageUsers: userProfile?.canManageUsers === true,
    canViewReports: userProfile?.canViewReports === true,
  }
  if (isSuperAdmin(userProfile)) return { ...base, ...adminPermissionFlags() }
  return base
}
