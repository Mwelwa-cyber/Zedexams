/**
 * visitorTracking — first-party page-view beacon for the /admin/visitors
 * dashboard.
 *
 * On each SPA route change we POST a tiny payload to /api/track/visit (a
 * Firebase Hosting rewrite → the apiTrackVisit Cloud Function), which
 * records the pageview + updates the daily rollups. This is independent of
 * the PostHog wiring in analytics.js — it exists so the admin always has
 * traffic numbers inside the app without an external vendor.
 *
 * Privacy: the pageview itself is a legitimate first-party server log, so
 * we always send it. A *persistent* identifier is what needs consent, so a
 * stable visitorId is only stored (and a session id persisted to
 * sessionStorage) once the user accepts the cookie-consent banner. Without
 * consent we fall back to in-memory ids that vanish on reload — enough to
 * de-dupe a single page session, but no cross-visit tracking.
 *
 * Best-effort throughout: any failure is swallowed. Tracking never blocks
 * navigation and never surfaces an error to the user.
 */

import { isAnalyticsAllowed } from './analyticsConsent'

const ENDPOINT = '/api/track/visit'
const VISITOR_KEY = 'zx_visitor_id'
const SESSION_KEY = 'zx_session_id'

// In-memory fallbacks for the no-consent path (and for environments where
// web storage throws — Safari private mode, locked-down WebViews).
let memVisitorId = null
let memSessionId = null

// Cheap de-dupe so React StrictMode's double-invoke (dev) and rapid
// re-renders don't double-count the same path.
let lastPath = null
let lastSentAt = 0

function randomId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  // Non-secure contexts lack crypto.randomUUID but still have
  // crypto.getRandomValues. Hex encoding — one byte is exactly two
  // digits, so no modulo bias.
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = crypto.getRandomValues(new Uint8Array(5))
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      return `v${Date.now().toString(36)}${hex}`
    }
  } catch {
    /* fall through */
  }
  return `v${Date.now().toString(36)}`
}

/**
 * Tracking only makes sense on a real http(s) web origin. Skip on
 * Capacitor native (capacitor://) and SSR/no-window contexts — the
 * /api/* hosting rewrite doesn't exist there.
 */
function isTrackableEnv() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  try {
    if (window.Capacitor?.isNativePlatform?.()) return false
  } catch {
    /* ignore */
  }
  const proto = window.location?.protocol
  return proto === 'http:' || proto === 'https:'
}

function readStore(store, key) {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

function writeStore(store, key, value) {
  try {
    store.setItem(key, value)
  } catch {
    /* storage blocked — caller keeps the in-memory copy */
  }
}

function getVisitorId() {
  if (isAnalyticsAllowed()) {
    let id = readStore(window.localStorage, VISITOR_KEY)
    if (!id) {
      id = randomId()
      writeStore(window.localStorage, VISITOR_KEY, id)
    }
    return id
  }
  if (!memVisitorId) memVisitorId = randomId()
  return memVisitorId
}

function getSessionId() {
  if (isAnalyticsAllowed()) {
    let id = readStore(window.sessionStorage, SESSION_KEY)
    if (!id) {
      id = randomId()
      writeStore(window.sessionStorage, SESSION_KEY, id)
    }
    return id
  }
  if (!memSessionId) memSessionId = randomId()
  return memSessionId
}

function send(payload) {
  const body = JSON.stringify(payload)
  try {
    if (navigator.sendBeacon) {
      // Blob type drives the Content-Type so the function parses JSON.
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(ENDPOINT, blob)) return
    }
  } catch {
    /* fall through to fetch */
  }
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {})
  } catch {
    /* give up — best effort */
  }
}

/**
 * Record a pageview for the given path (defaults to the current location).
 * Safe to call on every route change.
 */
export function trackPageview(path) {
  if (!isTrackableEnv()) return
  const p = path || window.location.pathname || '/'

  const now = Date.now()
  if (p === lastPath && now - lastSentAt < 1500) return
  lastPath = p
  lastSentAt = now

  try {
    send({
      path: p,
      title: document.title || '',
      referrer: document.referrer || '',
      visitorId: getVisitorId(),
      sessionId: getSessionId(),
    })
  } catch {
    /* best effort */
  }
}
