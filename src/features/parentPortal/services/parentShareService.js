/**
 * parentShareService — client wrapper for the one remaining parent-portal
 * Cloud Function the client calls: `getProgressShare`.
 *
 * It is PUBLIC (no auth) and returns a fully rendered shape, so the
 * `/parent/:token` route (old share links, which keep working until they
 * expire) does not need to navigate Firestore rules.
 *
 * The learner-side half — creating, revoking and listing share links — was
 * removed with the buttons that called it (2026-10, parent portal
 * retirement): `createProgressShare` now refuses server-side, and a link
 * that exists can only expire.
 */

import app from '../../../firebase/config'
import { getFunctions, httpsCallable } from 'firebase/functions'

const fns = getFunctions(app, 'us-central1')
const getProgressShareCallable = httpsCallable(fns, 'getProgressShare')

/**
 * Fetch the rendered parent-facing payload by token. PUBLIC — no
 * auth required. Used by /parent/:token.
 */
export async function getProgressShare(token) {
  const result = await getProgressShareCallable({ token })
  return result.data
}
