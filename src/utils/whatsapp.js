/**
 * whatsapp — client helper for the admin-only activation
 * confirmation sender. Wraps the `sendActivationConfirmation`
 * callable so the admin grant flow can fire-and-report in two
 * lines.
 *
 * Server-side soft-fails when the Meta secrets aren't bound; this
 * client surfaces `{status: 'skipped' | 'sent' | 'failed', …}` so the
 * UI can fall back to the copy-paste deep link.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const fns = getFunctions(app, 'us-central1')
const sendActivationConfirmationCallable = httpsCallable(fns, 'sendActivationConfirmation')
const sendExpiryRemindersCallable = httpsCallable(fns, 'sendExpiryReminders')

/**
 * Send a free-form WhatsApp message to a customer (Meta 24h window).
 * Admin-only — server checks the caller's role.
 *
 * @param {Object} args
 * @param {string} args.phone  Raw phone (0977…, 260977…, +260977…).
 * @param {string} args.body   Plain-text message (≤1600 chars).
 */
export async function sendActivationConfirmation({ phone, body }) {
  const result = await sendActivationConfirmationCallable({ phone, body })
  return result.data
}

/**
 * Fire WhatsApp renewal nudges to learners whose subscription expires in
 * the next 3 days or lapsed in the last 14. Server-side admin-gated,
 * idempotent on a 20-hour cooldown so re-clicking the button doesn't
 * spam.
 *
 * Returns: { status, candidates, sent, skipped, failed, results }
 */
export async function sendExpiryReminders() {
  const result = await sendExpiryRemindersCallable({})
  return result.data
}
