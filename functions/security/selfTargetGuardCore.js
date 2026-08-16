/**
 * Pure, dependency-free decision logic for SELF-TARGETING — the question
 * "is this admin aiming a privileged user-management action at their own
 * account?".
 *
 * Split out of adminUsers.js (which needs firebase-functions/firebase-admin)
 * so the predicate runs under plain `node` in tests, following the same
 * *Core.js pattern as adminBootstrapCore.js and requireAdminMfaCore.js.
 *
 * WHY THIS EXISTS — the rule was real but lived only in the browser.
 *
 * `AdminUserProfile` has always refused it: its `isSelf` disables the status
 * buttons AND the role buttons, under a banner reading "This is your own
 * account. Status and role changes are disabled here — ask another admin if
 * you need them." PaymentsPanel grew a role editor later and was brought into
 * line in #2403. Both of those are UI.
 *
 * The server enforced neither. `adminSetUserRole` and `adminSetUserStatus`
 * derive `actor` from the authenticated caller and use it for the audit log
 * and the security ledger — never to compare against the target uid. So a
 * stale client, a direct callable invocation, or anything that skips the
 * screen could still do what the screen refuses.
 *
 * WHY IT MATTERS MORE THAN AN INCONSISTENCY. Both callables revoke the
 * TARGET's refresh tokens, and the target is you:
 *
 *   - Self-demotion signs you out INTO the role you just demoted yourself to.
 *   - Self-suspend is the same door: `requireAdminMfa` runs `assertVerifiedAuth`
 *     first, which refuses a suspended account, so every later admin call is
 *     turned away at the guard.
 *
 * Neither has a way back. `platformAdmin` — the break-glass claim both rules
 * files name — is SEC-002: no function mints it. With one admin on the
 * project, one such call is a locked-out platform.
 *
 * WHAT IS DELIBERATELY *NOT* HERE: normalization. The target string is used
 * verbatim as the Firestore document path (`users/${uid}`) and as the argument
 * to `syncUserRoleClaims`, so a uid that differs from the actor's by so much
 * as a trailing space addresses a DIFFERENT document — there is no variant
 * spelling that both evades a strict comparison and still lands on the
 * caller's own account. Trimming or lowercasing here would not close a gap;
 * it would invent matches between two genuinely different users.
 */

/**
 * The refusal wording, kept in one place so both callables say the same thing
 * and both echo the UI: name what was refused, then name the way forward.
 * A message that only says "denied" leaves the one remaining admin guessing
 * whether the platform is broken.
 */
const SELF_TARGET_MESSAGES = Object.freeze({
  role: "You can't change your own role. Ask another admin.",
  status: "You can't change your own account status. Ask another admin.",
});

/**
 * Is this request aimed at the caller's own account?
 *
 * @param {string} actorUid  uid of the authenticated caller.
 * @param {*} targetUid      uid the request wants to act on (untrusted input).
 * @returns {boolean} true when the request targets the caller.
 * @throws {TypeError} when actorUid is absent.
 *
 * The throw is the fail-closed half. Returning "not self" for a missing actor
 * would mean a guard that silently permits everything the moment the caller's
 * uid stops being passed — a rename, a refactor, a changed auth helper — and
 * it would permit it quietly, which is the only way a guard like this ever
 * fails. Reaching this function without an actor is a wiring bug, so it is
 * raised as one rather than answered.
 */
function isSelfTargeted(actorUid, targetUid) {
  if (typeof actorUid !== "string" || actorUid === "") {
    throw new TypeError(
      "isSelfTargeted: actorUid is required — the caller must be authenticated before this guard runs.",
    );
  }
  // An absent or non-string target cannot be the caller's own account. The
  // callables reject it separately with invalid-argument; answering "not
  // self" here keeps this predicate to one question.
  if (typeof targetUid !== "string" || targetUid === "") return false;
  return actorUid === targetUid;
}

module.exports = {isSelfTargeted, SELF_TARGET_MESSAGES};
