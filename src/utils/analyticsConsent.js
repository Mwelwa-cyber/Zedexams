/**
 * analyticsConsent — single source of truth for whether we're allowed
 * to send product-analytics events (audit D2).
 *
 * Decision is persisted in localStorage under one key. Three states:
 *   - 'accepted'  — full opt-in; PostHog initialises and identifies
 *   - 'declined'  — explicit opt-out; PostHog never loads
 *   - null        — no decision yet; default to "no analytics" so a
 *                   visitor who closes the banner without choosing
 *                   doesn't leak events
 *
 * The banner UI (CookieConsentBanner) calls setConsent() with the
 * user's choice; the analytics bootstrap (utils/analytics.js) reads
 * getConsent() before initialising.
 *
 * Subscribers can listen for changes via the 'zedexams:consent'
 * window event so the analytics bootstrap can flip on/off in
 * response to a user toggling their decision later.
 */

const STORAGE_KEY = 'zedexams:analytics-consent'
const CHANGE_EVENT = 'zedexams:consent'

export const CONSENT_ACCEPTED = 'accepted'
export const CONSENT_DECLINED = 'declined'

export function getConsent() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === CONSENT_ACCEPTED || raw === CONSENT_DECLINED) return raw
    return null
  } catch {
    return null
  }
}

export function setConsent(value) {
  if (value !== CONSENT_ACCEPTED && value !== CONSENT_DECLINED) return
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch { /* private mode — decision is session-scoped */ }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { value } }))
  }
}

export function clearConsent() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { value: null } }))
  }
}

export function onConsentChange(handler) {
  if (typeof window === 'undefined') return () => {}
  function wrapped(e) { handler(e?.detail?.value ?? null) }
  window.addEventListener(CHANGE_EVENT, wrapped)
  return () => window.removeEventListener(CHANGE_EVENT, wrapped)
}

export function isAnalyticsAllowed() {
  return getConsent() === CONSENT_ACCEPTED
}
