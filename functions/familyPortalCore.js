/**
 * Family portal — pure helpers (no firebase-admin), so they unit-test under
 * plain `node`. The `*Core.js` split mirrors metaWhatsAppCore etc.
 *
 * A learner mints a short, human-friendly *family invite code*; a parent
 * account redeems it to create a `parentLinks/{parentUid}_{learnerUid}` doc —
 * the authorising link the portal reads through. Codes are separate from the
 * anonymous `progressShares` link tokens (that flow stays as-is).
 *
 * ── What a family code is, and what it therefore has to be ───────────────
 *
 * Typing one gives an adult standing visibility over a child's progress and
 * the power to set what that child may use. That is a CREDENTIAL, and it was
 * being treated as an onboarding convenience: eight characters, valid sixty
 * days, reusable without limit, and linking the moment it was typed. A code
 * read aloud in a classroom, screenshotted, or handed to the wrong adult was
 * a two-month standing grant that the child was never asked about.
 *
 * Four changes, each closing one of those:
 *
 *   1. SINGLE-USE. The code burns on the redeem that creates a link, so a
 *      code that has been seen by more people than intended is spent rather
 *      than standing. `redeemedCount` stays, as history.
 *   2. SHORT-LIVED. 48 hours, not 60 days — long enough that a parent in
 *      another town can act on it the next evening, short enough that a code
 *      on a whiteboard is worthless by the weekend. Regenerable by the child
 *      on demand, which is what makes the short window affordable.
 *   3. THE CHILD CONFIRMS. Redeeming creates a link in `pending`, and the
 *      child is asked "<Name> wants to be your guardian — is this your
 *      grown-up?". Nothing is visible to the adult until they say yes. This
 *      is the real defence against a code reaching the wrong person, because
 *      it is the only step that involves the one human who knows the answer.
 *   4. RATE-LIMITED, per account and per IP, so codes cannot be ground out.
 *
 * The alphabet is unchanged: codes are still read aloud and written down, and
 * making them longer or case-sensitive would trade a real usability cost for
 * an imaginary security gain — 30^8 is 6.5×10^11, which was never the weak
 * part of this.
 */

// No 0/O/1/I/L — codes get read aloud / written down during onboarding.
const FAMILY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const FAMILY_CODE_LENGTH = 8;

/**
 * How long a code lives. 48 hours — the top of the 24–48h range, because a
 * Zambian parent may be in another town and a code that dies overnight would
 * push families onto the "just regenerate it again" treadmill, which is how a
 * short expiry turns into a long one in practice.
 */
const FAMILY_CODE_TTL_HOURS = 48;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/** Retained for callers that still compute in days; 48h expressed as days. */
const FAMILY_CODE_TTL_DAYS = FAMILY_CODE_TTL_HOURS / 24;

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
 * irrelevant for a code that is single-use, 48-hour, rate-limited and confirmed
 * by the child before it grants anything.
 */
function randomFamilyCode(randomBytes) {
  const bytes = randomBytes(FAMILY_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < FAMILY_CODE_LENGTH; i += 1) {
    code += FAMILY_CODE_ALPHABET[bytes[i] % FAMILY_CODE_ALPHABET.length];
  }
  return code;
}

/** Millis from a Firestore Timestamp, a Date, an ISO string or a number. */
function readMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Classify a code doc: 'invalid' | 'revoked' | 'used' | 'expired' | 'ok'.
 *
 * Order matters and is not arbitrary. `revoked` is checked first because it
 * is the child's own act and they are owed the truthful reason; `used` before
 * `expired` because a spent code is spent whatever the clock says, and telling
 * a parent "expired" about a code somebody already redeemed would send them
 * back to the child for a replacement they do not need.
 *
 * A code with no readable expiry is `expired`, not `ok`. This is the one
 * place a fail-open would be silent: an unreadable timestamp is exactly what a
 * corrupt or hand-edited document looks like, and reading it as "no expiry"
 * would make it a permanent credential.
 *
 * Accepts either a Firestore Timestamp (`expiresAt.toMillis()`) or a plain
 * `expiresAtMs` number so it works in both prod and node tests.
 */
function familyCodeStatus(codeDoc, nowMs) {
  if (!codeDoc) return "invalid";
  if (codeDoc.revokedAt) return "revoked";
  if (codeDoc.usedAt) return "used";
  const expMs = readMillis(codeDoc.expiresAt) ?? readMillis(codeDoc.expiresAtMs);
  if (expMs == null) return "expired";
  if (expMs < nowMs) return "expired";
  return "ok";
}

/** Human-readable reason for a non-ok status, for the redeem error message. */
function familyCodeStatusMessage(status) {
  switch (status) {
    case "revoked": return "This family code has been turned off by the learner.";
    case "used": return "This family code has already been used. Ask the learner for a new one.";
    case "expired": return "This family code has expired. Ask the learner for a new one.";
    case "invalid": return "That family code is not valid. Check it and try again.";
    default: return "";
  }
}

/**
 * Whether a code the learner is looking at is still worth showing as live,
 * and the sentence to show beside it. The learner's panel needs the same
 * classification the redeem path uses — a code shown as active that the
 * callable would refuse is how a child ends up reading a dead code down a
 * phone line.
 */
function describeCodeForLearner(codeDoc, nowMs) {
  const status = familyCodeStatus(codeDoc, nowMs);
  if (status === "ok") {
    const expMs = readMillis(codeDoc.expiresAt) ?? readMillis(codeDoc.expiresAtMs);
    const hoursLeft = Math.max(0, Math.ceil((expMs - nowMs) / ONE_HOUR_MS));
    return {
      status,
      live: true,
      message: hoursLeft <= 1
        ? "Expires in less than an hour"
        : `Expires in ${hoursLeft} hours`,
    };
  }
  return {
    status,
    live: false,
    message: status === "used"
      ? "Used — make a new one if you need to link another grown-up"
      : familyCodeStatusMessage(status),
  };
}

/**
 * Deterministic link doc id so redeeming twice is idempotent
 * (one parent ↔ one child = one link, no duplicates).
 */
function parentLinkId(parentUid, learnerUid) {
  return `${parentUid}_${learnerUid}`;
}

module.exports = {
  FAMILY_CODE_ALPHABET,
  FAMILY_CODE_LENGTH,
  FAMILY_CODE_TTL_HOURS,
  FAMILY_CODE_TTL_DAYS,
  ONE_HOUR_MS,
  ONE_DAY_MS,
  normalizeFamilyCode,
  isValidFamilyCode,
  randomFamilyCode,
  readMillis,
  familyCodeStatus,
  familyCodeStatusMessage,
  describeCodeForLearner,
  parentLinkId,
};
