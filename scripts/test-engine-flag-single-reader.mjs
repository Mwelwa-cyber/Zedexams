/**
 * §4 rule 3, made mechanical: the rollout flag is resolved in ONE module.
 *
 * The rule reads like a style preference and is not one. A flag read in four
 * components becomes four conditions, and they drift in the direction nobody
 * tests: one of them forgets the `=== true`, or buckets on a different id, or
 * checks the runner switch after the allow-list. Then the toggle in /admin
 * stops meaning what the person pressing it believes — during the one window
 * where being able to revert in seconds is the entire safety argument.
 *
 * Three checks, none of which an eye on a diff reliably performs:
 *
 *   1. The flag namespace `assessmentEngine` appears in `src/` only where it
 *      must: the resolver, the resolver's test, and the admin control's key
 *      strings. Any fourth file is reading the raw document.
 *   2. `resolveEngineDecision` is imported only by the single React binding
 *      (and its own test). A component calling the pure resolver directly
 *      would supply its own visitor id — which is how the paywall counter and
 *      the rollout end up disagreeing about who a visitor is.
 *   3. Every runner in `ENGINE_RUNNERS` has an admin control, with the
 *      fail-closed default. A switch with no way to flip it is not a rollback,
 *      and a runner added to the engine without one would be invisible in
 *      /admin until someone needed it in a hurry.
 *
 * Plain-node script (`npm run test:engine-flag-single-reader`), auto-discovered
 * by scripts/run-all-tests.mjs.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { ENGINE_FLAG_KEY, ENGINE_RUNNERS, normaliseRolloutUids } from '../src/engines/assessment-engine/flags.js'
import { SETTINGS_CATEGORIES } from '../src/components/admin/settings/settingsRegistry.js'
import {
  allFields, exportConfig, getPath, normalizeSettings, validateImport,
} from '../src/components/admin/settings/settingsCore.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

/**
 * Files allowed to name the flag namespace, and why each one has to.
 * A fourth entry is a decision, which is the point of writing the reason down.
 */
const NAMESPACE_READERS = new Map([
  ['src/engines/assessment-engine/flags.js', 'the resolver — it owns the key'],
  ['src/engines/assessment-engine/flags.test.js', 'pins the wire format so the spelling cannot drift'],
  ['src/components/admin/settings/settingsRegistry.js', 'the admin control\'s dotted key strings'],
])

/** Files allowed to name the resolver. Consumers go through the hook. */
const RESOLVER_IMPORTERS = new Map([
  ['src/engines/assessment-engine/flags.js', 'declares it'],
  ['src/engines/assessment-engine/flags.test.js', 'its own test'],
  ['src/hooks/useAssessmentEngineFlag.js', 'the one React binding'],
])

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

