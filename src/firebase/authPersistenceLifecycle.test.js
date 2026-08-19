/**
 * Node test for src/firebase/authPersistenceLifecycle.js — the rule that stops
 * Firebase Auth's IndexedDB persistence closing its database on every tab
 * switch, and the patch that enforces it.
 *
 * Run: node src/firebase/authPersistenceLifecycle.test.js
 */

import assert from 'node:assert/strict'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

// A minimal `window` the patch can bind to. Installed before the module is
// imported so the module sees the same globals a browser would.
const listeners = new Map()
globalThis.window = {
  addEventListener(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(fn)
  },
  removeEventListener(type, fn) {
    listeners.get(type)?.delete(fn)
  },
}
function dispatch(type, event) {
  for (const fn of Array.from(listeners.get(type) || [])) fn(event)
}
function boundTypes() {
  return [...listeners.entries()].filter(([, set]) => set.size > 0).map(([type]) => type).sort()
}

const { shouldTearDownPersistence, hardenAuthPersistenceLifecycle, HARDENED_FLAG } =
  await import('./authPersistenceLifecycle.js')

// ── The rule ─────────────────────────────────────────────────────────────
// This is the whole bug in one assertion: a hidden page is not a closing page.
ok('visibilitychange never tears down', shouldTearDownPersistence('visibilitychange', {}) === false)
ok('a hidden document never tears down', shouldTearDownPersistence('visibilitychange', { persisted: false }) === false)
ok('pagehide with persisted:false tears down', shouldTearDownPersistence('pagehide', { persisted: false }) === true)
// A bfcache-eligible hide can come back intact; closing under it recreates the
// wedge one pageshow later.
ok('pagehide with persisted:true does NOT tear down', shouldTearDownPersistence('pagehide', { persisted: true }) === false)
// `persisted` is required, not assumed: an event without it is not evidence
// the page is going away for good.
ok('pagehide with no persisted flag does NOT tear down', shouldTearDownPersistence('pagehide', {}) === false)
ok('pagehide with no event at all does NOT tear down', shouldTearDownPersistence('pagehide', undefined) === false)
ok('freeze does not tear down', shouldTearDownPersistence('freeze', {}) === false)
ok('unload does not tear down', shouldTearDownPersistence('unload', {}) === false)

// ── The patch ────────────────────────────────────────────────────────────
// A stand-in with the shape the SDK's IndexedDBLocalPersistence really has:
// two lifecycle-registration methods and two instance-level handlers.
function makeFakePersistenceClass() {
  class FakePersistence {
    constructor() {
      this.hideCount = 0
      this.showCount = 0
      this.onPageHide = () => { this.hideCount += 1 }
      this.onPageShow = () => { this.showCount += 1 }
    }
    registerLifecycleListeners() {
      window.addEventListener('pagehide', this.onPageHide)
      window.addEventListener('pageshow', this.onPageShow)
      // The line the patch exists to remove.
      window.addEventListener('visibilitychange', this.onPageHide)
    }
    unregisterLifecycleListeners() {
      window.removeEventListener('pagehide', this.onPageHide)
      window.removeEventListener('pageshow', this.onPageShow)
      window.removeEventListener('visibilitychange', this.onPageHide)
    }
  }
  return FakePersistence
}

const Fake = makeFakePersistenceClass()
ok('patch applies to a class with the expected shape', hardenAuthPersistenceLifecycle(Fake) === true)
ok('patch is idempotent', hardenAuthPersistenceLifecycle(Fake) === false)
ok('patch leaves a marker', Fake.prototype[HARDENED_FLAG] === true)

const instance = new Fake()
instance.registerLifecycleListeners()
ok('no visibilitychange listener is bound', !boundTypes().includes('visibilitychange'))
ok('pagehide and pageshow are bound', JSON.stringify(boundTypes()) === '["pagehide","pageshow"]')

// The regression, end to end: a tab switch must not close the database.
dispatch('visibilitychange', {})
ok('a tab switch does not tear persistence down', instance.hideCount === 0)

dispatch('pagehide', { persisted: true })
ok('a bfcache hide does not tear persistence down', instance.hideCount === 0)

dispatch('pagehide', { persisted: false })
ok('a real page teardown does tear persistence down', instance.hideCount === 1)

dispatch('pageshow', {})
ok('pageshow still reaches the SDK handler', instance.showCount === 1)

instance.unregisterLifecycleListeners()
ok('unregister removes every listener it added', boundTypes().length === 0)
dispatch('pagehide', { persisted: false })
ok('a torn-down instance is no longer called', instance.hideCount === 1)

// ── Failing safe ─────────────────────────────────────────────────────────
// A future SDK that renames these methods must be left ALONE rather than
// half-patched — a broken patch is worse than no patch, because the watchdog
// and the retry ladder still cover the wedge.
ok('an unrecognised shape is not patched', hardenAuthPersistenceLifecycle(class {}) === false)
ok('undefined is not patched', hardenAuthPersistenceLifecycle(undefined) === false)
ok('a non-class is not patched', hardenAuthPersistenceLifecycle(null) === false)

// ── The assumption, checked against the REAL SDK ─────────────────────────
// Everything above proves the patch is correct about a class of the shape it
// expects. It says nothing about whether @firebase/auth still HAS that shape —
// and the patch fails safe, so an SDK that renamed these methods would leave
// the wedge wide open with every test above still green. That is the failure
// this block exists to catch, and it is why the assertion is made against the
// browser build (`dist/esm`) rather than the package entry: node resolves
// `firebase/auth` to a build with no IndexedDB persistence at all, so importing
// the entry would "pass" by testing nothing.
const BROWSER_BUILD = new URL(
  '../../node_modules/@firebase/auth/dist/esm/index.js',
  import.meta.url,
)
let sdk = null
try {
  sdk = await import(BROWSER_BUILD.href)
} catch (e) {
  // Dependencies not installed (a bare checkout) — skip loudly rather than
  // reporting a pass. A skipped check that reads like a passing one is the
  // exact failure mode this block is guarding against.
  console.log(`  SKIP  @firebase/auth browser build not importable: ${e.message}`)
}
if (sdk) {
  const real = sdk.indexedDBLocalPersistence
  ok('SDK still exports indexedDBLocalPersistence as a class', typeof real === 'function' && !!real.prototype)
  ok('SDK still has registerLifecycleListeners', typeof real.prototype.registerLifecycleListeners === 'function')
  ok('SDK still has unregisterLifecycleListeners', typeof real.prototype.unregisterLifecycleListeners === 'function')
  // The patch must actually take on the real class, not merely on the fake.
  ok('patch applies to the real SDK class', hardenAuthPersistenceLifecycle(real) === true)

  // And it must behave: drive a real instance through a tab switch.
  const realInstance = new real()
  let closed = false
  realInstance.onPageHide = () => { closed = true }
  realInstance.registerLifecycleListeners()
  dispatch('visibilitychange', {})
  ok('a tab switch does not close the real SDK database', closed === false)
  dispatch('pagehide', { persisted: false })
  ok('a real teardown does close the real SDK database', closed === true)
  realInstance.unregisterLifecycleListeners()
}

console.log(`\nauthPersistenceLifecycle: ${passed} assertions passed`)
