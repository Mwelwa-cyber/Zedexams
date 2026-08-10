/**
 * Unit tests for the Platform Control Center registry + pure logic
 * (src/features/adminSettings/lib/settingsRegistry.js + settingsCore.js).
 *
 * Plain-node assertion script — run with `node scripts/test-settings-registry.mjs`
 * or `npm run test:settings-registry`. Throws on the first failed assertion.
 */
import { SETTINGS_CATEGORIES, SETTINGS_GROUPS } from '../src/features/adminSettings/lib/settingsRegistry.js'
import {
  allFields,
  buildDefaults,
  denormalizeForSave,
  deriveInsights,
  diffKeys,
  exportConfig,
  filterCategories,
  getPath,
  normalizeSettings,
  setPath,
  validateImport,
} from '../src/features/adminSettings/lib/settingsCore.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed += 1
}

const FIELD_TYPES = new Set(['text', 'email', 'url', 'number', 'textarea', 'toggle', 'select', 'segmented'])

// ── registry integrity ─────────────────────────────────────────────────

{
  const groupIds = new Set(SETTINGS_GROUPS.map((g) => g.id))
  assert(groupIds.size === SETTINGS_GROUPS.length, 'group ids are unique')

  const catIds = new Set()
  for (const cat of SETTINGS_CATEGORIES) {
    assert(!catIds.has(cat.id), `category id "${cat.id}" is unique`)
    catIds.add(cat.id)
    assert(groupIds.has(cat.group), `category "${cat.id}" references a known group`)
    assert(typeof cat.label === 'string' && cat.label, `category "${cat.id}" has a label`)
    assert(typeof cat.icon === 'string' && cat.icon, `category "${cat.id}" has an icon name`)
    assert(Array.isArray(cat.sections), `category "${cat.id}" has sections array`)
    assert(Array.isArray(cat.links), `category "${cat.id}" has links array`)
    for (const link of cat.links) {
      assert(link.to?.startsWith('/admin'), `link "${link.label}" in "${cat.id}" points into /admin`)
    }
  }

  const keys = new Set()
  for (const field of allFields()) {
    assert(!keys.has(field.key), `field key "${field.key}" is unique`)
    keys.add(field.key)
    assert(FIELD_TYPES.has(field.type), `field "${field.key}" has a valid type (${field.type})`)
    assert(field.default !== undefined, `field "${field.key}" declares a default`)
    if (field.type === 'toggle') assert(typeof field.default === 'boolean', `toggle "${field.key}" default is boolean`)
    if (field.type === 'number') assert(typeof field.default === 'number', `number "${field.key}" default is a number`)
    if (field.type === 'select' || field.type === 'segmented') {
      assert(Array.isArray(field.options) && field.options.length >= 1, `"${field.key}" has options`)
      const values = field.options.map((o) => (typeof o === 'string' ? o : o.value))
      assert(values.includes(field.default), `"${field.key}" default is one of its options`)
    }
  }

  // Back-compat: every key the OLD settings page wrote must still exist so
  // saved docs keep round-tripping (registrationOpen is derived, not a field).
  for (const legacy of ['siteName', 'supportEmail', 'maintenanceMode', 'maintenanceMessage', 'maxExamAttemptsPerDay', 'defaultGrade', 'defaultTheme', 'androidLatestBuild', 'androidApkUrl']) {
    assert(keys.has(legacy), `legacy settings key "${legacy}" still exists in the registry`)
  }
  assert(keys.has('featureFlags.universalDrafts'), 'universalDrafts flag is registered (consumed by useStudioInputDraft)')
}

// ── path helpers ───────────────────────────────────────────────────────

{
  const obj = { a: { b: 1 }, top: 2 }
  assert(getPath(obj, 'a.b') === 1, 'getPath reads nested values')
  assert(getPath(obj, 'top') === 2, 'getPath reads flat values')
  assert(getPath(obj, 'a.missing.deep') === undefined, 'getPath tolerates missing branches')

  const next = setPath(obj, 'a.c', 3)
  assert(next.a.c === 3 && next.a.b === 1, 'setPath adds nested values without clobbering siblings')
  assert(obj.a.c === undefined, 'setPath is immutable')
  assert(setPath(obj, 'x', 9).x === 9, 'setPath sets flat values')
  assert(setPath({ f: 'notAnObject' }, 'f.g', 1).f.g === 1, 'setPath replaces non-object nodes')
}

// ── defaults + normalisation ───────────────────────────────────────────

{
  const defaults = buildDefaults()
  assert(defaults.siteName === 'ZedExams', 'defaults carry siteName')
  assert(defaults.featureFlags.universalDrafts === true, 'defaults nest dotted keys')
  assert(defaults.registrationMode === 'open', 'registration defaults to open')

  // legacy doc: only registrationOpen boolean
  const legacyClosed = normalizeSettings({ registrationOpen: false, siteName: 'Custom' })
  assert(legacyClosed.registrationMode === 'closed', 'registrationOpen:false maps to closed')
  assert(legacyClosed.siteName === 'Custom', 'stored values override defaults')
  const legacyOpen = normalizeSettings({ registrationOpen: true })
  assert(legacyOpen.registrationMode === 'open', 'registrationOpen:true maps to open')
  const explicit = normalizeSettings({ registrationOpen: true, registrationMode: 'invite' })
  assert(explicit.registrationMode === 'invite', 'explicit registrationMode wins over the legacy boolean')

  // save keeps the legacy boolean in sync
  assert(denormalizeForSave({ registrationMode: 'open' }).registrationOpen === true, 'open writes registrationOpen:true')
  assert(denormalizeForSave({ registrationMode: 'invite' }).registrationOpen === false, 'invite writes registrationOpen:false')
  assert(denormalizeForSave({ registrationMode: 'closed' }).registrationOpen === false, 'closed writes registrationOpen:false')
}

