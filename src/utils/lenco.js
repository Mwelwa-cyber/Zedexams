/**
 * lenco — client wrappers for the Lenco automated-payment callables.
 *
 * The browser never talks to Lenco directly (the API token is a
 * server-only secret). It calls our Cloud Functions:
 *   - initiateLencoPayment  → starts a mobile-money collection
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
const recoverCallable = httpsCallable(fns, 'recoverMyPendingPayments')
const quoteCallable = httpsCallable(fns, 'getUpgradeQuote')

// Mirror of functions/lencoService.js OPERATORS — kept in sync so the
// checkout dropdown and the auto-detect agree with the server.
export const OPERATORS = [
  { id: 'mtn', label: 'MTN MoMo', prefixes: ['096', '076'] },
  { id: 'airtel', label: 'Airtel Money', prefixes: ['097', '077'] },
  { id: 'zamtel', label: 'Zamtel Kwacha', prefixes: ['095', '075'] },
]

export const TERMINAL_STATUSES = ['successful', 'failed']

// Mirror of functions/lencoService.js's STATUS.PAY_OFFLINE — a non-terminal
// collection status meaning the network never pushes an automatic PIN
// prompt for this payment; the buyer must complete it themselves (dial their
// mobile-money menu / open the app), so the checkout must say that rather
// than keep telling them to wait for a prompt that is not coming.
export const PAY_OFFLINE_STATUS = 'pay-offline'

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

/**
 * The operator we'll actually charge. An explicit manual choice wins;
 * otherwise we auto-detect from the number. Kept here as the single source
 * of truth so the checkout UI's displayed network and the value sent to the
 * server (and to Lenco) never drift apart.
 *
 * @param {{phone?: string, operator?: string, operatorTouched?: boolean}} args
 * @returns {string} an operator id, or '' when it can't be resolved yet.
 */
export function resolveOperator({ phone, operator, operatorTouched } = {}) {
  if (operatorTouched) return operator || ''
  return detectOperator(phone) || operator || ''
}

export async function initiateLencoPayment(payload) {
  const res = await initiateCallable(payload)
  return res.data
}

/**
 * Server-computed checkout quote: the amount due today (prorated for a live
 * Pro→Max step), whether it's an upgrade, and the renewal date a successful
 * payment would produce. The checkout displays this and echoes amountZMW
 * back on initiation, where the server verifies it before charging.
 */
export async function getUpgradeQuote(planId) {
  const res = await quoteCallable({ planId })
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
 * On-demand "I already paid — restore my credit" recovery. Re-queries Lenco
 * for the signed-in user's stuck-pending payments and finishes the activation
 * the dropped webhook / closed poll never did (idempotent server-side, so it's
 * safe to call repeatedly). Resolves to { recovered, stillPending, ... }; when
 * recovered > 0 the granted credit / subscription lands on the profile snapshot
 * and the gate unblocks without a reload.
 */
export async function recoverMyPendingPayments() {
  const res = await recoverCallable({})
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
    let message = null
    try {
      ;({ status, message = null } = await getLencoPaymentStatus(paymentId))
    } catch {
      status = 'pending'
    }
    // Third arg carries anything beyond the status itself (currently just
    // the provider's own instructions for a pay-offline collection) — kept
    // optional so existing two-arg onTick callers are unaffected.
    if (onTick) onTick(status, i, { message })
    if (TERMINAL_STATUSES.includes(status)) return status
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return 'pending'
}
