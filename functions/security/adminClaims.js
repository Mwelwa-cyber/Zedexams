// Custom-claim management for administrator roles.
//
// Historically the `role` custom claim was minted once at onCreate and never
// re-synced (docs AUTH-M4): promoting a learner to admin updated only the
// Firestore `users.role` field, leaving the token claim stale. This module is
// the single place that keeps the Auth custom claims in step with a role
// change, and it additionally mints the boolean `admin` / `superAdmin` claims
// the MFA guard reads.
//
// buildRoleClaims is pure (node-testable); syncUserRoleClaims performs the
// Admin SDK round-trip. Callers that change a role MUST also revoke refresh
// tokens so the new claims take effect on the user's next token refresh rather
// than up to an hour later.

const admin = require("firebase-admin");

// Produce the next custom-claim bag for `role`, preserving any unrelated claims
// (e.g. platformAdmin) already on the account. Clears stale admin flags first so
// a demotion (admin → teacher) actually strips `admin`/`superAdmin`.
//
// - superAdmin → { role, superAdmin: true, admin: true }
// - admin      → { role, admin: true }
// - anything else (teacher/learner/parent) → { role } with no admin flags
function buildRoleClaims(existingClaims, role) {
  const base = { ...(existingClaims || {}) };
  delete base.admin;
  delete base.superAdmin;
  base.role = role;
  if (role === "superAdmin") {
    base.superAdmin = true;
    base.admin = true;
  } else if (role === "admin") {
    base.admin = true;
  }
  return base;
}

// Read the account's current claims, merge in the role-derived claims, write
// them back. Returns the claim bag that was written. Does NOT revoke tokens —
// the caller decides (role changes and MFA resets both should).
async function syncUserRoleClaims(uid, role) {
  const user = await admin.auth().getUser(uid);
  const next = buildRoleClaims(user.customClaims, role);
  await admin.auth().setCustomUserClaims(uid, next);
  return next;
}

module.exports = { buildRoleClaims, syncUserRoleClaims };
