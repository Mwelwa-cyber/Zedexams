import { getFunctions, httpsCallable } from 'firebase/functions'
import { signOut } from 'firebase/auth'
import app, { auth } from '../firebase/config'

const functions = getFunctions(app, 'us-central1')

// The purge can touch dozens of collections, so give it a generous
// client-side timeout (default is 70s). The server caps at 300s.
const deleteMyAccountCallable = httpsCallable(functions, 'deleteMyAccount', {
  timeout: 300000,
})

/**
 * Permanently delete the signed-in user's account and personal data.
 *
 * Calls the `deleteMyAccount` Cloud Function (which purges Firestore and
 * removes the Firebase Auth user), then signs the now-orphaned session out
 * locally so the UI drops back to the signed-out state. Throws on failure so
 * the caller can surface an error and keep the user signed in.
 *
 * @returns {Promise<{success: boolean, summary?: object}>}
 */
export async function deleteMyAccount() {
  const res = await deleteMyAccountCallable()
  // Server already deleted the Auth user; this local sign-out just clears
  // the stale in-memory session. Best-effort — never let it mask success.
  try {
    await signOut(auth)
  } catch {
    /* session is already invalid server-side */
  }
  return res?.data || { success: true }
}
