"use strict";

/**
 * functions/guardianZone/guardianZoneCore — the pure half of the Guardian Zone.
 *
 * Everything here is `crypto` and string work: no firebase-admin, no I/O, so
 * it tests under plain `node` (the *Core.js split this repo uses for
 * metaWhatsAppCore, autoLabelCore and the rest).
 *
 * The DECISIONS — what a control means, what a PIN is allowed to look like,
 * when the lockout bites — do not live here. They live in
 * functions/shared/consent/guardianControlsCore.js, because the React app
 * needs the same answers and a second copy is how the two drift. What lives
 * here is the part the browser must never do: hashing the PIN and minting the
 * setup code.
 *
 * ── Why the PIN is hashed at all ─────────────────────────────────────────
 *
 * It is four to six digits, so a hash of it is brute-forceable offline in
 * microseconds and nobody should pretend otherwise. It is hashed anyway, with
 * a per-account salt, for the reason the consent tokens are hashed: a support
 * export, a backup, or a screenshot of the Firestore console must not hand
 * over a working credential for a child's account. scrypt over sha256 because
 * the cost parameter is the only thing that makes the offline guess cost
 * anything at all, and a Guardian-Zone unlock happens a handful of times a
 * month — there is no throughput to protect.
 *
 * The real protection against guessing is the five-attempt lockout in the
 * shared core, which runs before this module is ever reached.
 */

const crypto = require("crypto");

// scrypt defaults: N=16384, r=8, p=1. ~50ms per hash on the Functions runtime.
const KEY_LEN = 32;
const SALT_BYTES = 16;

/** A fresh per-account salt, hex. */
function mintSalt() {
  return crypto.randomBytes(SALT_BYTES).toString("hex");
}

/**
 * Hash a PIN for storage.
 *
 * @param {string} pin
 * @param {string} salt  hex, from mintSalt()
 * @return {string} hex digest
 */
function hashPin(pin, salt) {
  return crypto
      .scryptSync(String(pin), String(salt), KEY_LEN)
      .toString("hex");
}

/**
 * Compare a supplied PIN against a stored hash.
 *
 * `timingSafeEqual` rather than `===`. The timing signal on a 6-digit secret
 * is not the attack anyone will actually run, but writing the comparison the
 * other way teaches the next reader that `===` is fine for secrets, and the
 * next secret may not be six digits.
 */
function verifyPin(pin, salt, expectedHex) {
  if (typeof expectedHex !== "string" || !expectedHex) return false;
  let actual;
  try {
    actual = Buffer.from(hashPin(pin, salt), "hex");
  } catch {
    return false;
  }
  let expected;
  try {
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * A 6-digit setup code, drawn from the CSPRNG.
 *
 * Rejection sampling rather than `% 1000000`: the modulo version makes the
 * low codes very slightly likelier, which is exactly the kind of thing that
 * is invisible, free to avoid, and embarrassing to explain later.
 */
function mintSetupCode() {
  const limit = 1000000;
  const max = Math.floor(0xffffffff / limit) * limit;
  let value;
  do {
    value = crypto.randomBytes(4).readUInt32BE(0);
  } while (value >= max);
  return String(value % limit).padStart(6, "0");
}

/**
 * The stored form of a setup code. Salted per issue, so two learners issued
 * the same six digits do not share a digest.
 */
function hashSetupCode(code, salt) {
  return crypto
      .createHmac("sha256", String(salt))
      .update(String(code))
      .digest("hex");
}

function verifySetupCode(code, salt, expectedHex) {
  if (typeof expectedHex !== "string" || !expectedHex) return false;
  const actual = Buffer.from(hashSetupCode(code, salt), "hex");
  let expected;
  try {
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * The email that carries the setup code to the guardian.
 *
 * Deliberately says what the code DOES and what it does not do. A parent who
 * reads "your code is 418293" with no context forwards it to the child who
 * asked for it; a parent who reads "this code lets you set the PIN that
 * protects the controls" does not.
 */
function buildPinSetupEmail({childName, code, ttlMinutes}) {
  const child = safeName(childName);
  const subject = `Your ZedExams Guardian Zone code: ${code}`;
  const text = [
    `Hello,`,
    ``,
    `You are set up as ${child}'s parent or guardian on ZedExams.`,
    ``,
    `Your code is: ${code}`,
    ``,
    `Use it in the app to choose a Guardian PIN. That PIN is what unlocks the`,
    `controls — Ask Zed, live challenges, and the daily time limit — so please`,
    `do not share the code or the PIN with ${child}.`,
    ``,
    `The code expires in ${ttlMinutes} minutes and can only be used once.`,
    ``,
    `If you did not ask for this, you can ignore this email — nothing changes`,
    `until the code is used. You can also review or withdraw your consent at`,
    `any time from the link we sent when the account was approved.`,
    ``,
    `— ZedExams`,
  ].join("\n");
  return {subject, text};
}

/**
 * A child's name, safe to put in an email body.
 *
 * Mirrors consentMessages.safeName: the name is learner-supplied text on its
 * way into a message we send to a third party, so it is trimmed, capped, and
 * stripped of anything that could restructure the message (a newline can
 * forge a header in some senders).
 */
function safeName(value) {
  const raw = typeof value === "string" ? value : "";
  const cleaned = raw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 60) || "your child";
}

module.exports = {
  mintSalt,
  hashPin,
  verifyPin,
  mintSetupCode,
  hashSetupCode,
  verifySetupCode,
  buildPinSetupEmail,
  safeName,
};
