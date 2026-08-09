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

const sendTestFunctionErrorAlertCallable = httpsCallable(fns, 'sendTestFunctionErrorAlert', { timeout: 60000 })

/**
 * Fire a SYNTHETIC Cloud Functions memory-kill through the live error watch.
 *
 * Distinct from sendTestOpsAlert, which proves the delivery channel. This
 * proves the whole chain that has to work for a real backend failure to reach
 * anyone: the log classifier, the alert thresholds, the message builder, the
 * channel, and the secret bindings. Sentry cannot see Cloud Functions at all,
 * so this path is the only thing standing between a broken function and
 * silence.
 *
 * `firedThroughRealPath: false` means the watch DECLINED to alert on a
 * synthetic memory kill — the classifier or thresholds are broken, which is a
 * different and worse failure than the alert not being delivered.
 *
 * @returns {Promise<{ok: boolean, alerted: boolean, firedThroughRealPath: boolean,
 *   summary: object|null, note: string}>}
 */
export async function sendTestFunctionErrorAlert() {
  const result = await sendTestFunctionErrorAlertCallable({})
  return result.data
}
