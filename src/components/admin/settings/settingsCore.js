/**
 * settingsCore — pure helpers behind the Platform Control Center.
 *
 * No React/Firebase imports so scripts/test-settings-registry.mjs can run
 * everything under plain node. The component layer (AdminSettings.jsx) only
 * handles rendering + Firestore I/O; every decision that can be tested
 * lives here.
 */

// Explicit .js extension so plain-node test scripts can import this module
// directly (Vite resolves it either way).
import { SETTINGS_CATEGORIES } from './settingsRegistry.js'

// ── dotted-path access ("featureFlags.universalDrafts") ───────────────

export function getPath(obj, path) {
  return String(path).split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), obj)
}

/** Immutable set: returns a new object with `path` set to `value`. */
export function setPath(obj, path, value) {
  const parts = String(path).split('.')
  const [head, ...rest] = parts
  if (!rest.length) return { ...obj, [head]: value }
  const child = obj?.[head]
  return {
    ...obj,
    [head]: setPath(child && typeof child === 'object' ? child : {}, rest.join('.'), value),
  }
}

// ── registry traversal ─────────────────────────────────────────────────

export function allFields(categories = SETTINGS_CATEGORIES) {
  const out = []
  for (const cat of categories) {
    for (const section of cat.sections || []) {
      for (const field of section.fields || []) {
        out.push({ ...field, categoryId: cat.id, sectionId: section.id })
      }
    }
  }
  return out
}

export function buildDefaults(categories = SETTINGS_CATEGORIES) {
  let out = {}
  for (const field of allFields(categories)) {
    out = setPath(out, field.key, field.default)
  }
  return out
}

// ── load/save normalisation ────────────────────────────────────────────

/**
 * Merge the raw settings/global doc over registry defaults and derive
 * back-compat values. `registrationMode` supersedes the legacy boolean
 * `registrationOpen`; older docs only carry the boolean.
 */
export function normalizeSettings(raw = {}, categories = SETTINGS_CATEGORIES) {
  let form = buildDefaults(categories)
  for (const field of allFields(categories)) {
    const v = getPath(raw, field.key)
    if (v !== undefined) form = setPath(form, field.key, v)
  }
  if (getPath(raw, 'registrationMode') === undefined && raw.registrationOpen !== undefined) {
    form = setPath(form, 'registrationMode', raw.registrationOpen ? 'open' : 'closed')
  }
  return form
}

/**
 * Values written back to settings/global. Keeps the legacy
 * `registrationOpen` boolean in sync so existing consumers keep working.
 */
export function denormalizeForSave(form) {
  return {
    ...form,
    registrationOpen: form.registrationMode === 'open',
  }
}

/** Field keys whose values differ between two settings objects. */
export function diffKeys(baseline, form, categories = SETTINGS_CATEGORIES) {
  return allFields(categories)
    .filter((f) => !valuesEqual(getPath(baseline, f.key), getPath(form, f.key)))
    .map((f) => f.key)
}

function valuesEqual(a, b) {
  if (a === b) return true
  // number inputs round-trip through strings
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return false
}

// ── search ─────────────────────────────────────────────────────────────

function fieldHaystack(field) {
  return [field.label, field.key, field.help, ...(field.keywords || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * Filter the registry down to what matches `term`. Returns
 * [{ category, sections, links, matches }] where `sections` only contain
 * matching fields (all fields when the category itself matches) and
 * `matches` is the count shown next to the sidebar item. Empty term
 * returns everything with matches = 0.
 */
export function filterCategories(term, categories = SETTINGS_CATEGORIES) {
  const t = String(term || '').trim().toLowerCase()
  if (!t) {
    return categories.map((category) => ({
      category,
      sections: category.sections || [],
      links: category.links || [],
      matches: 0,
    }))
  }
  const out = []
  for (const category of categories) {
    const catHay = [category.label, category.blurb, ...(category.keywords || [])].join(' ').toLowerCase()
    const catHit = catHay.includes(t)
    const sections = []
    let fieldMatches = 0
    for (const section of category.sections || []) {
      const sectionHit = `${section.title || ''} ${section.description || ''}`.toLowerCase().includes(t)
      const fields = (section.fields || []).filter((f) => sectionHit || catHit || fieldHaystack(f).includes(t))
      if (fields.length) {
        fieldMatches += fields.length
        sections.push({ ...section, fields })
      }
    }
    const links = (category.links || []).filter(
      (l) => catHit || `${l.label} ${l.description || ''}`.toLowerCase().includes(t),
    )
    if (catHit || fieldMatches || links.length) {
      out.push({ category, sections, links, matches: fieldMatches + links.length || (catHit ? 1 : 0) })
    }
  }
  return out
}

// ── configuration import/export ────────────────────────────────────────

export function exportConfig(form, meta = {}) {
  const values = {}
  for (const field of allFields()) {
    const v = getPath(form, field.key)
    if (v !== undefined) setLeaf(values, field.key, v)
  }
  return {
    kind: 'zedexams-platform-config',
    version: 1,
    exportedAt: meta.exportedAt || null,
    exportedBy: meta.exportedBy || null,
    values,
  }
}

function setLeaf(target, path, value) {
  const parts = String(path).split('.')
  let node = target
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== 'object' || node[part] == null) node[part] = {}
    node = node[part]
  }
  node[parts[parts.length - 1]] = value
}

/**
 * Validate a parsed import payload against the registry. Only known field
 * keys are applied; wrong types are rejected per-field. Returns
 * { values, applied, errors } — values is the current form with valid
 * entries applied (caller stages it as unsaved changes).
 */
export function validateImport(payload, currentForm) {
  const errors = []
  const applied = []
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { values: currentForm, applied, errors: ['Not a configuration object.'] }
  }
  const values = payload.kind === 'zedexams-platform-config' ? payload.values : payload
  if (!values || typeof values !== 'object') {
    return { values: currentForm, applied, errors: ['No values found in the file.'] }
  }
  let form = currentForm
  for (const field of allFields()) {
    const v = getPath(values, field.key)
    if (v === undefined) continue
    const err = typeError(field, v)
    if (err) {
      errors.push(`${field.key}: ${err}`)
      continue
    }
    form = setPath(form, field.key, v)
    applied.push(field.key)
  }
  if (!applied.length && !errors.length) errors.push('The file contains no recognised settings.')
  return { values: form, applied, errors }
}

