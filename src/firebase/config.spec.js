/**
 * Regression test for the App Check re-entry guard (see #1458 and the
 * `appCheckInitStarted` one-shot flag in firebase/config.js).
 *
 * The bug: initAppCheck() had no re-entry guard, so a second invocation
 * (bfcache page restore re-firing the deferred requestIdleCallback, a stray
 * re-import, etc.) called initializeAppCheck() a second time. That made
 * Google's reCAPTCHA SDK throw "reCAPTCHA placeholder element must be empty"
 * ASYNCHRONOUSLY — outside initAppCheck's try/catch — surfacing as an
 * unhandled Sentry error (seen on /admin/question-review right after App
 * Check went live).
 *
 * This exercises the REAL guard through its actual deferred-init code path:
 * config.js schedules initAppCheck via requestIdleCallback at module load, so
 * we capture that callback and fire it twice. With the guard in place,
 * initializeAppCheck must be invoked exactly once no matter how many times the
 * idle callback re-fires.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { APPCHECK_PLACEHOLDER_TOKEN } from './appCheckResilient'

// --- Firebase SDK mocks (config.js runs these at module load) ---
const initializeAppCheck = vi.fn(() => ({ __appCheck: true }))

// Shared, hoisted state so the mocked reCAPTCHA provider is observable and
// steerable from individual tests (init call count, token behaviour, and the
// CustomProvider options config.js builds — its getToken is the code under
// test for the stale-container / stuck-widget recovery path).
const h = vi.hoisted(() => ({
  lastCustomProviderOpts: null,
  recaptchaInitCalls: 0,
  recaptchaGetToken: async () => ({ token: 'real-token', expireTimeMillis: 0 }),
}))

vi.mock('firebase/app', () => ({
  // `name` matters: config.js derives the reCAPTCHA container id
  // (`fire_app_check_${app.name}`) from it for the stale-container cleanup.
  initializeApp: vi.fn(() => ({ __app: true, name: '[DEFAULT]' })),
}))
vi.mock('firebase/app-check', () => ({
  initializeAppCheck: (...args) => initializeAppCheck(...args),
  ReCaptchaEnterpriseProvider: class ReCaptchaEnterpriseProvider {
    initialize() { h.recaptchaInitCalls += 1 }
    getToken() { return h.recaptchaGetToken() }
  },
  // config.js now wraps the reCAPTCHA provider in a CustomProvider so a stuck
  // reCAPTCHA can't block Auth/Firestore (see appCheckResilient.js).
  CustomProvider: class CustomProvider {
    constructor(opts) {
      this._opts = opts
      h.lastCustomProviderOpts = opts
    }
  },
  getToken: vi.fn(async () => ({ token: 'tok' })),
}))
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ __auth: true })),
  setPersistence: vi.fn(() => Promise.resolve()),
  browserLocalPersistence: { type: 'local' },
  indexedDBLocalPersistence: { type: 'idb' },
  GoogleAuthProvider: class GoogleAuthProvider {
    setCustomParameters() {}
  },
}))
vi.mock('firebase/firestore', () => ({
  initializeFirestore: vi.fn(() => ({ __db: true })),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({})),
}))
vi.mock('firebase/messaging', () => ({ getMessaging: vi.fn(() => ({})) }))
vi.mock('firebase/performance', () => ({ getPerformance: vi.fn(() => ({})) }))
vi.mock('firebase/storage', () => ({ getStorage: vi.fn(() => ({})) }))
// Web path, never native — so the reCAPTCHA branch is the one that runs.
vi.mock('../utils/runtime', () => ({ isNativePlatform: () => false }))

// The required Firebase web config keys config.js validates at module load,
// plus the reCAPTCHA site key that gates the web App Check branch.
function stubFirebaseEnv() {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key')
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'test.firebaseapp.com')
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project')
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'test-app-id')
  vi.stubEnv('VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY', 'test-recaptcha-key')
}

describe('App Check re-entry guard (firebase/config.js)', () => {
  let idleCallbacks

  beforeEach(() => {
    vi.resetModules()
    initializeAppCheck.mockClear()
    stubFirebaseEnv()
    // Capture the deferred init callback config.js schedules at module load
    // rather than letting it fire on a real idle slot.
    idleCallbacks = []
    window.requestIdleCallback = (cb) => {
      idleCallbacks.push(cb)
      return 1
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete window.requestIdleCallback
  })

  it('initializes App Check exactly once even if the deferred init fires twice', async () => {
    await import('./config.js')

    // Module load should have scheduled exactly one idle init callback.
    expect(idleCallbacks).toHaveLength(1)

    const init = idleCallbacks[0]
    // Fire the callback twice — mimics a bfcache restore re-firing the
    // deferred init after the page was already attested once.
    await init()
    await init()

    // The guard must collapse both invocations into a single reCAPTCHA render.
    expect(initializeAppCheck).toHaveBeenCalledTimes(1)
  })
})

/**
 * Explicit App Check readiness gate (whenAppCheckReady) — added for the
 * launch-blocker "App Check 403 race" remediation. Callers can now AWAIT
 * attestation settling instead of racing the first token mint.
 */
