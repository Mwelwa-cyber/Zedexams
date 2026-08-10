/**
 * src/utils/accountReauth.js
 *
 * Pure, dependency-free helpers for the re-authentication step that now guards
 * account deletion (LEGAL-003). The Firebase-touching wiring lives in
 * accountService.js; the *decisions* — which re-auth method an account needs,
 * whether the danger-zone button may fire, and how to phrase a failure — live
 * here so they unit-test under plain `node` with no Firebase / `import.meta`
 * dependency (the same split as mfaErrors.js / friendlyErrors.js).
 */

/**
 * Which credential a signed-in user must present to re-authenticate.
 *
 * An email+password account (`providerId === 'password'`) proves identity by
 * re-entering its password; every federated account (Google, …) re-auths
 * through a provider popup. The password provider wins when both are present.
 *
 * @param {Array<{providerId?: string}>} providerData  user.providerData
 * @returns {'password'|'oauth'}
 */
export function pickReauthMethod(providerData) {
  const list = Array.isArray(providerData) ? providerData : []
  const hasPassword = list.some((p) => p && p.providerId === 'password')
  return hasPassword ? 'password' : 'oauth'
}

/**
 * Whether the "Permanently delete" action may fire.
 *
 * `confirmed` is the panel's own intent gate (e.g. the user typed DELETE, or a
 * plain confirm click). A password account additionally needs a non-empty
 * password so we can re-authenticate before the irreversible call.
 *
 * @param {object} args
 * @param {'password'|'oauth'} args.method
 * @param {string} [args.password]
 * @param {boolean} args.confirmed
 * @returns {boolean}
 */
export function canSubmitDeletion({ method, password, confirmed } = {}) {
  if (!confirmed) return false
  if (method === 'password') return String(password || '').length > 0
  return true
}

// Firebase Auth codes / backend reasons → calm, actionable copy. Never echoes
// a raw Firebase string and never reveals whether another account exists.
const REAUTH_MESSAGES = Object.freeze({
  // Wrong password on the re-auth step.
  'auth/wrong-password': 'That password is incorrect. Please try again.',
  'auth/invalid-credential': 'That password is incorrect. Please try again.',
  'auth/invalid-login-credentials': 'That password is incorrect. Please try again.',
  // We asked for a password but none was supplied.
  'account/password-required': 'Please enter your password to confirm.',
  // No live session to re-authenticate.
  'account/not-signed-in': 'Please sign in again to delete your account.',
  // Rate limited (Firebase-side or our own resource-exhausted burst guard).
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  // Federated popup cancelled / blocked.
  'auth/popup-closed-by-user': 'The confirmation was cancelled. Please try again.',
  'auth/cancelled-popup-request': 'The confirmation was cancelled. Please try again.',
  'auth/user-cancelled': 'The confirmation was cancelled. Please try again.',
  'auth/popup-blocked':
    'Your browser blocked the confirmation popup. Please allow popups and try again.',
  // Network.
  'auth/network-request-failed':
    "We couldn't reach the server. Check your connection and try again.",
  // Popup-based re-auth isn't possible here (e.g. the Android app shell) — the
  // universal fallback is a fresh sign-in, which refreshes the login time.
  'auth/operation-not-supported-in-this-environment':
    'To delete your account, please sign out and sign in again, then try once more.',
  'auth/google-no-id-token':
    'To delete your account, please sign out and sign in again, then try once more.',
  'auth/google-developer-error':
    'To delete your account, please sign out and sign in again, then try once more.',
})

// Backend HttpsError reasons (details.reason we set on deleteMyAccount).
const REAUTH_BACKEND_REASONS = Object.freeze({
  'requires-recent-login':
    'For your security, please confirm your identity again, then delete your account.',
})

const DELETION_FALLBACK =
  'We could not delete your account. Please try again or contact support.'

// What to say when the account is already GONE — the server destroys the
// session before it touches Firestore, so a rejection carrying
// `details.irreversible` is a rejection for an account that no longer exists.
// The default fallback is actively wrong there: it invites a retry, and there
// is nothing left to retry with. Only reached if the server sent no message.
const IRREVERSIBLE_FALLBACK =
  'Your sign-in has been removed and the rest of your data is still being deleted. ' +
  'You do not need to do anything else — contact support if you would like confirmation.'

/**
 * Map any error thrown while re-authenticating or deleting to a friendly
 * sentence for a toast / inline message.
 *
 * Accepts a Firebase Auth error, an httpsCallable error (whose canonical code
 * looks like `functions/failed-precondition` and which carries our
 * `details.reason`), or a bare code string.
 *
 * @param {object|string} error
 * @param {string} [fallback]
 * @returns {string}
 */
export function deletionErrorMessage(error, fallback = DELETION_FALLBACK) {
  if (!error) return fallback
  const code = typeof error === 'string' ? error : String(error.code || '')
  const reason =
    (error && error.details && error.details.reason) ||
    (error && error.customData && error.customData.reason) ||
    ''

  // The account is gone. Prefer the SERVER's own sentence: it is written for
  // this reader, it explains what happened to their data, and taking it as-is
  // is what keeps one wording from being maintained in two places. Checked
  // first, because the generic fallback below would tell someone whose account
  // has just been destroyed to try again.
  if (error && error.details && error.details.irreversible === true) {
    const fromServer = typeof error.message === 'string' ? error.message.trim() : ''
    return fromServer || IRREVERSIBLE_FALLBACK
  }

  // A recent-login rejection can arrive as our backend reason OR as the
  // Firebase client code — treat both the same.
  if (reason && REAUTH_BACKEND_REASONS[reason]) return REAUTH_BACKEND_REASONS[reason]
  if (code === 'auth/requires-recent-login') {
    return REAUTH_BACKEND_REASONS['requires-recent-login']
  }
  if (REAUTH_MESSAGES[code]) return REAUTH_MESSAGES[code]

  return fallback
}

export const ACCOUNT_REAUTH_MESSAGES = REAUTH_MESSAGES
