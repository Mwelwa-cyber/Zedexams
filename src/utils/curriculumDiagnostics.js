/**
 * Structured, PII-free diagnostics for curriculum picker resolution.
 *
 * Every time a studio resolves its Curriculum → Grade → Subject → Topic picker
 * options, or removes an invalid persisted selection, or fails closed on
 * missing catalogue data, it emits one of the events below. The payload names
 * WHICH source produced the result and WHETHER a fallback/invalid-removal
 * happened — so the "subject picker and topic picker disagree" class of bug is
 * visible in telemetry instead of only reproducible by hand.
 *
 * Privacy: events carry ONLY ids, counts and enum sources — never learner
 * names, assessment content or other personal data.
 *
 * Transport: pure + DOM-free so `node` tests can assert on emitted events via
 * setDiagnosticsSink(). In the browser a sink is registered once at startup
 * (see initCurriculumDiagnostics) that samples successful resolutions and
 * forwards warnings/errors to the existing observability provider.
 */

export const CURRICULUM_EVENTS = {
  RESOLVED: 'curriculum_picker_resolved',
  INVALID_SELECTION: 'curriculum_picker_invalid_selection',
  CATALOGUE_MISSING: 'curriculum_picker_catalogue_missing',
  FALLBACK_BLOCKED: 'curriculum_picker_fallback_blocked',
  CACHE_VERSION_MISMATCH: 'curriculum_picker_cache_version_mismatch',
  LEGACY_VALUE_MAPPED: 'curriculum_picker_legacy_value_mapped',
  LEGACY_VALUE_UNRESOLVED: 'curriculum_picker_legacy_value_unresolved',
}

// Which events are warnings/errors (always forwarded) vs normal (sampled).
const WARNING_EVENTS = new Set([
  CURRICULUM_EVENTS.INVALID_SELECTION,
  CURRICULUM_EVENTS.CATALOGUE_MISSING,
  CURRICULUM_EVENTS.FALLBACK_BLOCKED,
  CURRICULUM_EVENTS.CACHE_VERSION_MISMATCH,
  CURRICULUM_EVENTS.LEGACY_VALUE_UNRESOLVED,
])

// Sampling rate for normal successful resolutions in production (0..1).
const RESOLVED_SAMPLE_RATE = 0.05

let _sink = null
// Small ring buffer so a dev panel / test can read the most recent events
// without a subscription.
const _recent = []
const RECENT_MAX = 50

/**
 * Replace the diagnostics sink. `sink(event, payload)` receives every event.
 * Passing null restores the default (dev console + ring buffer only).
 */
export function setDiagnosticsSink(sink) {
  _sink = typeof sink === 'function' ? sink : null
}

/** The most recent events (newest last), for the dev diagnostics panel. */
export function recentCurriculumEvents() {
  return _recent.slice()
}

export function __resetCurriculumDiagnostics() {
  _sink = null
  _recent.length = 0
}

function isDev() {
  // Vite exposes import.meta.env; guard so `node` (no import.meta.env) is safe.
  try {
    return typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV === true
  } catch {
    return false
  }
}

function stamp(payload) {
  // Timestamp is caller-supplied where determinism matters (tests); default to
  // now in the browser only.
  if (payload && payload.timestamp) return payload
  let ts = null
  try {
    ts = typeof Date !== 'undefined' && typeof Date.now === 'function' ? Date.now() : null
  } catch {
    ts = null
  }
  return { ...payload, timestamp: ts }
}

/**
 * Emit a curriculum diagnostic event. Never throws (diagnostics must not break
 * a picker). In production, normal RESOLVED events are sampled; warnings/errors
 * always go through.
 */
export function logCurriculumEvent(event, payload = {}) {
  try {
    const full = stamp({ event, ...payload })
    _recent.push(full)
    if (_recent.length > RECENT_MAX) _recent.shift()

    const isWarning = WARNING_EVENTS.has(event)
    if (isDev()) {
      console[isWarning ? 'warn' : 'debug'](`[curriculum] ${event}`, full)
    }
    if (!_sink) return
    if (!isWarning && event === CURRICULUM_EVENTS.RESOLVED) {
      // Sample successful resolutions to keep telemetry volume sane.
      let r = 1
      try { r = typeof Math !== 'undefined' && Math.random ? Math.random() : 1 } catch { r = 1 }
      if (r > RESOLVED_SAMPLE_RATE) return
    }
    _sink(event, full)
  } catch {
    // Swallow — diagnostics are best-effort.
  }
}

/**
 * Wire the browser sink once at startup. `capture` (analytics) receives sampled
 * resolutions + all warnings; `reportError` (client error reporting) receives
 * the hard failures. Both are injected so this module stays dependency-light
 * and node-safe.
 */
export function initCurriculumDiagnostics({ capture, reportError } = {}) {
  setDiagnosticsSink((event, payload) => {
    try {
      if (typeof capture === 'function') capture(event, payload)
      if (
        typeof reportError === 'function' &&
        (event === CURRICULUM_EVENTS.CATALOGUE_MISSING ||
          event === CURRICULUM_EVENTS.FALLBACK_BLOCKED)
      ) {
        reportError(new Error(`curriculum: ${event}`), 'curriculum_picker', { level: 'warning', extra: payload })
      }
    } catch {
      // best-effort
    }
  })
}
