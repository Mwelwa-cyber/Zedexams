import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

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
 */
async function withFallback(callableCall, fallback) {
  try {
    return await callableCall()
  } catch (err) {
    if (err?.code === 'functions/not-found' && typeof fallback === 'function') {
      return await fallback()
    }
    throw err
  }
}

export function adminConfirmPayment({ paymentId }, fallback) {
  return withFallback(() => confirmPaymentCallable({ paymentId }), fallback)
}

export function adminRejectPayment({ paymentId, reason = '' }, fallback) {
  return withFallback(() => rejectPaymentCallable({ paymentId, reason }), fallback)
}

export function adminGrantPremium({ uid, planId, durationDays }, fallback) {
  return withFallback(() => grantPremiumCallable({ uid, planId, durationDays }), fallback)
}

export function adminRevokePremium({ uid }, fallback) {
  return withFallback(() => revokePremiumCallable({ uid }), fallback)
}
