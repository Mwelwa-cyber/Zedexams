/**
 * Regression test for the native (Capacitor) App Check → JS SDK bridge.
 *
 * The bug (found via /admin/app-check showing 0% valid): on native,
 * initAppCheck() initialised the Capacitor FirebaseAppCheck plugin — which
 * configures only the NATIVE Firebase SDK — and returned without ever calling
 * the JS SDK's initializeAppCheck(). The WebView's JS SDK is what issues every
 * Firestore/Storage/callable request, so all native traffic reached the
 * backend with no X-Firebase-AppCheck header and the readiness dashboard
 * counted it "missing" even where Play Integrity was fully configured.
 *
 * The fix wires a CustomProvider bridge: JS-SDK token requests pull from the
 * native plugin, wrapped in resilientGetToken so an unconfigured/hung Play
 * Integrity yields the fail-open placeholder instead of stalling requests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { APPCHECK_PLACEHOLDER_TOKEN } from './appCheckResilient'

const initializeAppCheck = vi.fn(() => ({ __appCheck: true }))
const pluginInitialize = vi.fn(async () => {})
const pluginGetToken = vi.fn(async () => ({ token: 'native-token', expireTimeMillis: 12345 }))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ __app: true })),
}))
vi.mock('firebase/app-check', () => ({
  initializeAppCheck: (...args) => initializeAppCheck(...args),
  ReCaptchaV3Provider: class ReCaptchaV3Provider {
    initialize() {}
    async getToken() { return { token: 'tok', expireTimeMillis: 0 } }
  },
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
// Native path — the Capacitor branch is the one that runs.
vi.mock('../utils/runtime', () => ({ isNativePlatform: () => true }))
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    Plugins: {
      FirebaseAppCheck: {
        initialize: (...args) => pluginInitialize(...args),
        getToken: (...args) => pluginGetToken(...args),
      },
    },
  },
}))

function stubFirebaseEnv() {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key')
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'test.firebaseapp.com')
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project')
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'test-app-id')
}

async function loadConfigAndRunDeferredInit() {
  const mod = await import('./config.js')
  expect(idleCallbacks).toHaveLength(1)
  await idleCallbacks[0]()
  return mod
}

let idleCallbacks

describe('Native App Check bridge (firebase/config.js)', () => {
  beforeEach(() => {
    vi.resetModules()
    initializeAppCheck.mockClear()
    pluginInitialize.mockClear()
    pluginGetToken.mockClear()
    pluginGetToken.mockImplementation(async () => ({ token: 'native-token', expireTimeMillis: 12345 }))
    stubFirebaseEnv()
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

  it('initialises the JS SDK with a CustomProvider bridging the native plugin', async () => {
    await loadConfigAndRunDeferredInit()

    expect(pluginInitialize).toHaveBeenCalledTimes(1)
    // The regression: this was never called on native, so WebView callables
    // and Firestore/Storage requests carried no App Check token.
    expect(initializeAppCheck).toHaveBeenCalledTimes(1)

    const [, options] = initializeAppCheck.mock.calls[0]
    const bridged = await options.provider._opts.getToken()
    expect(pluginGetToken).toHaveBeenCalledTimes(1)
    expect(bridged).toEqual({ token: 'native-token', expireTimeMillis: 12345 })
  })

  it('fails open to the placeholder token when the native plugin cannot mint', async () => {
    pluginGetToken.mockImplementation(async () => {
      throw new Error('Play Integrity not configured')
    })
    await loadConfigAndRunDeferredInit()

    const [, options] = initializeAppCheck.mock.calls[0]
    const bridged = await options.provider._opts.getToken()
    // resilientGetToken must swallow the failure and hand back the fail-open
    // placeholder so requests proceed (counted unattested) instead of stalling.
    expect(bridged.token).toBe(APPCHECK_PLACEHOLDER_TOKEN)
  })

  it('skips the JS bridge entirely when native plugin init fails', async () => {
    pluginInitialize.mockImplementation(async () => {
      throw new Error('no google services')
    })
    await loadConfigAndRunDeferredInit()

    expect(initializeAppCheck).not.toHaveBeenCalled()
  })
})