describe('App Check readiness gate (whenAppCheckReady)', () => {
  let idleCallbacks

  beforeEach(() => {
    vi.resetModules()
    initializeAppCheck.mockClear()
    stubFirebaseEnv()
    idleCallbacks = []
    window.requestIdleCallback = (cb) => { idleCallbacks.push(cb); return 1 }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete window.requestIdleCallback
  })

  it('resolves as initialized once the deferred init settles', async () => {
    const mod = await import('./config.js')
    expect(idleCallbacks).toHaveLength(1)
    await idleCallbacks[0]() // run() → initAppCheck() + markAppCheckReady()
    const state = await mod.whenAppCheckReady(1000)
    expect(state).toBeTruthy()
    expect(state.initialized).toBe(true)
  })

  it('never hangs — resolves via the bounded timeout even if init never runs', async () => {
    const mod = await import('./config.js')
    // Do NOT fire the idle callback; readiness must still resolve promptly.
    const state = await mod.whenAppCheckReady(0)
    expect(state).toBeTruthy()
    expect(typeof state.initialized).toBe('boolean')
  })
})

/**
 * Regression tests for the stale-container cleanup + stuck-widget recovery in
 * the web App Check provider (the "reCAPTCHA placeholder element must be
 * empty" storm — 79% of production client errors, 2026-07).
 *
 * The SDK renders into a div with the FIXED id `fire_app_check_${app.name}`
 * and grecaptcha resolves that id to the FIRST matching node, so a stale or
 * duplicate container makes the render throw asynchronously; the SDK's
 * `initialized` deferred then never resolves and every later mint placeholders
 * — the session stays unattested until reload. config.js must (1) remove
 * pre-existing containers before initializing and (2) re-initialize, bounded,
 * when minting stays stuck on placeholders.
 */
