/**
 * Pure, dependency-free decision logic for admin BOOTSTRAP — the question
 * "should this brand-new account be born an administrator?".
 *
 * Split out of index.js (which needs firebase-functions/firebase-admin) so
 * these predicates run under plain `node` in tests, following the same
 * *Core.js pattern as requireAdminMfaCore.js and metaWhatsAppCore.js.
 *
 * THE RULE, and why it is not just "is the address in ADMIN_EMAILS":
 *
 * `createUserWithEmailAndPassword` asks for no proof that the caller owns the
 * address they register. ADMIN_EMAILS lives in a committed file, so every
 * address in it is public. If an address in the allowlist has no Firebase Auth
 * account behind it, a stranger can register it — and before this gate that
 * alone minted `role: 'admin'`, with no mail from us ever read and no
 * verification link ever clicked.
 *
 * Two independent things must therefore be true:
 *   1. the address is on the allowlist, AND
 *   2. the address has been PROVEN — Auth reports emailVerified.
 *
 * Google (and other federated) sign-in arrives with emailVerified already
 * true, so the ordinary admin path is untouched. An email/password admin
 * enrols through scripts/grant-superadmin.mjs, which promotes an account that
 * demonstrably exists rather than granting one that might not.
 *
 * Fail closed everywhere: a missing, non-boolean or merely truthy
 * `emailVerified` is not proof.
 */

const ELEVATED_ROLES = Object.freeze(["admin", "superAdmin"]);

/**
 * Split the ADMIN_EMAILS allowlist into normalized addresses.
 * @param {string} raw
 * @returns {string[]}
 */
function parseAdminBootstrapEmails(raw) {
  return String(raw || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Is this address allowed to bootstrap as an admin, given proof of ownership?
 * @param {Object} args
 * @param {string} args.email
 * @param {boolean} args.emailVerified
 * @param {string[]} args.adminEmails  already-parsed allowlist
 * @returns {boolean}
 */
function isAdminBootstrapEligible({email, emailVerified, adminEmails = []}) {
  if (emailVerified !== true) return false;
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  return adminEmails.includes(normalized);
}

/**
 * The role a brand-new account starts with.
 * @param {Object} args
 * @param {string} args.email
 * @param {boolean} args.emailVerified
 * @param {string[]} args.adminEmails
 * @returns {"admin"|"learner"}
 */
function resolveInitialRole({email, emailVerified, adminEmails = []}) {
  return isAdminBootstrapEligible({email, emailVerified, adminEmails}) ?
    "admin" :
    "learner";
}

/**
 * The role bootstrapUserProfile writes when repairing a missing profile.
 *
 * This one carries the sharper risk of the two, for reasons that are not
 * visible from the call site:
 *   - the profile is written with the ADMIN SDK, so the users create rule's
 *     `role in ['learner','teacher']` pin never runs; and
 *   - the callable is deliberately exempt from assertVerifiedAuth (it exists
 *     to repair a profile BEFORE verification — see functions/authGuard.js),
 *     so an unverified caller genuinely reaches it.
 * An elevated `role` claim is therefore accepted here only alongside proof of
 * the address; otherwise the account falls back to the ordinary initial role.
 *
 * @param {Object} args
 * @param {string} args.tokenRole    the `role` custom claim on the caller
 * @param {string} args.email
 * @param {boolean} args.emailVerified
 * @param {string[]} args.adminEmails
 * @returns {string}
 */
function resolveBootstrapProfileRole({
  tokenRole,
  email,
  emailVerified,
  adminEmails = [],
}) {
  const elevated = ELEVATED_ROLES.includes(tokenRole);
  if (elevated && emailVerified === true) return tokenRole;
  return resolveInitialRole({email, emailVerified, adminEmails});
}

module.exports = {
  ELEVATED_ROLES,
  parseAdminBootstrapEmails,
  isAdminBootstrapEligible,
  resolveInitialRole,
  resolveBootstrapProfileRole,
};
