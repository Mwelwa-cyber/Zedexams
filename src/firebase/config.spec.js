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

// --- Firebase SDK mocks (config.js runs these at module load) ---
const initializeAppCheck = vi.fn(() => ({ __appCheck: true }))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ __app: true })),
}))
vi.mock('firebase/app-check', () => ({
  initializeAppCheck: (...args) => initializeAppCheck(...args),
  ReCaptchaEnterpriseProvider: class ReCaptchaEnterpriseProvider {
    initialize() {}
    async getToken() { return { token: 'tok', expireTimeMillis: 0 } }
  },
  // config.js now wraps the reCAPTCHA provider in a CustomProvider so a stuck
  // reCAPTCHA can't block Auth/Firestore (see appCheckResilient.js). The mock
  // just needs to be constructable — the guard test never mints a token.
  CustomProvider: class CustomProvider {
    constructor(opts) { this._opts = opts }
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
