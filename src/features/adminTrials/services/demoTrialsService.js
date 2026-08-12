/**
 * The only place adminTrials touches Firebase (architecture.md §14.2).
 *
 * One callable, `bulkGrantDemoTrials`, pinned to `us-central1` — HTTP and
 * callable functions stay there; only Firestore triggers moved to
 * `africa-south1`.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'

// One callable per module load — created here rather than per call so the
// Functions client init cost is paid once, on the route's lazy chunk.
const fns = getFunctions(app, 'us-central1')
const bulkGrantDemoTrialsCallable = httpsCallable(fns, 'bulkGrantDemoTrials')

/**
 * Grant a batch of demo trials. Resolves to the callable's `data`, which
 * carries `{ results: [...], expiresAt }`; rejects with the callable's error
 * for the panel to surface.
 */
export async function grantDemoTrials(payload) {
  const res = await bulkGrantDemoTrialsCallable(payload)
  return res.data || {}
}