function typeError(field, v) {
  switch (field.type) {
    case 'toggle':
      return typeof v === 'boolean' ? null : 'expected true/false'
    case 'number':
      return Number.isFinite(Number(v)) ? null : 'expected a number'
    case 'select':
    case 'segmented': {
      const allowed = (field.options || []).map((o) => (typeof o === 'string' ? o : o.value))
      return allowed.includes(v) ? null : `expected one of ${allowed.join(', ')}`
    }
    default:
      return typeof v === 'string' ? null : 'expected text'
  }
}

// ── insights (deterministic — no model calls) ──────────────────────────

/**
 * Derive the "AI Insights & Alerts" feed from live stats + current
 * settings. Pure and honest: every line is computed from real numbers the
 * dashboard already loaded; nothing is fabricated.
 *
 * stats: { aiTodayUsd, aiMonthUsd, aiAnomalous, pendingPayments,
 *          agentQueue, pendingContent, health: {healthy, summary} | null }
 */
export function deriveInsights(settings = {}, stats = {}) {
  const out = []
  const push = (id, tone, text, action) => out.push({ id, tone, text, action })

  if (settings.maintenanceMode) {
    push('maintenance', 'alert', 'Maintenance mode is ON — non-admin sign-ins are blocked.', { label: 'Review', category: 'website' })
  }
  if (settings.registrationMode && settings.registrationMode !== 'open') {
    push('registration', 'warn', `Registration is ${settings.registrationMode === 'invite' ? 'invite-only' : 'closed'} — new users cannot self-register.`, { label: 'Review', category: 'registration' })
  }

  const alerts = settings.aiCostAlertsEnabled !== false
  const daily = Number(settings.aiDailyBudgetUsd) || 0
  const monthly = Number(settings.aiMonthlyBudgetUsd) || 0
  if (alerts && daily > 0 && Number.isFinite(stats.aiTodayUsd)) {
    const pct = Math.round((stats.aiTodayUsd / daily) * 100)
    if (pct >= 80) {
      push('ai-daily', pct >= 100 ? 'alert' : 'warn', `Today's AI spend is at ${pct}% of the daily budget ($${stats.aiTodayUsd.toFixed(2)} of $${daily.toFixed(2)}).`, { label: 'AI costs', to: '/admin/ai-costs' })
    }
  }
  if (alerts && monthly > 0 && Number.isFinite(stats.aiMonthUsd)) {
    const pct = Math.round((stats.aiMonthUsd / monthly) * 100)
    if (pct >= 80) {
      push('ai-monthly', pct >= 100 ? 'alert' : 'warn', `30-day AI spend is at ${pct}% of the monthly budget ($${stats.aiMonthUsd.toFixed(2)} of $${monthly.toFixed(2)}).`, { label: 'AI costs', to: '/admin/ai-costs' })
    }
  }
  if (alerts && stats.aiAnomalous) {
    push('ai-anomaly', 'warn', "Today's AI spend is more than 2× the recent daily median.", { label: 'AI costs', to: '/admin/ai-costs' })
  }

  if (stats.health && stats.health.healthy === false) {
    push('fleet', 'alert', `Marshal reports the agent fleet unhealthy${stats.health.summary ? `: ${stats.health.summary}` : '.'}`, { label: 'Company HQ', to: '/admin/company' })
  }
  if (Number(stats.pendingPayments) > 0) {
    push('payments', 'info', `${stats.pendingPayments} payment${stats.pendingPayments === 1 ? '' : 's'} pending confirmation.`, { label: 'Payments', to: '/admin/payments' })
  }
  if (Number(stats.agentQueue) > 0) {
    push('agents', 'info', `${stats.agentQueue} agent job${stats.agentQueue === 1 ? '' : 's'} awaiting approval.`, { label: 'AI agents', to: '/admin/agents' })
  }
  if (Number(stats.pendingContent) > 0) {
    push('content', 'info', `${stats.pendingContent} content item${stats.pendingContent === 1 ? '' : 's'} in the approval queue.`, { label: 'Approvals', to: '/admin/approvals' })
  }

  if (!out.length) {
    push('all-clear', 'good', 'No alerts — the platform looks healthy.', null)
  }
  return out
}
