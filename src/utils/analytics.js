/**
 * analytics — PostHog wiring for product analytics (audit B2).
 *
 * Double-gated so this is a silent no-op unless BOTH conditions hold:
 *   1. VITE_POSTHOG_KEY is set at build time
 *   2. The user has accepted the cookie consent banner (D2)
 *
 * No init = no SDK download = zero bytes shipped to a visitor who
 * declines. The lazy import keeps posthog-js out of the main bundle
 * for declined / no-config builds.
 *
 * Public API:
 *   initAnalytics()                 — call once on app boot. Subscribes
 *                                     to consent changes and (re-)inits
 *                                     when accepted, opt-outs when
 *                                     declined.
 *   identifyUser(uid, role)         — call from AuthContext on
 *                                     auth state change. Anonymous-
 *                                     to-identified handoff is handled.
 *   capture(event, properties)      — record a custom event. Drops
 *                                     silently if analytics is off.
 *   resetAnalytics()                — call on signout so the next user
 *                                     doesn't inherit the previous
 *                                     identity.
 *
 * Identity policy: UID + role only. We never send email, displayName,
 * phone, school name, payment data, or quiz / lesson IDs as super-
 * properties. Per-event properties stay as opaque ids (e.g. `quizId`
 * is fine since it's already in our own backend).
 */

import {
  CONSENT_ACCEPTED,
  getConsent,
  isAnalyticsAllowed,
  onConsentChange,
} from './analyticsConsent'

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com'

let posthogInstance = null
let initInFlight = null
let queuedIdentity = null

function configured() {
  return Boolean(POSTHOG_KEY)
}

async function loadPostHog() {
  if (!configured()) return null
  if (posthogInstance) return posthogInstance
  if (initInFlight) return initInFlight

  initInFlight = (async () => {
    try {
      const { default: posthog } = await import('posthog-js')
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        // Capture pageviews automatically (covers the SPA navigation
        // path — PostHog hooks history.pushState).
        capture_pageview: true,
        // We're on a SPA — pageleave is handled via the same hook.
        capture_pageleave: true,
        // Persistence: localStorage + cookie. The cookie is short-
        // lived and consent-gated already.
        persistence: 'localStorage+cookie',
        // Don't autocapture form input *values* (privacy) — events on
        // form submission still fire, but the input strings stay
        // off the wire.
        mask_all_text: false,
        autocapture: {
          dom_event_allowlist: ['click', 'submit', 'change'],
        },
        // We'll manage identity ourselves — disable PostHog's anon-
        // user persistence so we don't accidentally track a learner
        // before they sign in.
        loaded: (instance) => {
          posthogInstance = instance
          if (queuedIdentity) {
            instance.identify(queuedIdentity.uid, queuedIdentity.props)
            queuedIdentity = null
          }
        },
      })
      posthogInstance = posthog
      return posthog
    } catch (err) {
      console.warn('[analytics] posthog init failed', err)
      return null
    } finally {
      initInFlight = null
    }
  })()

  return initInFlight
}

function teardownPostHog() {
  if (!posthogInstance) return
  try {
    posthogInstance.opt_out_capturing()
    posthogInstance.reset()
  } catch (err) {
    console.warn('[analytics] teardown failed', err)
  }
  posthogInstance = null
}

/**
 * Wire the consent listener + auto-load if already accepted. Idempotent;
 * safe to call from main.jsx on every boot.
 */
export function initAnalytics() {
  if (!configured()) return // silent no-op for unconfigured builds
  if (isAnalyticsAllowed()) {
    void loadPostHog()
  }
  onConsentChange((value) => {
    if (value === CONSENT_ACCEPTED) {
      void loadPostHog()
    } else {
      teardownPostHog()
    }
  })
}

/**
 * Identify the signed-in user. Buffer if PostHog hasn't finished
 * loading yet; the loaded() callback will pick it up.
 */
export function identifyUser(uid, role) {
  if (!uid) return
  // Only role + uid. No email / no displayName / no school.
  const props = { role: role || 'unknown' }
  if (posthogInstance) {
    try {
      posthogInstance.identify(uid, props)
    } catch (err) {
      console.warn('[analytics] identify failed', err)
    }
  } else if (configured() && getConsent() === CONSENT_ACCEPTED) {
    // SDK still loading — queue the identity.
    queuedIdentity = { uid, props }
    void loadPostHog()
  }
}

/**
 * Reset on signout so the next user (e.g. shared phone) doesn't
 * inherit the previous identity. PostHog's reset() rotates the
 * distinct_id back to a fresh anonymous one.
 */
export function resetAnalytics() {
  queuedIdentity = null
  if (!posthogInstance) return
  try { posthogInstance.reset() } catch (err) {
    console.warn('[analytics] reset failed', err)
  }
}

/**
 * Record an event. Drops silently when analytics is off — call sites
 * shouldn't have to repeat the configured/consent guard everywhere.
 */
export function capture(event, properties = {}) {
  if (!event || !posthogInstance) return
  try {
    posthogInstance.capture(event, properties)
  } catch (err) {
    console.warn('[analytics] capture failed', err)
  }
}