// ── diffing ────────────────────────────────────────────────────────────

{
  const base = buildDefaults()
  assert(diffKeys(base, base).length === 0, 'identical settings diff to nothing')
  const edited = setPath(setPath(base, 'siteName', 'New name'), 'featureFlags.universalDrafts', false)
  const diff = diffKeys(base, edited)
  assert(diff.includes('siteName') && diff.includes('featureFlags.universalDrafts') && diff.length === 2, 'diffKeys finds exactly the changed keys')
  // number fields round-trip through string inputs
  assert(diffKeys(base, setPath(base, 'maxExamAttemptsPerDay', '3')).length === 0, 'string/number equivalence does not count as a change')
}

// ── search ─────────────────────────────────────────────────────────────

{
  const everything = filterCategories('')
  assert(everything.length === SETTINGS_CATEGORIES.length, 'empty search returns every category')

  const maint = filterCategories('maintenance')
  assert(maint.some((e) => e.category.id === 'website'), 'searching "maintenance" surfaces the website category')
  const website = maint.find((e) => e.category.id === 'website')
  assert(website.sections.some((s) => s.fields.some((f) => f.key === 'maintenanceMode')), 'maintenanceMode field matches')

  const lenco = filterCategories('lenco')
  assert(lenco.some((e) => e.category.id === 'billing'), 'searching "lenco" surfaces billing via keywords')

  const none = filterCategories('zzz-no-such-setting')
  assert(none.length === 0, 'nonsense search matches nothing')
}

// ── import / export ────────────────────────────────────────────────────

{
  const form = setPath(buildDefaults(), 'siteName', 'Exported name')
  const payload = exportConfig(form, { exportedAt: '2026-07-08T00:00:00Z', exportedBy: 'admin@zedexams.com' })
  assert(payload.kind === 'zedexams-platform-config', 'export is tagged')
  assert(payload.values.siteName === 'Exported name', 'export carries values')
  assert(payload.values.featureFlags.universalDrafts === true, 'export nests dotted keys')

  const fresh = buildDefaults()
  const imported = validateImport(payload, fresh)
  assert(imported.errors.length === 0, 'exported config re-imports cleanly')
  assert(imported.values.siteName === 'Exported name', 'import applies values')
  assert(imported.applied.includes('siteName'), 'import reports applied keys')

  const bad = validateImport({ values: { maintenanceMode: 'yes', unknownKey: 1 } , kind: 'zedexams-platform-config' }, fresh)
  assert(bad.errors.some((e) => e.includes('maintenanceMode')), 'wrong types are rejected per-field')
  assert(!bad.applied.includes('unknownKey'), 'unknown keys are ignored')

  const notConfig = validateImport('a string', fresh)
  assert(notConfig.errors.length > 0 && notConfig.values === fresh, 'non-object import is rejected without touching the form')

  const empty = validateImport({}, fresh)
  assert(empty.errors.length > 0, 'an object with no recognised settings reports an error')
}

// ── insights ───────────────────────────────────────────────────────────

{
  const quiet = deriveInsights(buildDefaults(), {})
  assert(quiet.length === 1 && quiet[0].tone === 'good', 'no signals → single all-clear insight')

  const maint = deriveInsights({ ...buildDefaults(), maintenanceMode: true }, {})
  assert(maint.some((i) => i.id === 'maintenance' && i.tone === 'alert'), 'maintenance mode raises an alert')

  const closed = deriveInsights({ ...buildDefaults(), registrationMode: 'closed' }, {})
  assert(closed.some((i) => i.id === 'registration'), 'closed registration raises a warning')

  const budget = deriveInsights(
    { ...buildDefaults(), aiDailyBudgetUsd: 10, aiCostAlertsEnabled: true },
    { aiTodayUsd: 9 },
  )
  assert(budget.some((i) => i.id === 'ai-daily' && i.tone === 'warn'), '90% of daily budget warns')
  const over = deriveInsights(
    { ...buildDefaults(), aiDailyBudgetUsd: 10 },
    { aiTodayUsd: 12 },
  )
  assert(over.some((i) => i.id === 'ai-daily' && i.tone === 'alert'), 'blown daily budget alerts')
  const muted = deriveInsights(
    { ...buildDefaults(), aiDailyBudgetUsd: 10, aiCostAlertsEnabled: false },
    { aiTodayUsd: 12, aiAnomalous: true },
  )
  assert(!muted.some((i) => i.id.startsWith('ai-')), 'cost alerts toggle silences AI insights')

  const busy = deriveInsights(buildDefaults(), { pendingPayments: 2, agentQueue: 1, pendingContent: 3, health: { healthy: false, summary: '1 agent late' } })
  assert(busy.some((i) => i.id === 'payments'), 'pending payments surface')
  assert(busy.some((i) => i.id === 'agents'), 'agent queue surfaces')
  assert(busy.some((i) => i.id === 'content'), 'content queue surfaces')
  assert(busy.some((i) => i.id === 'fleet' && i.tone === 'alert'), 'unhealthy Marshal verdict alerts')
  assert(!busy.some((i) => i.id === 'all-clear'), 'all-clear only shows when nothing else does')
}

console.log(`test-settings-registry: ${passed} assertions passed`)
