/**
 * Node test for src/firebase/authSessionGuard.js — the patches that keep a
 * working session on disk when Firebase's boot-time check fails for a reason
 * that says nothing about the credential.
 *
 * Run: node src/firebase/authSessionGuard.test.js
 */

import assert from 'node:assert/strict'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

// A localStorage the guard can read the session hint out of. Installed before
// the module is imported so it sees the same globals a browser would.
//
// defineProperty rather than `globalThis.localStorage = {...}`: a plain
// assignment declares, to anything reading this repository as one program,
// that THIS Map is the app's Web Storage. CodeQL then resolves every
// production localStorage read to this fake's getItem and every safeStorage
// write to its setItem, which welds unrelated modules together through a
// store that only exists inside this file -- 17 alerts across src/ rode that
// one line. The property is configurable so the fake stays removable, which
// is what a test double should have been anyway.
const store = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
})

const {
  __resetAuthSessionGuardForTests,
  disarmAuthSessionGuard,
  getBootVerdict,
  guardPersistenceRemoval,
  installVerificationObserver,
  isPersistedSessionKey,
  recordVerificationExchange,
  wasSessionPreserved,
  GUARDED_FLAG,
} = await import('./authSessionGuard.js')

const { AUTH_HINT_KEY } = await import('./authSessionHint.js')
const { INFRASTRUCTURAL, OK, TERMINAL } = await import('./authBootVerdict.js')

const LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIza'
const SESSION_KEY = 'firebase:authUser:AIzaSyTest:[DEFAULT]'

// ── The key we protect, and the ones we do not ───────────────────────────
ok('the persisted user key is a session key', isPersistedSessionKey(SESSION_KEY) === true)
ok('the redirect user is not a session key', isPersistedSessionKey('firebase:redirectUser:AIza:[DEFAULT]') === false)
ok('the persistence marker is not a session key', isPersistedSessionKey('firebase:persistence:AIza:[DEFAULT]') === false)
ok('a non-string is not a session key', isPersistedSessionKey(null) === false)

// A stand-in with the shape the SDK's persistence classes really have: a
// prototype carrying an async `_remove`.
function makeFakePersistenceClass() {
  const removed = []
  class FakePersistence {
    async _remove(key) { removed.push(key); return 'removed' }
  }
  return { FakePersistence, removed }
}

// ── The removal guard ────────────────────────────────────────────────────
{
  __resetAuthSessionGuardForTests()
  store.set(AUTH_HINT_KEY, '1')
  const { FakePersistence, removed } = makeFakePersistenceClass()
  ok('the patch applies', guardPersistenceRemoval(FakePersistence) === true)
  ok('the patch marks the prototype', FakePersistence.prototype[GUARDED_FLAG] === true)
  ok('a second application is a no-op', guardPersistenceRemoval(FakePersistence) === false)

  const instance = new FakePersistence()

  // Not armed: the boot window has not been opened, so nothing is second-guessed.
  await instance._remove(SESSION_KEY)
  ok('an unarmed guard lets the removal through', removed.length === 1)

  // Arm by hand (installAuthSessionGuard is exercised through config.js in the
  // app; here we want the guard alone, with no fetch target).
  const { installAuthSessionGuard } = await import('./authSessionGuard.js')
  installAuthSessionGuard({ persistences: [], fetchTarget: null })

  recordVerificationExchange(LOOKUP, { status: 429, body: { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } } })
  ok('a rate limit records as infrastructural', getBootVerdict() === INFRASTRUCTURAL)
  await instance._remove(SESSION_KEY)
  ok('a rate-limited boot check does NOT delete the session', removed.length === 1)
  ok('the rescue is reported', wasSessionPreserved() === true)

  // The other keys still clear even mid-rescue — the redirect user is cleaned
  // up on every boot and holding it would break the redirect sign-in flow.
  await instance._remove('firebase:redirectUser:AIzaSyTest:[DEFAULT]')
  ok('the redirect user still clears during a rescue', removed.length === 2)
}

// ── A real rejection still ends the session ──────────────────────────────
{
  __resetAuthSessionGuardForTests()
  store.set(AUTH_HINT_KEY, '1')
  const { FakePersistence, removed } = makeFakePersistenceClass()
  guardPersistenceRemoval(FakePersistence)
  const { installAuthSessionGuard } = await import('./authSessionGuard.js')
  installAuthSessionGuard({ persistences: [], fetchTarget: null })

  recordVerificationExchange(LOOKUP, { status: 400, body: { error: { message: 'TOKEN_EXPIRED' } } })
  ok('an expired token records as terminal', getBootVerdict() === TERMINAL)
  await new FakePersistence()._remove(SESSION_KEY)
  ok('a rejected credential IS deleted', removed.length === 1)
  ok('and nothing claims a rescue', wasSessionPreserved() === false)
}

