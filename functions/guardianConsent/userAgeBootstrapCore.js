"use strict";

/**
 * userAgeBootstrapCore — what the server corrects on a freshly created user.
 *
 * The client derives `isMinor` from the date of birth so it knows which screen
 * to show next. That derivation is a ROUTING decision and nothing more. The
 * value the account is actually governed by has to come from somewhere the
 * user cannot reach, because the entire guardian-consent gate reduces to that
 * one boolean: a client that could write `isMinor: false` next to a 2016
 * birthday would turn the age screen, the guardian email, the hashed consent
 * token and the limited-mode capability set into decoration.
 *
 * Firestore rules cannot do this. Writing "isMinor must agree with dob" in the
 * rules language means date arithmetic on a string, re-derived on every write,
 * and a birthday that silently changes an account's status as the clock passes
 * it. So the rules enforce what they are good at — a learner MUST carry a
 * `dob`, a teacher or parent must NOT — and the arithmetic happens here, once,
 * on document creation.
 *
 * Pure: given a user document, return the patch to apply (or null). No
 * Firestore, no clock of its own — the caller passes `now`, so the boundary
 * cases are testable rather than argued about.
 */

/**
 * @param {object} user   The users/{uid} document as written by the client.
 * @param {object} deps
 * @param {(dob: string, asOf: Date) => boolean} deps.requiresGuardianConsent
 *   From the shared consent core — the SAME function the client used, so the
 *   two can only disagree about the input, never about the rule.
 * @param {Date} [deps.now]
 * @return {object|null}  Fields to merge, or null when nothing needs fixing.
 */
function resolveAgeBootstrap(user, deps) {
  if (!user || typeof user !== "object") return null;
  const {requiresGuardianConsent, now = new Date()} = deps || {};
  if (typeof requiresGuardianConsent !== "function") {
    throw new TypeError("requiresGuardianConsent is required");
  }

  const role = typeof user.role === "string" ? user.role.trim() : "";

  // Non-learners are not asked their age and must not be carrying one. A
  // stale client — a cached bundle, an old Android build — can still send a
  // date long after the field stopped being collected, and a field nobody
  // reads is still a field we hold, declare and have to defend. Strip it.
  if (role !== "learner") {
    const patch = {};
    if (user.dob !== undefined && user.dob !== null) patch.dob = null;
    if (user.isMinor !== undefined && user.isMinor !== null) patch.isMinor = null;
    return Object.keys(patch).length ? patch : null;
  }

  // A learner document with NO `dob` field is left alone, and that is a
  // deliberate hole rather than an oversight. Only two things create one:
  // an account that predates the age screen, and `bootstrapUserProfile`
  // repairing a profile that went missing for someone who has been using the
  // app for months. Both are the `unknown` consent status — the migration
  // state, which resolveLearnerAccess treats permissively on purpose, because
  // restricting them means taking Ask Zed and classes away from the existing
  // learner base with no guardian ever having been asked. Deriving "no date,
  // therefore a child, therefore limited" here would do exactly that, to
  // every recovered profile, silently.
  //
  // The reason this hole is not a bypass: firestore.rules refuses to create a
  // learner document without a `dob`. Nothing a CLIENT can write reaches this
  // branch — only the admin SDK does, and it is not the party being guarded
  // against.
  if (typeof user.dob !== "string" || !user.dob.trim()) return null;

  // The authoritative derivation. An unreadable date resolves to `true`
  // inside requiresGuardianConsent — the safe reading of "we cannot tell how
  // old you are" in a product built for nine-year-olds.
  const minor = requiresGuardianConsent(user.dob, now) === true;
  const patch = {};

  if (user.isMinor !== minor) patch.isMinor = minor;

  // A minor with no guardian record at all is the dangerous shape, and it is
  // reachable: the client writes the pending record, but a tampered or
  // partial write need not. With no `guardian` object the consent status
  // resolves to `unknown`, which is the MIGRATION state — deliberately
  // permissive, so that accounts predating this flow were not locked out on
  // the deploy that introduced it. A brand-new account inheriting that grace
  // would get full capabilities on the strength of a missing field.
  if (minor && !isPendingGuardianRecord(user.guardian)) {
    patch.guardian = {
      contact: readContact(user.guardian),
      method: user.guardian && user.guardian.method === "whatsapp" ? "whatsapp" : "email",
      consentStatus: "pending",
    };
  }

  return Object.keys(patch).length ? patch : null;
}

/**
 * Does this account already carry a usable guardian record?
 *
 * `granted` and `denied` count — those are decisions a guardian made through
 * the server, and overwriting one with `pending` would revoke a real approval
 * (or quietly un-suspend an account a guardian asked us to close) every time
 * this trigger ran. Only the absent and the unrecognised are repaired.
 */
function isPendingGuardianRecord(guardian) {
  if (!guardian || typeof guardian !== "object") return false;
  const status = typeof guardian.consentStatus === "string" ? guardian.consentStatus.trim() : "";
  return ["pending", "granted", "denied", "expired"].includes(status);
}

function readContact(guardian) {
  if (!guardian || typeof guardian !== "object") return "";
  return typeof guardian.contact === "string" ? guardian.contact.trim().slice(0, 254) : "";
}

module.exports = {resolveAgeBootstrap, isPendingGuardianRecord};
