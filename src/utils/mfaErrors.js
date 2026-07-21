/**
 * src/utils/mfaErrors.js
 *
 * Centralised, user-facing copy for every multi-factor-authentication error a
 * ZedExams administrator can hit — during enrolment, during the login
 * challenge, and from the privileged Cloud Functions.
 *
 * Design mirrors friendlyErrors.js: PURE (no React/Firebase/import.meta), so it
 * unit-tests under plain `node` and imports anywhere. Every message is calm,
 * actionable, and NEVER echoes a raw Firebase string or reveals whether another
 * account exists.
 */

// Firebase Auth MFA error codes → friendly one-liners.
const MFA_AUTH_MESSAGES = Object.freeze({
  "auth/multi-factor-auth-required":
    "Enter the 6-digit code from your authenticator app to finish signing in.",
  // Firebase's canonical code is auth/multi-factor-info-not-found; the task's
  // shorthand auth/mfa-info-not-found is mapped to the same copy.
  "auth/multi-factor-info-not-found":
    "We couldn't find an authenticator set up for this account. Ask a super admin to reset your MFA.",
  "auth/mfa-info-not-found":
    "We couldn't find an authenticator set up for this account. Ask a super admin to reset your MFA.",
  "auth/invalid-verification-code":
    "That code isn't right. Check your authenticator app and enter the current 6-digit code.",
  "auth/code-expired":
    "That code has expired. Enter the new 6-digit code showing in your authenticator app.",
  "auth/requires-recent-login":
    "For your security, please sign in again before changing MFA settings.",
  "auth/too-many-requests":
    "Too many attempts. Please wait a few minutes before trying again.",
  "auth/network-request-failed":
    "We couldn't reach the server. Check your connection and try again.",
  "auth/user-token-expired":
    "Your session has expired. Please sign in again.",
  "auth/invalid-multi-factor-session":
    "This verification session has expired. Please start again.",
  "auth/second-factor-already-in-use":
    "This authenticator is already enrolled on the account.",
  "auth/maximum-second-factor-count-exceeded":
    "You've reached the maximum number of authenticators for this account.",
  "auth/unsupported-first-factor":
    "This sign-in method can't be secured with an authenticator app. Please contact support.",
  "auth/missing-multi-factor-session":
    "This verification session has expired. Please start again.",
  "auth/missing-multi-factor-info":
    "We couldn't find an authenticator to verify. Please start again.",
});

// Backend HttpsError reasons (details.reason) → friendly copy. Keyed by the
// reason we attach in functions/security/*.
const MFA_BACKEND_REASONS = Object.freeze({
  "admin-mfa-required":
    "Multi-factor authentication is required. Set up your authenticator app to continue.",
  "requires-recent-login":
    "Please sign in again (with your authenticator) before performing this sensitive action.",
  "self-reset-forbidden":
    "You can't reset your own MFA. Ask another super admin to do it for you.",
  "target-not-admin": "That account isn't an administrator.",
});

const DEFAULT_MESSAGE = "Something went wrong with multi-factor authentication. Please try again.";

/**
 * Map an error (Firebase Auth error, httpsCallable error, or a bare code
 * string) to a friendly sentence.
 *
 * @param {object|string} error
 * @param {object} [opts]
 *   fallback — copy when the code/reason is unmapped.
 * @returns {string}
 */
export function mfaErrorMessage(error, opts = {}) {
  const fallback = opts.fallback || DEFAULT_MESSAGE;
  if (!error) return fallback;
  const code = typeof error === "string" ? error : String(error.code || "");
  // Callable errors carry a details.reason we set server-side.
  const reason =
    (error && error.details && error.details.reason) ||
    (error && error.customData && error.customData.reason) ||
    "";

  if (reason && MFA_BACKEND_REASONS[reason]) return MFA_BACKEND_REASONS[reason];
  if (MFA_AUTH_MESSAGES[code]) return MFA_AUTH_MESSAGES[code];

  // httpsCallable codes look like `functions/failed-precondition`; a bare
  // failed-precondition with our reason is already handled above. Fall back to
  // the generic message rather than leaking the raw code.
  return fallback;
}

/**
 * True when an error signals that Firebase needs the second factor to complete
 * the current sign-in (the code the login flow branches on).
 */
export function isMfaRequiredError(error) {
  const code = typeof error === "string" ? error : String(error?.code || "");
  return code === "auth/multi-factor-auth-required";
}

/**
 * True when an operation needs a fresh sign-in first (reauth prompt).
 */
export function isRecentLoginError(error) {
  const code = typeof error === "string" ? error : String(error?.code || "");
  const reason = error?.details?.reason || "";
  return code === "auth/requires-recent-login" || reason === "requires-recent-login";
}

export const MFA_ERROR_MESSAGES = MFA_AUTH_MESSAGES;
export const MFA_BACKEND_MESSAGES = MFA_BACKEND_REASONS;
