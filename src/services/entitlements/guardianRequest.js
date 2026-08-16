/**
 * guardianRequest — the client half of "ask your guardian to unlock this".
 *
 * A thin wrapper over the `requestGuardianUnlock` callable. Everything that
 * matters is decided on the server: whether a verified guardian contact
 * exists, the 72-hour rate limit, what evidence goes in the message and in
 * what order, and the signed single-use pay link. This module supplies the
 * gate id and reports the outcome.
 *
 * The local rate-limit check in `interruptionBudget` runs first, but it is a
 * courtesy to the button, not a control — it runs on the learner's device.
 * A `RATE_LIMITED` answer from the server is the authoritative one, and this
 * module surfaces it as such rather than treating it as a transport failure.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../firebase/config'
import { interruptionBudget } from './interruptionBudget'
import { capture } from '../../utils/analytics'

let functionsRef = null
function fns() {
  if (!functionsRef) functionsRef = getFunctions(app, 'us-central1')
  return functionsRef
}

export const GUARDIAN_REQUEST = Object.freeze({
  SENT: 'sent',
  RATE_LIMITED: 'rate_limited',
  NO_GUARDIAN: 'no_guardian',
  FAILED: 'failed',
})

/**
 * Ask the server to message this learner's guardian.
 *
 * @param {object} args
 * @param {string} args.feature   a gate id, e.g. 'PAPER_CONTINUE'
 * @param {object} [args.context] paperId / remaining / score — evidence hints
 *   the server may use. It re-derives everything it can from Firestore; these
 *   only cover the case where the client knows something not yet written
 *   (a score computed a moment ago, for instance).
 * @returns {Promise<{outcome: string, retryAfterMs?: number, message?: string}>}
 *   Never rejects. A learner tapping "Send request" and getting an unhandled
 *   promise rejection learns nothing; every failure comes back as an outcome
 *   the sheet can put into words.
 */
export async function requestGuardianUnlock({ feature, context = {} } = {}) {
  const local = interruptionBudget.canRequestGuardian()
  if (!local.allowed) {
    return { outcome: GUARDIAN_REQUEST.RATE_LIMITED, retryAfterMs: local.retryAfterMs }
  }

  try {
    const call = httpsCallable(fns(), 'requestGuardianUnlock')
    const res = await call({ feature, context })
    const data = res?.data || {}
    if (data.outcome === GUARDIAN_REQUEST.SENT) {
      interruptionBudget.recordGuardianRequest()
      capture('guardian_request_sent', { gate: feature })
      return { outcome: GUARDIAN_REQUEST.SENT, message: data.message || '' }
    }
    if (data.outcome === GUARDIAN_REQUEST.RATE_LIMITED) {
      // Mirror the server's clock locally so the button stops offering a
      // request that will be refused again in the same window.
      interruptionBudget.recordGuardianRequest()
      return { outcome: GUARDIAN_REQUEST.RATE_LIMITED, retryAfterMs: Number(data.retryAfterMs) || 0 }
    }
    if (data.outcome === GUARDIAN_REQUEST.NO_GUARDIAN) {
      return { outcome: GUARDIAN_REQUEST.NO_GUARDIAN }
    }
    return { outcome: GUARDIAN_REQUEST.FAILED }
  } catch (err) {
    // `resource-exhausted` is how the callable reports the rate limit when it
    // throws rather than returns; treated the same so a learner never sees a
    // generic error for a rule that has a sentence.
    if (err?.code === 'functions/resource-exhausted') {
      return { outcome: GUARDIAN_REQUEST.RATE_LIMITED, retryAfterMs: 0 }
    }
    if (err?.code === 'functions/failed-precondition') {
      return { outcome: GUARDIAN_REQUEST.NO_GUARDIAN }
    }
    return { outcome: GUARDIAN_REQUEST.FAILED }
  }
}
