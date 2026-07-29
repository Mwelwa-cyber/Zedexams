"use strict";

// Validation + normalisation for the PUBLIC account-deletion request form
// (zedexams.com/delete-account → apiRequestAccountDeletion).
//
// Google Play's Data deletion policy requires a route to deletion that does
// NOT require opening the app — for someone who has lost their password, lost
// the device, or is a parent acting for a child. That route is by definition
// unauthenticated, which is exactly why this endpoint does not delete
// anything: it records a request that a human verifies before the real,
// irreversible purge runs through the existing `deleteMyAccount` path.
//
// The security posture that follows from "unauthenticated":
//   • Submitting a request must reveal NOTHING about whether the address has
//     an account. The endpoint's response is identical either way — otherwise
//     the form is an account-enumeration oracle for the whole user base.
//   • The stored record is a claim, not a fact. Nothing downstream may treat
//     `email` as verified; the support workflow verifies it out of band.
//   • Free-text fields are attacker-controlled and are read by staff in an
//     admin UI, so they are length-capped and stripped of control characters
//     here rather than at the point of display.
//
// Pure module — no firebase-admin, no firebase-functions, no I/O — so it runs
// under plain `node` in the repo's default test suite (same pattern as
// functions/cors.js and functions/aiPromptPolicy.js).

// Caps chosen to be generous for a real person and useless as a payload
// vector. `details` is the only field where someone legitimately writes prose.
const LIMITS = Object.freeze({
  email: 254, // RFC 5321 maximum
  name: 200,
  role: 40,
  details: 1000,
  source: 60,
});

// The account types the form offers. An unrecognised value is normalised to
// "other" rather than rejected: the requester's self-classification is a hint
// for support, never a gate, and a stale cached page must not be a 400.
const ROLES = Object.freeze([
  "learner",
  "teacher",
  "parent_guardian",
  "other",
]);

// Deliberately permissive: this is a shape check, not an attempt to decide
// whether an address is deliverable. Rejecting a valid-but-unusual address
// would deny someone the deletion route Play requires, which is a worse
// failure than accepting one that support later cannot verify.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Strip C0/C1 control characters (including the ANSI escapes and the CR/LF
// that would let a submission forge extra lines in an ops alert email) but
// keep ordinary punctuation and non-Latin scripts intact.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

function clean(value, max) {
  if (value === null || value === undefined) return "";
  return String(value).replace(CONTROL_CHARS, " ").trim().slice(0, max);
}

/**
 * Validate + normalise a submission from the public deletion form.
 *
 * @param {object} body  Parsed JSON request body (untrusted).
 * @return {{ok: true, value: object}|{ok: false, error: string, field: string}}
 */
function normalizeDeletionRequest(body) {
  const raw = body && typeof body === "object" ? body : {};

  const email = clean(raw.email, LIMITS.email).toLowerCase();
  if (!email) {
    return {ok: false, field: "email", error: "Enter the email address on the account."};
  }
  if (!EMAIL_RE.test(email)) {
    return {ok: false, field: "email", error: "That doesn't look like an email address."};
  }

  const role = clean(raw.role, LIMITS.role).toLowerCase();

  // `confirmed` is the "I understand this is permanent" checkbox. It is
  // enforced server-side as well as in the form because the endpoint is
  // public: a request that arrives without it did not come from someone who
  // read what they were agreeing to.
  if (raw.confirmed !== true) {
    return {
      ok: false,
      field: "confirmed",
      error: "Please confirm you understand the deletion is permanent.",
    };
  }

  return {
    ok: true,
    value: {
      email,
      name: clean(raw.name, LIMITS.name),
      role: ROLES.includes(role) ? role : "other",
      details: clean(raw.details, LIMITS.details),
      source: clean(raw.source, LIMITS.source) || "web",
      status: "pending",
      // Recorded so nothing downstream mistakes a self-asserted address for a
      // verified one. Support flips this after identity checks; the purge is
      // driven by the Auth user, never by this document.
      emailVerified: false,
    },
  };
}

/**
 * The response body sent for EVERY well-formed submission, whether or not an
 * account exists. Kept in one place so a future "helpful" branch that says
 * "no account found" has to delete this comment to do it: that message would
 * turn the form into an account-enumeration oracle.
 */
function acknowledgement() {
  return {
    ok: true,
    message:
      "Request received. If an account exists for that address, we'll verify " +
      "your identity and complete the deletion within 7 days.",
  };
}

module.exports = {
  LIMITS,
  ROLES,
  EMAIL_RE,
  clean,
  normalizeDeletionRequest,
  acknowledgement,
};
