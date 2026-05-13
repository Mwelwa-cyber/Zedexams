/**
 * src/utils/clientErrorReporting.js
 *
 * Lightweight, consent-gated client-side error sink. Closes the gap
 * between `ErrorBoundary` (catches render-time React errors only) and
 * Sentry (only active when VITE_SENTRY_DSN is set).
 *
 * What it captures today:
 *   - `window.addEventListener('error', …)` — synchronous throws in
 *     event handlers, setTimeout/setInterval callbacks, image-load
 *     failures, anything the browser fires `error` for that ErrorBoundary
 *     can't see.
 *   - `window.addEventListener('unhandledrejection', …)` — promise
 *     rejections nobody caught (e.g. an `onClick={async () => …}` whose
 *     `await` blew up and no `.catch` was wired).
 *   - Programmatic forwarding from ErrorBoundary.componentDidCatch via
 *     `reportClientError(err, context)`.
 *
 * Where reports go:
 *   - `capture('client_error', …)` (PostHog) — silently no-ops without
 *     analytics consent / config. Coarse-grained: error name + first 200
 *     chars of message + optional context tag. No stack, no PII.
 *   - Sentry, when present, installs its OWN listeners — this module
 *     does not call Sentry.captureException to avoid double-reporting.
 *     This is purely the "we have something, even without a DSN" sink.
 *
 * Hard caps to keep the analytics noise low:
 *   - Max 5 events per page session (a single bug in a render loop can
 *     fire dozens of identical errors per second; 5 is enough to know
 *     it's happening, low enough to never dominate the event stream).
 *   - Dedup window: identical (name, first 80 chars of message) within
 *     60s collapses to a single event. Distinct errors still each fire.
 */

// Capture function injected at init time (see initClientErrorReporting).
// Defaults to a no-op so a stray `reportClientError` call before init
// (or in a test environment that never wires it) does nothing harmful.
let _capture = () => {}

const MAX_EVENTS_PER_SESSION = 5
const DEDUP_WINDOW_MS = 60_000
const MESSAGE_MAX_LEN = 200
const DEDUP_KEY_LEN = 80

// Module-scoped state. A new SPA navigation does not reset these
// counters — the page lifetime is the dedup horizon.
let eventsSent = 0
let initialised = false
const recentByKey = new Map() // dedup-key → timestamp

function safeString(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return String(v?.message ?? v)
  } catch {
    return '[unserialisable]'
  }
}

/**
 * Normalise whatever the browser hands us into `{ name, message }`.
 * Both `error` events and `unhandledrejection` reasons can be Error
 * instances, strings, numbers, objects, or even null (yes, `Promise.reject()`).
 */
function summarise(input) {
  if (input == null) return { name: 'NullError', message: '' }
  if (input instanceof Error) {
    return {
      name: input.name || 'Error',
      message: safeString(input.message).slice(0, MESSAGE_MAX_LEN),
    }
  }
  if (typeof input === 'object') {
    // Prefer .message / .reason; fall back to JSON which can throw on
    // circular references — wrap it so we always return a string.
    let fallback
    try {
      fallback = JSON.stringify(input)
    } catch {
      fallback = '[circular or unserialisable]'
    }
    const message = safeString(input.message ?? input.reason ?? fallback)
    return {
      name: typeof input.name === 'string' ? input.name : 'Error',
      message: message.slice(0, MESSAGE_MAX_LEN),
    }
  }
  return { name: 'Error', message: safeString(input).slice(0, MESSAGE_MAX_LEN) }
}

function shouldReport(name, message) {
  if (eventsSent >= MAX_EVENTS_PER_SESSION) return false

  const key = `${name}:${message.slice(0, DEDUP_KEY_LEN)}`
  const now = Date.now()
  const last = recentByKey.get(key)
  if (last != null && now - last < DEDUP_WINDOW_MS) return false

  recentByKey.set(key, now)
  // Keep the dedup map bounded — without this a long-lived session
  // with many distinct errors would grow unboundedly.
  if (recentByKey.size > 32) {
    const oldestKey = recentByKey.keys().next().value
    recentByKey.delete(oldestKey)
  }
  return true
}

/**
 * Programmatic entry point. Called from ErrorBoundary.componentDidCatch
 * (and available for any future call site that wants to forward a
 * caught error without depending on the global window listener firing).
 *
 * `context` is an opaque short tag — e.g. 'error_boundary',
 * 'quiz_submit', 'pdf_export'. Helps bucket the analytics event without
 * dragging along stack traces or PII.
 */
export function reportClientError(err, context = 'manual') {
  try {
    const { name, message } = summarise(err)
    if (!shouldReport(name, message)) return
    eventsSent += 1
    _capture('client_error', {
      error_name: name,
      error_message: message,
      context: typeof context === 'string' ? context.slice(0, 40) : 'manual',
    })
  } catch {
    // The reporter must never throw — that would be a recursion into itself.
  }
}

function onWindowError(event) {
  // The `error` event surfaces both Error instances (via event.error) and
  // plain string messages (via event.message). Prefer the Error.
  reportClientError(event?.error ?? event?.message ?? event, 'window_error')
}

function onUnhandledRejection(event) {
  // `reason` is whatever the rejected promise was rejected with.
  reportClientError(event?.reason, 'unhandled_rejection')
}

/**
 * Wire the global listeners + bind the analytics capture sink.
 * Idempotent — calling twice is harmless. Skipped entirely in a
 * non-browser environment (SSR, tests without jsdom) where `window`
 * doesn't exist.
 *
 * `capture` is the analytics.capture function (PostHog wrapper).
 * Injected rather than imported statically so the test runner doesn't
 * have to load the entire analytics-consent chain.
 */
export function initClientErrorReporting(capture) {
  if (typeof capture === 'function') _capture = capture
  if (initialised) return
  if (typeof window === 'undefined') return
  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  initialised = true
}

// ── Test hooks (only used by scripts/test-client-error-reporting.mjs) ──
// Exposed so the test runner can simulate a fresh page load between
// scenarios without re-importing the module.
export function __resetForTests() {
  eventsSent = 0
  initialised = false
  recentByKey.clear()
  _capture = () => {}
}

export function __setCaptureForTests(fn) {
  _capture = typeof fn === 'function' ? fn : () => {}
}

export const __TEST_CONFIG = {
  MAX_EVENTS_PER_SESSION,
  DEDUP_WINDOW_MS,
  MESSAGE_MAX_LEN,
  DEDUP_KEY_LEN,
}