// ── Disarming ends the window ────────────────────────────────────────────
{
  __resetAuthSessionGuardForTests()
  store.set(AUTH_HINT_KEY, '1')
  const { FakePersistence, removed } = makeFakePersistenceClass()
  guardPersistenceRemoval(FakePersistence)
  const { installAuthSessionGuard } = await import('./authSessionGuard.js')
  installAuthSessionGuard({ persistences: [], fetchTarget: null })
  recordVerificationExchange(LOOKUP, { status: 500 })

  const outcome = disarmAuthSessionGuard()
  ok('disarming hands back the outcome', outcome.preserved === false && outcome.verdict === INFRASTRUCTURAL)
  // The outcome is read ONCE. Left standing, it would still say "rescued" when
  // the user later taps "Log out", and the caller would reload them back in.
  ok('the outcome is cleared on read', disarmAuthSessionGuard().preserved === false)
  ok('and the verdict is cleared with it', getBootVerdict() === null)
  // This is the sign-out case. A guard that stayed armed would keep a user
  // signed in after they tapped "Log out".
  await new FakePersistence()._remove(SESSION_KEY)
  ok('a sign-out after boot deletes the session', removed.length === 1)
}

// ── A rescue is reported exactly once ────────────────────────────────────
{
  __resetAuthSessionGuardForTests()
  store.set(AUTH_HINT_KEY, '1')
  const { FakePersistence } = makeFakePersistenceClass()
  guardPersistenceRemoval(FakePersistence)
  const { installAuthSessionGuard } = await import('./authSessionGuard.js')
  installAuthSessionGuard({ persistences: [], fetchTarget: null })
  recordVerificationExchange(LOOKUP, { status: 503 })
  await new FakePersistence()._remove(SESSION_KEY)
  ok('the rescue is handed back once', disarmAuthSessionGuard().preserved === true)
  ok('and never a second time', disarmAuthSessionGuard().preserved === false)
  ok('nor through the accessor', wasSessionPreserved() === false)
}

// ── The fetch observer ───────────────────────────────────────────────────
{
  __resetAuthSessionGuardForTests()
  const { installAuthSessionGuard } = await import('./authSessionGuard.js')

  const calls = []
  const target = {
    fetch: async (input) => {
      calls.push(input)
      return {
        status: 429,
        clone: () => ({ json: async () => ({ error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } }) }),
      }
    },
  }
  const original = target.fetch
  installAuthSessionGuard({ persistences: [], fetchTarget: target })
  ok('the observer wraps fetch', target.fetch !== original)

  const res = await target.fetch(LOOKUP, { method: 'POST' })
  // The response object must come back untouched — the SDK parses it next.
  ok('the response is passed through unchanged', res.status === 429)
  ok('the request reached the real fetch', calls.length === 1 && calls[0] === LOOKUP)
  // The body read is fire-and-forget, so let the microtasks drain.
  await new Promise((resolve) => setTimeout(resolve, 0))
  ok('the observer recorded the verdict', getBootVerdict() === INFRASTRUCTURAL)

  // An unrelated request must not move the verdict.
  recordVerificationExchange('https://zedexams.com/api/ai/chat', { status: 500 })
  ok('an unrelated request leaves the verdict alone', getBootVerdict() === INFRASTRUCTURAL)

  // Disarming puts the browser's own fetch back.
  disarmAuthSessionGuard()
  ok('disarming restores fetch', target.fetch === original)
}

// ── The observer never clobbers a later wrapper ──────────────────────────
{
  __resetAuthSessionGuardForTests()
  const target = { fetch: async () => ({ status: 200, clone: () => ({ json: async () => ({}) }) }) }
  const undo = installVerificationObserver(target)
  // Something else (Sentry, an extension) wraps fetch after us.
  const later = async () => ({ status: 204, clone: () => ({ json: async () => ({}) }) })
  target.fetch = later
  undo()
  ok('teardown leaves a later wrapper in place', target.fetch === later)
}

// ── A successful check leaves everything alone ───────────────────────────
{
  __resetAuthSessionGuardForTests()
  store.set(AUTH_HINT_KEY, '1')
  const { FakePersistence, removed } = makeFakePersistenceClass()
  guardPersistenceRemoval(FakePersistence)
  const { installAuthSessionGuard } = await import('./authSessionGuard.js')
  installAuthSessionGuard({ persistences: [], fetchTarget: null })
  recordVerificationExchange(LOOKUP, { status: 200, body: { users: [{ localId: 'u1' }] } })
  ok('a healthy check records ok', getBootVerdict() === OK)
  // Nothing removed anything, so nothing was rescued — the ordinary case must
  // not report a rescue, or AuthContext would reload on every clean boot.
  ok('a healthy boot reports no rescue', wasSessionPreserved() === false)
  ok('and nothing was removed', removed.length === 0)
}

