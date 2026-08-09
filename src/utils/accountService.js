import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  signOut,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from 'firebase/auth'
import app, { auth } from '../firebase/config'
import { pickReauthMethod } from './accountReauth'
import { beginAccountDeletion, endAccountDeletion } from './accountDeletionState'

const functions = getFunctions(app, 'us-central1')

// The purge can touch dozens of collections, so give it a generous
// client-side timeout (default is 70s). The server caps at 300s.
const deleteMyAccountCallable = httpsCallable(functions, 'deleteMyAccount', {
  timeout: 300000,
})

// Re-export so panels can decide whether to render a password field without
// importing both modules.
export { pickReauthMethod } from './accountReauth'

/**
 * The re-auth method the signed-in user needs: 'password' or 'oauth'.
 * @param {import('firebase/auth').User} [user]
 * @returns {'password'|'oauth'}
 */
export function currentReauthMethod(user = auth.currentUser) {
  return pickReauthMethod(user?.providerData)
}

/**
 * Re-authenticate the current user so their next ID token carries a FRESH
 * `auth_time`, which `deleteMyAccount` now requires (LEGAL-003 — a
 * stolen/persisted session must not be able to silently purge an account).
 *
 * Password accounts re-enter their password; federated accounts re-auth via a
 * provider popup. After a successful re-auth the token is force-refreshed so
 * the very next callable sends the new `auth_time`.
 *
 * Throws a Firebase auth error (e.g. `auth/wrong-password`,
 * `auth/popup-closed-by-user`) — or `account/password-required` /
 * `account/not-signed-in` — which the caller maps via `deletionErrorMessage`.
 *
 * @param {object} [opts]
 * @param {string} [opts.password]  Required for password accounts.
 */
export async function reauthenticateForAccountDeletion({ password } = {}) {
  const user = auth.currentUser
  if (!user) {
    const err = new Error('No signed-in user to re-authenticate.')
    err.code = 'account/not-signed-in'
    throw err
  }

  if (currentReauthMethod(user) === 'password') {
    if (!password) {
      const err = new Error('A password is required to confirm deletion.')
      err.code = 'account/password-required'
      throw err
    }
    const credential = EmailAuthProvider.credential(user.email, password)
    await reauthenticateWithCredential(user, credential)
  } else {
    // Federated account (Google). Popups don't work inside the native Android
    // WebView; there `reauthenticateWithPopup` throws
    // auth/operation-not-supported-in-this-environment, which the UI surfaces
    // as "sign out and sign in again, then try once more" (a fresh sign-in
    // also refreshes auth_time).
    await reauthenticateWithPopup(user, new GoogleAuthProvider())
  }

  // Force a token refresh so the fresh auth_time reaches the callable now, not
  // whenever Firebase would next rotate the cached token.
  await user.getIdToken(true)
}

/**
 * Permanently delete the signed-in user's account and personal data.
 *
 * Re-authenticates first (so the server's recent-login gate passes), then calls
 * the `deleteMyAccount` Cloud Function (which removes the Firebase Auth user
 * and purges Firestore), then signs the now-orphaned session out locally so the
 * UI drops back to the signed-out state. Throws on failure so the caller can
 * surface an error and keep the user signed in.
 *
 * `beginAccountDeletion` is called BEFORE the callable, not after: it tears the
 * profile listener down and flags the deletion, so the disappearance of
 * `users/{uid}` is never read as a profile that needs repairing. Cleared in a
 * `finally` — a flag left set would disable genuine repair for the rest of the
 * session.
 *
 * @param {object} [opts]
 * @param {string} [opts.password]  Required for password accounts.
 * @returns {Promise<{success: boolean, summary?: object}>}
 */
export async function deleteMyAccount({ password } = {}) {
  await reauthenticateForAccountDeletion({ password })
  beginAccountDeletion()
  try {
    const res = await deleteMyAccountCallable()
    // Server already deleted the Auth user; this local sign-out just clears
    // the stale in-memory session. Best-effort — never let it mask success.
    try {
      await signOut(auth)
    } catch {
      /* session is already invalid server-side */
    }
    return res?.data || { success: true }
  } finally {
    endAccountDeletion()
  }
}
