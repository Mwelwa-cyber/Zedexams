/**
 * The v1 auth `onCreate` handler body for `setUserRole`, extracted from
 * `functions/index.js` (Phase 5, batch 1b — docs/phase5-plan.md).
 *
 * Isolated from the rest of batch 1b, and from batch 1a's shape, for one
 * reason: this is the only export in batch 1 that ASSIGNS A ROLE, and it does
 * so through the v1 `functions.auth.user().onCreate` chain rather than a v2
 * builder with an options object. Two things therefore have to be true and
 * separately checkable — the chain still says `onCreate` (an `onDelete` here
 * would silently stop new users getting roles and instead run at deletion,
 * which the manifest guard now records the exact chain to prevent), and the
 * default-role decision is untouched.
 *
 * The body is byte-identical to the one it replaces, including the two
 * comments that explain WHY `emailVerified` is passed — that argument is the
 * thing standing between `ADMIN_EMAILS` and anyone who registers the address
 * first (AUTH-L6), and it must not be lost in a move.
 */
const admin = require("firebase-admin");

/**
 * `resolveInitialUserRole` is INJECTED, not imported: it lives in index.js
 * beside the ADMIN_EMAILS parsing it reads, and moving it is an
 * authorization-surface change, not a mechanical one.
 *
 * @param {{resolveInitialUserRole: Function}} deps
 */
function buildUserRoleTrigger({resolveInitialUserRole}) {
  return async function handleUserCreated(user) {
    // emailVerified is true here for federated sign-in (Google has already
    // proven the address) and false for a fresh email/password signup, which has
    // proven nothing. Passing it is what stops an ADMIN_EMAILS entry with no
    // account behind it from being claimed by whoever registers it first.
    const role = resolveInitialUserRole(user.email || "", {
      emailVerified: user.emailVerified === true,
    });

    // Mint the role claim AND the boolean admin/superAdmin claims the MFA guard
    // reads (buildRoleClaims sets admin:true only for admin/superAdmin roles).
    const {buildRoleClaims} = require("../security/adminClaims");
    await admin.auth().setCustomUserClaims(user.uid, buildRoleClaims({}, role));

    return null;
  };
}

module.exports = {buildUserRoleTrigger};
