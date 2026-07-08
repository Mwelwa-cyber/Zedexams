/**
 * Family portal — pure helpers (no firebase-admin), so they unit-test under
 * plain `node`. The `*Core.js` split mirrors metaWhatsAppCore etc.
 *
 * A learner mints a short, human-friendly *family invite code*; a parent
 * account redeems it to create a `parentLinks/{parentUid}_{learnerUid}` doc —
 * the authorising link the portal reads through. Codes are separate from the
 * anonymous `progressShares` link tokens (that flow stays as-is).
 */

// No 0/O/1/I/L — codes get read aloud / written down during onboarding.
const FAMILY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const FAMILY_CODE_LENGTH = 8;
const FAMILY_CODE_TTL_DAYS = 60;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Canonicalise a user-typed code: uppercase, strip anything that isn't an
 * alphabet char (spaces, dashes, punctuation people add). Returns the cleaned
 * string — validity is a separate check so callers can tell "empty" from
 * "wrong length".
 */
function normalizeFamilyCode(input) {
  return String(input == null ? "" : input)
      .toUpperCase()
      .split("")
      .filter((ch) => FAMILY_CODE_ALPHABET.includes(ch))
      .join("");
}

/** True when a normalised code is exactly one well-formed family code. */
function isValidFamilyCode(code) {
  return typeof code === "string" && code.length === FAMILY_CODE_LENGTH;
}

/**
 * Generate a random code from an injected `randomBytes(n) => Uint8Array|Buffer`
 * (node:crypto in prod, a stub in tests). Uniform over the alphabet via modulo;
 * the alphabet length (30) divides evenly enough that the tiny bias is
 * irrelevant for a non-secret onboarding code.
 */
function randomFamilyCode(randomBytes) {
  const bytes = randomBytes(FAMILY_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < FAMILY_CODE_LENGTH; i += 1) {
    code += FAMILY_CODE_ALPHABET[bytes[i] % FAMILY_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Classify a code doc: 'invalid' (missing) | 'revoked' | 'expired' | 'ok'.
 * Accepts either a Firestore Timestamp (`expiresAt.toMillis()`) or a plain
 * `expiresAtMs` number so it works in both prod and node tests.
 */
function familyCodeStatus(codeDoc, nowMs) {
  if (!codeDoc) return "invalid";
  if (codeDoc.revokedAt) return "revoked";
  const expMs = codeDoc.expiresAt && typeof codeDoc.expiresAt.toMillis === "function"
      ? codeDoc.expiresAt.toMillis()
      : codeDoc.expiresAtMs;
  if (typeof expMs === "number" && expMs < nowMs) return "expired";
  return "ok";
}

/** Human-readable reason for a non-ok status, for the redeem error message. */
function familyCodeStatusMessage(status) {
  switch (status) {
    case "revoked": return "This family code has been turned off by the learner.";
    case "expired": return "This family code has expired. Ask the learner for a new one.";
    case "invalid": return "That family code is not valid. Check it and try again.";
    default: return "";
  }
}

/**
 * Deterministic link doc id so redeeming the same code twice is idempotent
 * (one parent ↔ one child = one link, no duplicates).
 */
function parentLinkId(parentUid, learnerUid) {
  return `${parentUid}_${learnerUid}`;
}

module.exports = {
  FAMILY_CODE_ALPHABET,
  FAMILY_CODE_LENGTH,
  FAMILY_CODE_TTL_DAYS,
  ONE_DAY_MS,
  normalizeFamilyCode,
  isValidFamilyCode,
  randomFamilyCode,
  familyCodeStatus,
  familyCodeStatusMessage,
  parentLinkId,
};
