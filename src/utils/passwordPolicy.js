/**
 * src/utils/passwordPolicy.js
 *
 * The ONE declaration of what a password may be. Every surface that lets
 * somebody choose a password reads it from here — sign-up, the reset-link
 * screen, the teacher's change-password card, and the admin's shared demo
 * password — so the four cannot drift into four different policies.
 *
 * Pure: no React, no DOM, no Firebase. Runs under plain `node`
 * (`npm run test:password-policy`).
 *
 * ─── Whitespace, and why the rule is asymmetric ───────────────────────
 *
 * An INTERIOR space is allowed on purpose. "my dog rex" is a passphrase, and
 * a passphrase is the strongest thing a learner will actually remember;
 * NIST SP 800-63B §5.1.1.2 requires accepting the space character for exactly
 * that reason. Banning it would push people back onto short single words,
 * which is a weaker policy, not a stricter one.
 *
 * A LEADING or TRAILING space is refused, because it is invisible and it
 * locks the account. Firebase Auth stores the password byte-for-byte, so
 * "Zambia2026 " and "Zambia2026" are two different credentials: an Android
 * keyboard that appends a space after an autocompleted word, or a paste that
 * carries one, mints an account whose owner can never type their way back in.
 * They see the password they meant, the sign-in fails, and nothing on the
 * screen can explain why. Refusing it at the one moment it is visible — while
 * the field still has focus and the eye toggle can reveal it — is the only
 * point at which that is fixable.
 *
 * The same argument covers whitespace that is not a plain space ANYWHERE in
 * the string: a tab, a newline, a non-breaking space (U+00A0, which iOS
 * autocorrect inserts and which no font distinguishes from U+0020), or a
 * zero-width character carried in by a paste. None of those is ever typed on
 * purpose and none can be seen once typed.
 *
 * ─── What this must NOT be wired into ────────────────────────────────
 *
 * SIGN-IN. Accounts already exist whose password has edge whitespace — they
 * were created before this file did. Validating, trimming or normalising the
 * password on the login form would lock those people out permanently, which
 * is the very failure this module exists to prevent. `Login.jsx` passes the
 * password through untouched, and it must stay that way.
 */

/** Firebase Auth's own floor is 6; nothing here may set a lower one. */
export const MIN_PASSWORD_LENGTH = 6

/** Machine-readable reasons, so a caller can branch without matching copy. */
export const PASSWORD_ISSUE = {
  EMPTY: 'empty',
  EDGE_WHITESPACE: 'edge_whitespace',
  HIDDEN_WHITESPACE: 'hidden_whitespace',
  TOO_SHORT: 'too_short',
}

/**
 * Whitespace that is not a plain U+0020 space. `[^\S ]` reads as "a character
 * that is not (a non-whitespace character or a space)" — i.e. \s minus the
 * space itself. It already covers tab, newline, carriage return, form feed,
 * vertical tab, NBSP (U+00A0), the U+2000–U+200A quad spaces, U+2028/U+2029,
 * U+202F, U+205F, U+3000 and the BOM (U+FEFF), all of which JavaScript counts
 * as \s. The second alternative adds the zero-width characters that are
 * invisible but NOT \s, so a paste cannot smuggle one past.
 */
const HIDDEN_WHITESPACE_RE = /[^\S ]|[\u200b-\u200d\u2060]/

/** A space (or any whitespace) at either end. */
const EDGE_WHITESPACE_RE = /^\s|\s$/

const MESSAGES = {
  // Same string the generic 'required' rule uses, so a learner never gets two
  // different sentences for one empty box.
  [PASSWORD_ISSUE.EMPTY]: 'Please enter your password.',
  [PASSWORD_ISSUE.EDGE_WHITESPACE]:
    'Your password cannot start or end with a space.',
  [PASSWORD_ISSUE.HIDDEN_WHITESPACE]:
    'Your password contains a character that cannot be seen. Please retype it rather than pasting it.',
  [PASSWORD_ISSUE.TOO_SHORT]: `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`,
}

/**
 * The first thing wrong with `value`, or `null` when it is acceptable.
 *
 * Order is deliberate: the invisible problems are reported BEFORE the length
 * one. When a password is both too short and space-padded, "too short" sends
 * the user off counting characters they can see while the real defect is the
 * one they cannot; naming the whitespace first is the only message that tells
 * them something they could not have worked out by looking.
 */
export function passwordIssueCode(value) {
  const str = typeof value === 'string' ? value : ''
  if (str.trim().length === 0) return PASSWORD_ISSUE.EMPTY
  if (EDGE_WHITESPACE_RE.test(str)) return PASSWORD_ISSUE.EDGE_WHITESPACE
  if (HIDDEN_WHITESPACE_RE.test(str)) return PASSWORD_ISSUE.HIDDEN_WHITESPACE
  if (str.length < MIN_PASSWORD_LENGTH) return PASSWORD_ISSUE.TOO_SHORT
  return null
}

/** The message a person reads, or '' when the password is acceptable. */
export function passwordIssue(value) {
  const code = passwordIssueCode(value)
  return code ? MESSAGES[code] : ''
}

/** Convenience predicate for callers that only need a yes/no. */
export function isAcceptablePassword(value) {
  return passwordIssueCode(value) === null
}