/**
 * Comments are stripped before scanning. A cutover PR that writes "gated by
 * featureFlags.assessmentEngine.quiz" above the branch it gates is documenting
 * the thing correctly, and a guard that fails on its own documentation gets
 * silenced rather than obeyed. `purity.test.js` strips for the same reason.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(jsx?|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

const files = walk(SRC).map((file) => ({
  path: relative(ROOT, file).split('\\').join('/'),
  source: stripComments(readFileSync(file, 'utf8')),
}))

console.log('assessment engine — the flag has ONE reader')

test('the scan found a tree to scan', () => {
  // A walk over nothing passes every check below vacuously.
  assert.ok(files.length > 400, `expected the src/ tree, found ${files.length} files`)
})

test(`only the declared modules name "${ENGINE_FLAG_KEY}"`, () => {
  const found = files
    .filter((f) => new RegExp(`\\b${ENGINE_FLAG_KEY}\\b`).test(f.source))
    .map((f) => f.path)
    .sort()
  const allowed = [...NAMESPACE_READERS.keys()].sort()
  const extra = found.filter((p) => !NAMESPACE_READERS.has(p))
  assert.deepEqual(extra, [],
    `these read the raw flag document instead of calling resolveEngineDecision:\n      ${extra.join('\n      ')}`)
  // The other direction: an allow-list entry that no longer names the flag is
  // a licence outliving its reason.
  assert.deepEqual(found, allowed,
    `an allowed reader no longer names the flag — remove it from NAMESPACE_READERS:\n      ${allowed.filter((p) => !found.includes(p)).join('\n      ')}`)
})

test('only the one React binding imports the resolver', () => {
  const found = files
    .filter((f) => /resolveEngineDecision/.test(f.source))
    .map((f) => f.path)
    .sort()
  assert.deepEqual(found, [...RESOLVER_IMPORTERS.keys()].sort(),
    'a consumer is calling the pure resolver directly — use useAssessmentEngineFlag, '
    + 'which supplies the same visitor id the free-preview counter keys on')
})

test('the binding resolves and does not decide', () => {
  // The failure this catches is a hook that grows its own condition — an
  // `if (isAdmin) return true` shortcut is exactly how the second resolver
  // arrives, and it would never look like a second resolver in review.
  const hook = files.find((f) => f.path === 'src/hooks/useAssessmentEngineFlag.js')
  assert.ok(hook, 'the binding is gone')
  for (const runner of ENGINE_RUNNERS) {
    assert.ok(!new RegExp(`['"\`]${runner}['"\`]`).test(hook.source),
      `the binding names the runner "${runner}" — it takes the runner as an argument and decides nothing`)
  }
  assert.ok(!/\brolloutPercent\b|\brolloutUids\b/.test(hook.source),
    'the binding reads a rollout field — that belongs to the resolver')
})

// ── The rollback is reachable ────────────────────────────────────────────────

const fields = new Map(allFields(SETTINGS_CATEGORIES).map((f) => [f.key, f]))

test('every runner has an admin toggle, defaulting to off', () => {
  for (const runner of ENGINE_RUNNERS) {
    const key = `featureFlags.${ENGINE_FLAG_KEY}.${runner}`
    const field = fields.get(key)
    assert.ok(field, `no admin control for "${runner}" — the rollback for that cutover is unreachable (expected ${key})`)
    assert.equal(field.type, 'toggle', `${key} must be a toggle`)
    assert.equal(field.default, false, `${key} must default to off — the old runner is the known-good path`)
  }
})

test('the ramp has an admin control, defaulting to nobody', () => {
  const field = fields.get(`featureFlags.${ENGINE_FLAG_KEY}.rolloutPercent`)
  assert.ok(field, 'no rollout control — a switch would go straight to 100% of a public route')
  assert.equal(field.type, 'number')
  assert.equal(field.default, 0)
  assert.equal(field.min, 0)
  assert.equal(field.max, 100)
})

test('the allow-list has an admin control, and it is REACHABLE', () => {
  // It shipped without one, documented as "edit the config JSON". That path
  // does not exist: `normalizeSettings`, `exportConfig` and `validateImport`
  // traverse the registry and nothing else, so an unregistered key is dropped
  // on import and missing from every export. The staff pilot — one account on
  // the engine before any learner — was therefore impossible to perform
  // through the advertised workflow, silently.
  const field = fields.get(`featureFlags.${ENGINE_FLAG_KEY}.rolloutUids`)
  assert.ok(field, 'no allow-list control — the staff-pilot step cannot be performed at all')
  assert.equal(field.type, 'textarea', 'a textarea stores text; there is no array control type')
  assert.equal(field.default, '')
})

test('the staff pilot survives a config export and re-import', () => {
  // The claim, end to end, rather than "a field is declared". `validateImport`
  // and `exportConfig` traverse `allFields()`, so an unregistered key is
  // dropped on the way in and absent on the way out — and both halves fail
  // silently, which is why this is asserted rather than eyeballed.
  const key = `featureFlags.${ENGINE_FLAG_KEY}.rolloutUids`
  const blank = normalizeSettings({})
  const imported = validateImport({ featureFlags: { [ENGINE_FLAG_KEY]: { rolloutUids: 'staff-1\nstaff-2' } } }, blank)
  assert.deepEqual(imported.errors, [], imported.errors.join('; '))
  assert.ok(imported.applied.includes(key), 'an imported allow-list is silently discarded')
  assert.equal(getPath(imported.values, key), 'staff-1\nstaff-2')
  assert.equal(getPath(exportConfig(imported.values).values, key), 'staff-1\nstaff-2',
    'the allow-list is missing from the export, so it cannot be round-tripped')
  // And the resolver reads what the admin page stored, without a translation
  // step in between — that is the whole point of one normaliser.
  assert.deepEqual(normaliseRolloutUids(getPath(imported.values, key)), ['staff-1', 'staff-2'])
})

test('no admin control exists for a runner the engine does not have', () => {
  // The mirror of the check above. A leftover toggle reads as a live switch
  // and resolves to `unknown-runner` — off, silently, forever.
  const NARROWING_CONTROLS = ['rolloutPercent', 'rolloutUids']
  const declared = [...fields.keys()].filter((k) => k.startsWith(`featureFlags.${ENGINE_FLAG_KEY}.`))
  const unknown = declared.filter((k) => {
    const leaf = k.split('.').pop()
    return !NARROWING_CONTROLS.includes(leaf) && !ENGINE_RUNNERS.includes(leaf)
  })
  assert.deepEqual(unknown, [], `these controls flip nothing: ${unknown.join(', ')}`)
})

console.log(`\nassessment engine flag readers: ${passed} passed`)
