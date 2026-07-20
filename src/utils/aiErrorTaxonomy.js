import { AI_ERROR_REASON } from './aiErrorReasons.js'

/**
 * Classify an AI-call failure for the client (B3/OBS-005).
 *
 * Firebase callable errors expose `.code` (e.g. 'functions/resource-exhausted')
 * and — for our AI limits — structured `.details.reason` + `.details.retryAfterSec`.
 * The three limits (burst throttle, daily quota, monthly budget) previously all
 * threw a bare 'resource-exhausted', so the client couldn't tell "try again in
 * 35 seconds" from "try again tomorrow". This maps any thrown error to a single
 * client-facing shape so:
 *   - the UI shows the RIGHT message, and
 *   - callers (quiz marking, scanned import) can decide retry vs stop vs pending.
 *
 * @param {*} error a rejected callable error (or any thrown value)
 * @returns {{ reason: string|null, category: string, retryable: boolean,
 *   retryAfterSec: number|null, userMessage: string }}
 */
export function mapAiError(error) {
  const details = (error && error.details) || {}
  const reason = details.reason
  const code = String((error && error.code) || '')
  const retryAfterSec = Number(details.retryAfterSec) > 0
    ? Math.ceil(Number(details.retryAfterSec))
    : null
  const isTimeout = code === 'timeout' ||
    /timeout|deadline|unavailable/i.test(String((error && error.message) || '') + code)

  if (reason === AI_ERROR_REASON.BURST_RATE_LIMIT) {
    const secs = retryAfterSec || 60
    return {
      reason, category: 'burst', retryable: true, retryAfterSec: secs,
      userMessage: `Too many requests in a short time. Try again in ${secs} seconds.`,
    }
  }
  if (reason === AI_ERROR_REASON.DAILY_QUOTA_EXHAUSTED) {
    return {
      reason, category: 'daily', retryable: false, retryAfterSec: null,
      userMessage: "You've reached today's AI limit. Please try again tomorrow.",
    }
  }
  if (reason === AI_ERROR_REASON.MONTHLY_BUDGET_EXHAUSTED) {
    return {
      reason, category: 'budget', retryable: false, retryAfterSec: null,
      userMessage: 'AI features are paused for now. Please try again later.',
    }
  }
  if (reason === AI_ERROR_REASON.CONCURRENCY_LIMIT) {
    return {
      reason, category: 'concurrency', retryable: true, retryAfterSec: retryAfterSec || 10,
      userMessage: 'Another request is still running. Please wait a moment and try again.',
    }
  }
  if (reason === AI_ERROR_REASON.PROVIDER_UNAVAILABLE || isTimeout) {
    return {
      reason: AI_ERROR_REASON.PROVIDER_UNAVAILABLE, category: 'provider',
      retryable: true, retryAfterSec: null,
      userMessage: 'The AI service is busy right now. Please try again in a moment.',
    }
  }
  // 'resource-exhausted' WITHOUT a structured reason (older backend build): the
  // SAFE assumption is a short burst throttle (retryable), NOT a daily limit —
  // never tell a learner "try tomorrow" on an ambiguous throttle.
  if (code.includes('resource-exhausted')) {
    return {
      reason: AI_ERROR_REASON.BURST_RATE_LIMIT, category: 'burst',
      retryable: true, retryAfterSec: retryAfterSec || 60,
      userMessage: 'Too many requests in a short time. Please try again shortly.',
    }
  }
  return {
    reason: null, category: 'unknown', retryable: false, retryAfterSec: null,
    userMessage: 'Could not complete the AI request right now. Please try again.',
  }
}

/** Convenience: is this failure a short-term, retry-worthy throttle/hiccup? */
export function isRetryableAiError(error) {
  return mapAiError(error).retryable
}
