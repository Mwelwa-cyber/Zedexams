/**
 * The settings route table, and the promise that no old link breaks.
 *
 * The redirect is the part worth testing rather than eyeballing: `?section=`
 * values are sitting in sent emails, in push notification payloads and in the
 * parent app's own instructions to guardians, none of which can be edited now.
 * A value that stops resolving does not throw — it lands the reader somewhere
 * arbitrary, which is exactly the failure the split was meant to end.
 *
 * Run: npm run test:learner-settings-routes
 */

import assert from 'node:assert/strict'

import {
  SETTINGS_ROUTES,
  SETTINGS_PATHS,
  redirectForSection,
  sectionHasRoute,
} from './settingsRoutes.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

/* ── The table ───────────────────────────────────────────────────────────── */

test('paths and ids are unique', () => {
  const paths = SETTINGS_ROUTES.map((r) => r.path)
  const ids = SETTINGS_ROUTES.map((r) => r.id)
  assert.equal(new Set(paths).size, paths.length, 'duplicate path')
  assert.equal(new Set(ids).size, ids.length, 'duplicate id')
})

test('every path is a bare segment — no slashes, no query, no leading slash', () => {
  for (const r of SETTINGS_ROUTES) {
    assert.match(r.path, /^[a-z][a-z-]*$/, `"${r.path}" is not a plain segment`)
  }
})

test('every route carries a label a child could read', () => {
  for (const r of SETTINGS_ROUTES) {
    assert.ok(r.label && r.label.trim().length > 2, `${r.id} has no label`)
  }
})

test('SETTINGS_PATHS are absolute and match the table', () => {
  assert.equal(SETTINGS_PATHS.length, SETTINGS_ROUTES.length)
  for (const p of SETTINGS_PATHS) assert.ok(p.startsWith('/settings/'), p)
})

test('the two screens that used to share a URL now have different ones', () => {
  const profile = redirectForSection('profile')
  const del = redirectForSection('delete')
  assert.notEqual(profile, del, 'Name & avatar and Delete account must not be the same route')
  assert.equal(profile, '/settings/profile')
  assert.equal(del, '/settings/delete')
})

/* ── The redirect ────────────────────────────────────────────────────────── */

test('every section the app ever wrote resolves somewhere', () => {
  // Every value that has appeared in a `?section=` link: the ten settings
  // sections plus the panel-only `parent`. None may resolve to undefined or
  // throw, because each is sitting in a link somebody can still click.
  const written = [
    'account', 'learning', 'progress', 'notifications', 'appearance',
    'accessibility', 'ai', 'premium', 'security', 'help', 'parent',
  ]
  for (const s of written) {
    const to = redirectForSection(s)
    assert.ok(typeof to === 'string' && to.startsWith('/settings'), `${s} -> ${to}`)
  }
})

test('the sections with their own screen land on it', () => {
  assert.equal(redirectForSection('account'), '/settings/profile')
  assert.equal(redirectForSection('parent'), '/settings/guardian')
  assert.equal(redirectForSection('help'), '/settings/help')
  assert.equal(redirectForSection('security'), '/settings/security')
  assert.equal(redirectForSection('notifications'), '/settings/notifications')
  assert.equal(redirectForSection('learning'), '/settings/learning')
})

test('a section with no screen lands on the index, never on an unrelated one', () => {
  for (const s of ['appearance', 'accessibility', 'ai', 'premium', 'progress']) {
    assert.equal(redirectForSection(s), '/settings', s)
    assert.equal(sectionHasRoute(s), false, s)
  }
})

test('an unknown, empty or missing section lands on the index', () => {
  for (const s of ['', null, undefined, 'nonsense', '   ', 'billing']) {
    assert.equal(redirectForSection(s), '/settings', String(s))
  }
})

test('the parameter is matched case-insensitively and trimmed', () => {
  assert.equal(redirectForSection(' Account '), '/settings/profile')
  assert.equal(redirectForSection('PARENT'), '/settings/guardian')
})

test('no section redirects to a path outside /settings', () => {
  const all = [
    'account', 'profile', 'security', 'privacy', 'notifications', 'learning',
    'parent', 'guardian', 'data', 'help', 'delete', 'appearance',
    'accessibility', 'ai', 'premium', 'progress', 'junk',
  ]
  for (const s of all) {
    const to = redirectForSection(s)
    assert.ok(/^\/settings(\/[a-z-]+)?$/.test(to), `${s} -> ${to} escapes /settings`)
  }
})

test('every redirect target that is not the index is a declared route', () => {
  const declared = new Set(SETTINGS_PATHS)
  for (const s of ['account', 'parent', 'help', 'security', 'notifications', 'learning', 'data', 'delete']) {
    const to = redirectForSection(s)
    assert.ok(declared.has(to), `${s} -> ${to} is not in SETTINGS_ROUTES`)
  }
})

/* ── Runner ──────────────────────────────────────────────────────────────── */

let failed = 0
for (const [name, fn] of tests) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}
console.log(`\nlearner settings routes: ${tests.length - failed}/${tests.length} passed`)
if (failed) {
  throw new Error(`${failed} learner-settings-route test(s) failed`)
}
