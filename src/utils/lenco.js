/**
 * lenco — client wrappers for the Lenco automated-payment callables.
 *
 * The browser never talks to Lenco directly (the API token is a
 * server-only secret). It calls our Cloud Functions:
 *   - initiateLencoPayment  → starts a mobile-money / card collection
 *   - submitLencoOtp        → completes the mobile-money OTP step
 *   - getLencoPaymentStatus → poll fallback while we wait for the webhook
 *
 * The authoritative activation happens server-side (the signed webhook);
 * the poll just lets the checkout UI show success promptly.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const fns = getFunctions(app, 'us-central1')
const initiateCallable = httpsCallable(fns, 'initiateLencoPayment')
const submitOtpCallable = httpsCallable(fns, 'submitLencoOtp')
const statusCallable = httpsCallable(fns, 'getLencoPaymentStatus')

// Mirror of functions/lencoService.js OPERATORS — kept in sync so the
// checkout dropdown and the auto-detect agree with the server.
export const OPERATORS = [
  { id: 'mtn', label: 'MTN MoMo', prefixes: ['096', '076'] },
  { id: 'airtel', label: 'Airtel Money', prefixes: ['097', '077'] },
  { id: 'zamtel', label: 'Zamtel Kwacha', prefixes: ['095', '075'] },
]

export const TERMINAL_STATUSES = ['successful', 'failed']

function nationalDigits(phone) {
  let d = String(phone || '').replace(/[^\d]/g, '')
  if (d.startsWith('260')) d = d.slice(3)
  // International form drops the trunk 0 → re-add it for ZM mobile (7/9).
  if (d.length === 9 && /^[79]/.test(d)) d = '0' + d
  if (d.length === 10 && d.startsWith('0')) return d
  return ''
}

/** ZICTA prefix → operator id, or null when unknown. */
export function detectOperator(phone) {
  const national = nationalDigits(phone)
  if (!national) return null
  const prefix = national.slice(0, 3)
  for (const op of OPERATORS) {
    if (op.prefixes.includes(prefix)) return op.id
  }
  return null
}

export function looksLikeZambianPhone(phone) {
  return nationalDigits(phone) !== ''
}

export async function initiateLencoPayment(payload) {
  const res = await initiateCallable(payload)
  return res.data
}

export async function submitLencoOtp({ paymentId, otp }) {
  const res = await submitOtpCallable({ paymentId, otp })
  return res.data
}

export async function getLencoPaymentStatus(paymentId) {
  const res = await statusCallable({ paymentId })
  return res.data
}

/**
 * Poll getLencoPaymentStatus until the payment reaches a terminal state
 * or we give up. Mirrors Lenco's own SDK defaults (3s × 40 ≈ 2 minutes).
 * Returns the final status string ('successful' | 'failed' | 'pending').
 */
export async function pollLencoStatus(paymentId, { intervalMs = 3000, maxAttempts = 40, onTick, signal } = {}) {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (signal?.aborted) return 'pending'
    let status = 'pending'
    try {
      ({ status } = await getLencoPaymentStatus(paymentId))
    } catch {
      status = 'pending'
    }
    if (onTick) onTick(status, i)
    if (TERMINAL_STATUSES.includes(status)) return status
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return 'pending'
}
