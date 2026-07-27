/**
 * Client wrapper for the admin ops-alert self-test.
 *
 * Fires ONE real ops alert (severity info) through the same path a genuine
 * incident takes, and returns a per-channel verdict so the admin can see which
 * channels would actually reach them. Server-side the callable re-checks
 * `users/{uid}.role`, so this is admin-only regardless of who calls it.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const fns = getFunctions(app, 'us-central1')
// SMTP hand-shaking plus a webhook POST can take a few seconds on a cold
// instance; the default 70s callable timeout is plenty but be explicit.
const sendTestOpsAlertCallable = httpsCallable(fns, 'sendTestOpsAlert', { timeout: 60000 })

/**
 * @param {Object} [opts]
 * @param {string} [opts.note] optional short note echoed into the alert body
 * @returns {Promise<{verdict: 'both'|'one'|'none', delivered: boolean,
 *   slack: {status: string, reason: string|null, detail: string|null},
 *   email: {status: string, reason: string|null, detail: string|null}}>}
 */
export async function sendTestOpsAlert({ note = '' } = {}) {
  const result = await sendTestOpsAlertCallable({ note: String(note || '').slice(0, 200) })
  return result.data
}