describe('App Check reCAPTCHA container cleanup + recovery (firebase/config.js)', () => {
  const CONTAINER_ID = 'fire_app_check_[DEFAULT]'

  const staleContainer = () => {
    const div = document.createElement('div')
    div.id = CONTAINER_ID
    div.appendChild(document.createElement('iframe')) // a rendered widget's leftovers
    document.body.appendChild(div)
    return div
  }

  async function bootProvider() {
    let idleInit
    window.requestIdleCallback = (cb) => { idleInit = cb; return 1 }
    await import('./config.js')
    await idleInit()
    return h.lastCustomProviderOpts
  }

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T08:00:00Z'))
    initializeAppCheck.mockClear()
    h.lastCustomProviderOpts = null
    h.recaptchaInitCalls = 0
    h.recaptchaGetToken = async () => ({ token: 'real-token', expireTimeMillis: 0 })
    stubFirebaseEnv()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    delete window.requestIdleCallback
  })

  it('removes stale reCAPTCHA containers before the first initialize', async () => {
    staleContainer()
    staleContainer() // duplicate id — the exact shape that breaks render()

    const opts = await bootProvider()
    await opts.getToken()

    expect(document.querySelectorAll(`[id="${CONTAINER_ID}"]`)).toHaveLength(0)
    expect(h.recaptchaInitCalls).toBe(1)
  })

  it('re-initializes once minting is stuck on placeholders past the recovery age', async () => {
    h.recaptchaGetToken = async () => { throw new Error('widget never rendered') }
    const opts = await bootProvider()

    const first = await opts.getToken()
    expect(first.token).toBe(APPCHECK_PLACEHOLDER_TOKEN)
    expect(h.recaptchaInitCalls).toBe(1) // one placeholder alone never re-inits

    // Second consecutive placeholder, still inside the min-age window: a slow
    // first script load must NOT trigger a re-init.
    await opts.getToken()
    expect(h.recaptchaInitCalls).toBe(1)

    // Past the min age, the next consecutive placeholder pair triggers exactly
    // one recovery re-init (with a container cleanup first).
    const leftover = staleContainer()
    vi.setSystemTime(Date.now() + 61_000)
    await opts.getToken()
    await opts.getToken()
    expect(h.recaptchaInitCalls).toBe(2)
    expect(document.body.contains(leftover)).toBe(false)
  })

  it('caps recovery re-inits and resets the streak on a real token', async () => {
    h.recaptchaGetToken = async () => { throw new Error('down') }
    const opts = await bootProvider()
    await opts.getToken() // lazy first init (starts the min-age clock)

    // Burn through both allowed recovery attempts.
    for (let attempt = 0; attempt < 2; attempt++) {
      vi.setSystemTime(Date.now() + 61_000)
      await opts.getToken()
      await opts.getToken()
    }
    expect(h.recaptchaInitCalls).toBe(3) // initial + 2 recoveries

    // Further sustained placeholders never re-init again (no init loop while
    // reCAPTCHA itself is down).
    vi.setSystemTime(Date.now() + 61_000)
    await opts.getToken()
    await opts.getToken()
    expect(h.recaptchaInitCalls).toBe(3)

    // A healthy mint resets the consecutive-placeholder streak.
    h.recaptchaGetToken = async () => ({ token: 'real-token', expireTimeMillis: 0 })
    const healed = await opts.getToken()
    expect(healed.token).toBe('real-token')
  })
})

/**
 * The cold-load logout, locked down.
 *
 * App Check enforcement is ON for Firebase Authentication. `getAuth()` starts
 * the SDK's boot check (`identitytoolkit…/v1/accounts:lookup`) as soon as
 * config.js finishes evaluating, and on the idle path that request went out
 * with no X-Firebase-AppCheck header — earning
 * `401 "Firebase App Check token is invalid."`, which the SDK reads as an
 * unverifiable persisted user and deletes from IndexedDB before
 * `onAuthStateChanged` fires once. Every reload is a cold load, so every
 * reload signed the user out.
 *
 * What is asserted here is the contract, not the microtask ordering (which
 * mocks cannot observe): a device that holds a session must NOT defer App
 * Check init, and a device with no session must still defer it, because the
 * reCAPTCHA script on the LCP path is what the deferral exists to avoid.
 */
describe('App Check init is not deferred for a device holding a session', () => {
  let idleCallbacks

  beforeEach(() => {
    vi.resetModules()
    initializeAppCheck.mockClear()
    stubFirebaseEnv()
    idleCallbacks = []
    window.requestIdleCallback = (cb) => { idleCallbacks.push(cb); return 1 }
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete window.requestIdleCallback
    localStorage.clear()
  })

  it('runs init at module load when the session hint is present', async () => {
    localStorage.setItem('auth:hasSession', '1')

    await import('./config.js')

    expect(initializeAppCheck).toHaveBeenCalledTimes(1)
    // Nothing was queued: the attestation provider exists before anything can
    // await it, rather than one to two seconds later.
    expect(idleCallbacks).toHaveLength(0)
  })

  it('still defers init for a visitor with no session', async () => {
    await import('./config.js')

    // Deferred, exactly as before — a signed-out visitor on the marketing page
    // makes no session-verification request, so there is nothing to protect
    // and no reason to put reCAPTCHA on their LCP path.
    expect(initializeAppCheck).not.toHaveBeenCalled()
    expect(idleCallbacks).toHaveLength(1)

    await idleCallbacks[0]()
    expect(initializeAppCheck).toHaveBeenCalledTimes(1)
  })
})
