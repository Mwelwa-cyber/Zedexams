/**
 * systemStatus — pure helpers for the public /status page.
 *
 * The page reads the server-written `publicStatus/current` doc (produced hourly
 * by Vigil via functions/agents/publicStatusCore.js) and renders it. This module
 * holds the two truthfulness rules the page must apply CLIENT-side:
 *
 *   1. STALENESS → UNKNOWN. If the doc hasn't been refreshed within
 *      STALE_AFTER_MS (i.e. the hourly monitor stopped running), we must NOT
 *      keep showing whatever it last said — a stale "operational" is a lie. The
 *      whole page (and every component) degrades to "unknown".
 *   2. NO DOC → UNKNOWN. Before the first monitor run, or if the read fails,
 *      status is "unknown", never "operational".
 *
 * Pure (no Firebase / DOM) so it unit-tests under node and can be reused.
 */

export const STATUS = {
  OPERATIONAL: 'operational',
  DEGRADED: 'degraded',
  PARTIAL_OUTAGE: 'partial_outage',
  MAJOR_OUTAGE: 'major_outage',
  MAINTENANCE: 'maintenance',
  UNKNOWN: 'unknown',
}

// The monitor runs hourly. Allow two missed runs before we stop trusting the
// data — beyond ~2h15m with no refresh, the page reads "unknown" rather than
// asserting a stale state.
export const STALE_AFTER_MS = 135 * 60 * 1000

// Display order mirrors publicStatusCore.COMPONENTS.
const COMPONENT_ORDER = ['pages', 'firebase', 'quizzes', 'images', 'dailyExams', 'playBilling']

const LABELS = {
  [STATUS.OPERATIONAL]: 'Operational',
  [STATUS.DEGRADED]: 'Degraded',
  [STATUS.PARTIAL_OUTAGE]: 'Partial outage',
  [STATUS.MAJOR_OUTAGE]: 'Major outage',
  [STATUS.MAINTENANCE]: 'Maintenance',
  [STATUS.UNKNOWN]: 'Unknown',
}

export function statusLabel(status) {
  return LABELS[status] || 'Unknown'
}

/** UI tone bucket: 'ok' | 'warn' | 'down' | 'unknown'. */
export function statusTone(status) {
  if (status === STATUS.OPERATIONAL) return 'ok'
  if (status === STATUS.DEGRADED) return 'warn'
  if (status === STATUS.PARTIAL_OUTAGE || status === STATUS.MAJOR_OUTAGE) return 'down'
  if (status === STATUS.MAINTENANCE) return 'warn'
  return 'unknown'
}

/** Headline for the whole page. */
export function overallHeadline(overall) {
  switch (overall) {
    case STATUS.OPERATIONAL: return 'All systems operational'
    case STATUS.DEGRADED: return 'Some systems degraded'
    case STATUS.PARTIAL_OUTAGE: return 'Partial outage'
    case STATUS.MAJOR_OUTAGE: return 'Major outage'
    case STATUS.MAINTENANCE: return 'Under maintenance'
    default: return 'Status unknown'
  }
}

/**
 * Turn the raw publicStatus/current doc into a render-ready view, applying the
 * staleness + missing-doc rules.
 *
 * @returns {{
 *   overall: string, stale: boolean, hasData: boolean, ageMs: number|null,
 *   generatedAt: number|null, ranAt: string|null,
 *   components: Array<{key,label,status,core,raw,recovering}>
 * }}
 */
export function computeStatusView(doc, nowMs, {staleAfterMs = STALE_AFTER_MS} = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()

  const buildComponents = (status) => COMPONENT_ORDER.map((key) => {
    const c = (doc && doc.components && doc.components[key]) || {}
    return {
      key,
      label: c.label || key,
      core: Boolean(c.core),
      status,
      raw: status,
      recovering: false,
    }
  })

  if (!doc || !doc.components) {
    return {
      overall: STATUS.UNKNOWN,
      stale: true,
      hasData: false,
      ageMs: null,
      generatedAt: null,
      ranAt: null,
      components: buildComponents(STATUS.UNKNOWN),
    }
  }

  const generatedAt = Number.isFinite(doc.generatedAt) ? doc.generatedAt : null
  const ageMs = generatedAt == null ? null : Math.max(0, now - generatedAt)
  const stale = ageMs == null || ageMs > staleAfterMs

  if (stale) {
    // Do NOT report the last-known state when monitoring is stale.
    return {
      overall: STATUS.UNKNOWN,
      stale: true,
      hasData: true,
      ageMs,
      generatedAt,
      ranAt: doc.ranAt || null,
      components: buildComponents(STATUS.UNKNOWN),
    }
  }

  const components = COMPONENT_ORDER.map((key) => {
    const c = (doc.components && doc.components[key]) || {}
    return {
      key,
      label: c.label || key,
      core: Boolean(c.core),
      status: c.status || STATUS.UNKNOWN,
      raw: c.raw || c.status || STATUS.UNKNOWN,
      recovering: Boolean(c.recovering),
    }
  })

  return {
    overall: doc.overall || STATUS.UNKNOWN,
    stale: false,
    hasData: true,
    ageMs,
    generatedAt,
    ranAt: doc.ranAt || null,
    components,
  }
}
