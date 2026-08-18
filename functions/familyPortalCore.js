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
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * How long a family code stays redeemable.
 *
 * It was 60 DAYS. That is a standing credential, and what it grants is not
 * small: full visibility of a child's activity plus control over their
 * permissions. Eight characters from a 30-letter alphabet is ~48 bits, so
 * guessing is not the threat — the threat is the code itself outliving the
 * moment it was for. A child reads it out to a parent at a kitchen table;
 * two months later the screenshot is still on somebody's phone, the note
 * is still in a school exercise book, and the WhatsApp message is still in
 * a group chat.
 *
 * 48 hours covers "give it to my mum when she gets home" and expires
 * before the artefacts do. Regenerating is one tap and costs nothing, and
 * the code is now single-use anyway (see BURN below), so a longer window
 * buys the child nothing it does not already have.
 */
const FAMILY_CODE_TTL_HOURS = 48;

/**
 * A link's lifecycle.
 *
 * Redeeming a code no longer creates an ACTIVE link. It creates a PENDING
 * one, and the child has to say yes. The reason is that redeeming was the
 * whole check: anyone holding eight characters became a guardian with full
 * visibility, and the child — the person the data is about — found out by
 * noticing a new name in their settings, if they looked. Consent that the
 * subject is not asked for is not consent.
 *
 * `declined` is kept rather than deleted so a second attempt with the same
 * code cannot quietly succeed where the first was refused, and so a child
 * who declines has a record of having done so.
 */
const LINK_STATUS = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DECLINED: "declined",
});

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
  // Single-use, and checked BEFORE revoked/expired: burning a code sets
  // both `redeemedAt` and `revokedAt`, and "already used" is the honest
  // sentence for the second attempt. "Turned off by the learner" would
  // send a parent to ask their child why they had cut them off.
  if (isCodeSpent(codeDoc)) return "spent";
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
    case "spent": return "This family code has already been used. Ask the learner for a new one.";
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

/**
 * Does this link authorise anything yet?
 *
 * ── The one grandfathered case, and why ─────────────────────────────
 *
 * Links created before the confirmation step carry NO `status` field, and
 * they are treated as active. That is a deliberate exception to this
 * file's fail-closed habit. Those links were made by a parent redeeming a
 * code the child handed them, the child could already see and remove the
 * parent, and the parent has been reading reports for weeks. Reading
 * "absent" as "unconfirmed" would, on the deploy, cut off every real
 * family using the product and present each of them with a consent
 * request for a decision they made months ago — which teaches people to
 * click yes on consent prompts, the opposite of the point.
 *
 * Everything WRITTEN from now on carries an explicit status, so the
 * exception shrinks on its own and never applies to a new link.
 */
function isLinkActive(link) {
  if (!link || typeof link !== "object") return false;
  if (link.status === undefined || link.status === null) return true;
  return link.status === LINK_STATUS.ACTIVE;
}

/** Links a parent may act on. Pending and declined ones authorise nothing. */
function activeLinks(links) {
  return (Array.isArray(links) ? links : []).filter(isLinkActive);
}

/**
 * A code may be redeemed once. `redeemedCount` is the tally that existed
 * before and stays for the learner's own visibility; `redeemedAt` is what
 * BURNS it.
 *
 * Checked separately from `familyCodeStatus` so the message can say what
 * actually happened — "already used" is a different thing for a child to
 * hear than "expired", and the second sends them looking for a clock
 * problem.
 */
function isCodeSpent(codeDoc) {
  if (!codeDoc || typeof codeDoc !== "object") return false;
  return codeDoc.redeemedAt != null;
}

module.exports = {
  FAMILY_CODE_ALPHABET,
  FAMILY_CODE_LENGTH,
  FAMILY_CODE_TTL_HOURS,
  LINK_STATUS,
  ONE_DAY_MS,
  ONE_HOUR_MS,
  activeLinks,
  isCodeSpent,
  isLinkActive,
  normalizeFamilyCode,
  isValidFamilyCode,
  randomFamilyCode,
  familyCodeStatus,
  familyCodeStatusMessage,
  parentLinkId,
};
