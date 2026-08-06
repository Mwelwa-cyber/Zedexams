/**
 * The stable visitor id — the properties two different systems depend on.
 *
 * Both the free-preview counter and the engine's rollout bucket key on this
 * value, so what is worth asserting is not "does it return a string" but the
 * two properties those consumers assume: it is the SAME across calls on a
 * device, and a browser that refuses storage does not mint a fresh identity
 * every call.
 *
 * Plain-node script (`npm run test:visitor-id`). `window` is stubbed rather
 * than jsdom-imported — the module reaches for exactly one API, and a fake
 * that can be made to THROW is how the private-mode path gets covered at all.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getOrCreateAnonId, resolveVisitorId, NO_STORAGE_VISITOR_ID } from './visitorId.js'

// Cases are COLLECTED and run sequentially at the end, rather than executed as
// they are declared. The first version called `fn()` and immediately printed a
// tick, which is correct for a synchronous case and a lie for an async one: the
// body had not run yet, so it reported ✓, and the later failure arrived as an
// unhandled rejection AFTER the summary line. That run printed "11 passed" and
// exited 1. Awaiting each case in turn makes an async case impossible to pass
// by accident, and keeps `globalThis.window` from being swapped underneath one.
const cases = []
function test(name, fn) {
  cases.push({ name, fn })
}

/** A localStorage stand-in. `mode` makes it fail the way real ones do. */
function fakeWindow({ mode = 'ok', seed = {} } = {}) {
  if (mode === 'blocked') {
    return { get localStorage() { throw new Error('access denied') } }
  }
  const store = new Map(Object.entries(seed))
  return {
    __store: store,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        if (mode === 'quota') throw new Error('QuotaExceededError')
        store.set(k, String(v))
      },
      removeItem: (k) => store.delete(k),
    },
  }
}

console.log('visitor id — the one rule two systems key on')

globalThis.window = fakeWindow()

test('a signed-in visitor IS their uid', () => {
  assert.equal(resolveVisitorId('learner-1'), 'learner-1')
})

test('an anonymous visitor gets the same id twice — the whole point', () => {
  const first = getOrCreateAnonId()
  assert.equal(getOrCreateAnonId(), first)
  assert.equal(resolveVisitorId(null), first)
  assert.equal(resolveVisitorId(undefined), first)
  assert.equal(resolveVisitorId(''), first)
})

test('the minted id is written to the documented key', () => {
  // Pinned because a rename would silently reset every free-preview counter
  // and re-draw every rollout bucket on every device at once.
  assert.equal(globalThis.window.__store.get('zedexams:anonId'), getOrCreateAnonId())
})

test('an existing id is adopted, not replaced', () => {
  globalThis.window = fakeWindow({ seed: { 'zedexams:anonId': 'anon-existing' } })
  assert.equal(getOrCreateAnonId(), 'anon-existing')
})

test('a storage write that throws still yields a usable id', () => {
  globalThis.window = fakeWindow({ mode: 'quota' })
  assert.match(getOrCreateAnonId(), /^anon-/)
})

test('an id that could not be WRITTEN is still the same id on the next call', async () => {
  // The case the single-call assertion above missed, and it is the whole
  // property: under quota — or in a browser that reads but refuses writes —
  // nothing is read back, so a naive implementation mints a fresh id every
  // call. An anonymous visitor then moves between rollout buckets whenever the
  // hook recomputes, which a settings update alone is enough to trigger. It
  // also breaks the free-preview counter's own two halves against each other:
  // `recordAnsweredQuestion` resolves the id, then `getAnsweredCount` resolves
  // it AGAIN, so a churning id makes one function read and write different keys.
  //
  // A fresh module instance, because the memo is per page load and the cases
  // above have already used this one.
  globalThis.window = fakeWindow({ mode: 'quota' })
  const fresh = await import('./visitorId.js?case=quota-stability')
  const first = fresh.getOrCreateAnonId()
  assert.match(first, /^anon-/)
  for (let i = 0; i < 5; i += 1) assert.equal(fresh.getOrCreateAnonId(), first)
  // Nothing reached storage, so this is the memo answering, not a lucky read.
  assert.equal(globalThis.window.__store.size, 0)
})

test('a write that starts working adopts the id already in use', async () => {
  // Quota is a state a browser can leave. When it does, the id this page load
  // has been using becomes the persisted one rather than being replaced by a
  // new one — otherwise recovering from quota moves the visitor's bucket.
  globalThis.window = fakeWindow({ mode: 'quota' })
  const fresh = await import('./visitorId.js?case=quota-recovery')
  const id = fresh.getOrCreateAnonId()
  globalThis.window = fakeWindow()
  assert.equal(fresh.getOrCreateAnonId(), id)
  assert.equal(globalThis.window.__store.get('zedexams:anonId'), id)
})

test('a stored id beats one this page load minted', async () => {
  // The memo must never outrank storage: that value is shared with other tabs
  // and survives reloads, so it is the more authoritative of the two.
  globalThis.window = fakeWindow({ mode: 'quota' })
  const fresh = await import('./visitorId.js?case=stored-wins')
  const minted = fresh.getOrCreateAnonId()
  globalThis.window = fakeWindow({ seed: { 'zedexams:anonId': 'anon-from-another-tab' } })
  assert.equal(fresh.getOrCreateAnonId(), 'anon-from-another-tab')
  assert.notEqual(fresh.getOrCreateAnonId(), minted)
})

test('no storage at all resolves to ONE constant, not a fresh id per call', () => {
  // A random id per call would put a storage-less visitor in a different
  // rollout bucket on every page view — flapping between runners, which is
  // the failure §4.2 buckets on a stable id to prevent.
  globalThis.window = fakeWindow({ mode: 'blocked' })
  assert.equal(getOrCreateAnonId(), NO_STORAGE_VISITOR_ID)
  assert.equal(getOrCreateAnonId(), NO_STORAGE_VISITOR_ID)
  delete globalThis.window
  assert.equal(getOrCreateAnonId(), NO_STORAGE_VISITOR_ID)
})

test('a uid still wins when there is no storage', () => {
  assert.equal(resolveVisitorId('learner-2'), 'learner-2')
})

test('pastPaperQuiz still exports both names — the move promised that', () => {
  // Asserted against the SOURCE: importing pastPaperQuiz.js under node would
  // initialise the Firebase SDK. PublicQuizRunner and the counter both import
  // from there, so a move that dropped the re-export would break the canary's
  // own route.
  const src = readFileSync(new URL('./pastPaperQuiz.js', import.meta.url), 'utf8')
  const reExport = /export\s*\{([^}]*)\}\s*from\s*['"]\.\/visitorId['"]/.exec(src)
  assert.ok(reExport, 'pastPaperQuiz.js no longer re-exports from ./visitorId')
  assert.match(reExport[1], /getOrCreateAnonId/)
  assert.match(reExport[1], /resolveVisitorId/)
})

let passed = 0
for (const { name, fn } of cases) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log(`\nvisitor id: ${passed} passed`)
