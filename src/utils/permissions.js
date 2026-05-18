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
