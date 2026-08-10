import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'
import { reportClientError } from '../../../utils/clientErrorReporting.js'

const functions = getFunctions(app, 'us-central1')
const confirmPaymentCallable = httpsCallable(functions, 'adminConfirmPayment')
const rejectPaymentCallable = httpsCallable(functions, 'adminRejectPayment')
const grantPremiumCallable = httpsCallable(functions, 'adminGrantPremium')
const revokePremiumCallable = httpsCallable(functions, 'adminRevokePremium')

/**
 * Admin payment/subscription actions routed through the audited Cloud
 * Functions so each one lands an adminAuditLogs entry (the
 * /admin/activity page). Each helper takes an optional `fallback` — the
 * equivalent direct client-side write (from useFirestore) — invoked ONLY
 * when the callable isn't deployed yet (functions/not-found), so the
 * admin panel keeps working if the frontend ships ahead of the functions
 * deploy. Any other error propagates so the caller can surface it.
 *
 * OBS-002: the fallback path is a DIRECT client write that skips the audit
 * ledger (adminAuditLogs is server-only). It used to fire silently, so a
 * deploy-skew window could mutate payments/subscriptions with no forensic
 * record. `action` names the operation so the fallback can be made LOUD —
 * every ledger-bypassing write now reports a client error so ops can see the
 * skew and reconcile the missing entries.
 */
async function withFallback(callableCall, fallback, action) {
  try {
    return await callableCall()
  } catch (err) {
    if (err?.code === 'functions/not-found' && typeof fallback === 'function') {
      // The audited callable isn't deployed — we're about to write directly,
      // bypassing adminAuditLogs. Never let that be silent.
      reportClientError(
        new Error(`Admin action "${action}" used the UNAUDITED direct-write fallback ` +
          `(callable not deployed) — no adminAuditLogs entry was created`),
        'adminPayments.auditBypass',
        { force: true }, // rare + important — skip the dedup/rate-limit gate
      )
      return await fallback()
    }
    throw err
  }
}

export function adminConfirmPayment({ paymentId }, fallback) {
  return withFallback(() => confirmPaymentCallable({ paymentId }), fallback, 'adminConfirmPayment')
}

export function adminRejectPayment({ paymentId, reason = '' }, fallback) {
  return withFallback(() => rejectPaymentCallable({ paymentId, reason }), fallback, 'adminRejectPayment')
}

export function adminGrantPremium({ uid, planId, durationDays }, fallback) {
  return withFallback(() => grantPremiumCallable({ uid, planId, durationDays }), fallback, 'adminGrantPremium')
}

export function adminRevokePremium({ uid }, fallback) {
  return withFallback(() => revokePremiumCallable({ uid }), fallback, 'adminRevokePremium')
}