// ── A signed-out visitor is never held ───────────────────────────────────
{
  __resetAuthSessionGuardForTests()
  store.delete(AUTH_HINT_KEY)
  const { FakePersistence, removed } = makeFakePersistenceClass()
  guardPersistenceRemoval(FakePersistence)
  const { installAuthSessionGuard } = await import('./authSessionGuard.js')
  installAuthSessionGuard({ persistences: [], fetchTarget: null })
  recordVerificationExchange(LOOKUP, { status: 500 })
  await new FakePersistence()._remove(SESSION_KEY)
  ok('no hint means the removal goes through', removed.length === 1)
  ok('and no rescue is claimed', wasSessionPreserved() === false)
}


/* ── The SDK's real boot sequence ─────────────────────────────────────────────
 *
 * The guard's job is to tell a boot-check FAILURE apart from every other reason
 * the SDK removes the session key. The one it used to get wrong is routine and
 * happens on every single cold start.
 *
 * @firebase/auth 1.13.4, PersistenceUserManager.create — the last thing it does
 * before handing back the manager:
 *
 *   // Attempt to clear the key in other persistences but ignore errors. This
 *   // helps prevent issues such as users getting stuck with a previous account
 *   // after signing out and refreshing the tab.
 *   await Promise.all(persistenceHierarchy.map(async (persistence) => {
 *     if (persistence !== selectedPersistence) {
 *       try { await persistence._remove(key) } catch {}
 *     }
 *   }))
 *
 * `getAuth()` passes [indexedDB, browserLocal, browserSession]. indexedDB wins,
 * so the key is removed from the other two — during create(), which runs BEFORE
 * initializeCurrentUser() and therefore before any verification request exists.
 *
 * Preserving there made wasSessionPreserved() true on every hinted cold load
 * whether or not anything had failed, so the signal AuthContext re-drives
 * initialisation on was pure noise — and the stale blobs the SDK clears for the
 * stated reason above were kept.
 */
{
  __resetAuthSessionGuardForTests()
  store.clear()
  localStorage.setItem(AUTH_HINT_KEY, '1')

  class IndexedDb { async _remove() {} }
  class BrowserLocal { async _remove() {} }
  class BrowserSession { async _remove() {} }
  guardPersistenceRemoval(IndexedDb)
  guardPersistenceRemoval(BrowserLocal)

  // Arm the boot window exactly as installAuthSessionGuard does.
  const { installAuthSessionGuard } = await import('./authSessionGuard.js')
  installAuthSessionGuard({ persistences: [IndexedDb, BrowserLocal], fetchTarget: null })

  const KEY = 'firebase:authUser:AIzaSyFAKE:[DEFAULT]'
  await new BrowserLocal()._remove(KEY)
  await new BrowserSession()._remove(KEY)

  ok('create()\'s cross-persistence cleanup is not read as a rescue',
    wasSessionPreserved() === false)
  ok('no verification request means no verdict', getBootVerdict() === null)

  // …and the genuine failure, on the same boot, still IS a rescue: the SDK
  // verifies the user, the server answers with something that is not a verdict
  // on the credential, and the removal that follows is the one worth refusing.
  recordVerificationExchange(
    'https://securetoken.googleapis.com/v1/token?key=AIzaSyFAKE',
    { status: 429, body: { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER : retry' } } },
  )
  await new IndexedDb()._remove(KEY)
  ok('a removal after a failed verification IS a rescue', wasSessionPreserved() === true)

  const outcome = disarmAuthSessionGuard()
  ok('the rescue reports the verdict it acted on', outcome.verdict === INFRASTRUCTURAL)
  ok('the rescue is reported once', outcome.preserved === true)
}

{
  // The security property, restated end to end: a credential the server
  // actually rejected is released even though everything else lines up.
  __resetAuthSessionGuardForTests()
  store.clear()
  localStorage.setItem(AUTH_HINT_KEY, '1')
  class IndexedDb { async _remove() {} }
  guardPersistenceRemoval(IndexedDb)
  const { installAuthSessionGuard } = await import('./authSessionGuard.js')
  installAuthSessionGuard({ persistences: [IndexedDb], fetchTarget: null })
  recordVerificationExchange(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIzaSyFAKE',
    { status: 400, body: { error: { message: 'TOKEN_EXPIRED' } } },
  )
  await new IndexedDb()._remove('firebase:authUser:AIzaSyFAKE:[DEFAULT]')
  ok('a revoked credential is still released', wasSessionPreserved() === false)
  disarmAuthSessionGuard()
}

console.log(`\n  ${passed} assertions passed`)
