/**
 * Regression tests for the WEB push path in src/services/notifications/fcm.js.
 *
 * The bug these lock down: when the VAPID key is missing (or a token otherwise
 * can't be minted), registerToken() silently returns null but the old
 * requestPushPermission() still returned 'granted'. The settings UI keyed its
 * success toast on 'granted', so it told users "Push notifications enabled on
 * this device" even though no FCM token existed and the server had nowhere to
 * deliver. requestPushPermission() must instead report 'error' whenever
 * permission was granted but no token was actually registered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  getTokenMock: vi.fn(),
  updateDocMock: vi.fn(),
  captureMock: vi.fn(),
}))

vi.mock('../../utils/runtime', () => ({ isNativePlatform: () => false }))
vi.mock('../../utils/analytics', () => ({ capture: (...args) => h.captureMock(...args) }))
vi.mock('./nativePush', () => ({
  isNativePushSupported: () => false,
  nativePushPermissionSync: () => 'unsupported',
  requestNativePushPermission: vi.fn(),
  refreshNativeTokenIfGranted: vi.fn(),
  clearNativePushUser: vi.fn(),
}))
vi.mock('../../firebase/config', () => ({ db: { __db: true }, messaging: { __messaging: true } }))
vi.mock('firebase/messaging', () => ({
  getToken: (...args) => h.getTokenMock(...args),
  onMessage: vi.fn(() => () => {}),
}))
vi.mock('firebase/firestore', () => ({
  doc: (...args) => ({ __doc: args }),
  arrayUnion: (value) => ({ __arrayUnion: value }),
  serverTimestamp: () => ({ __ts: true }),
  updateDoc: (...args) => h.updateDocMock(...args),
}))

// isPushSupported() gates on the web push APIs — provide them in jsdom.
function installPushApis({ requestResult = 'granted' } = {}) {
  globalThis.Notification = Object.assign(function Notification() {}, {
    permission: 'default',
    requestPermission: vi.fn(async () => requestResult),
  })
  globalThis.PushManager = function PushManager() {}
  if (!('serviceWorker' in navigator)) {
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true })
  }
}

// VAPID_KEY is read at module load from import.meta.env, so stub it *before*
// importing a fresh copy of the module.
async function loadFcm(vapidKey) {
  vi.resetModules()
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', vapidKey)
  return import('./fcm')
}

describe('fcm.requestPushPermission (web)', () => {
  beforeEach(() => {
    h.getTokenMock.mockReset()
    h.updateDocMock.mockReset().mockResolvedValue(undefined)
    h.captureMock.mockReset()
    installPushApis()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns granted and stores the token when a token mints', async () => {
    h.getTokenMock.mockResolvedValue('web-token-1')
    const { requestPushPermission } = await loadFcm('vapid-key')

    const result = await requestPushPermission('u1')

    expect(result).toBe('granted')
    expect(h.updateDocMock).toHaveBeenCalledTimes(1)
    const [, data] = h.updateDocMock.mock.calls[0]
    expect(data.fcmTokens).toEqual({ __arrayUnion: 'web-token-1' })
    expect(h.captureMock).toHaveBeenCalledWith('push_token_registered', { platform: 'web' })
  })

  it('returns error (NOT granted) when permission is granted but no token mints', async () => {
    // e.g. an unreachable service worker: getToken resolves null.
    h.getTokenMock.mockResolvedValue(null)
    const { requestPushPermission } = await loadFcm('vapid-key')

    const result = await requestPushPermission('u1')

    expect(result).toBe('error')
    expect(h.updateDocMock).not.toHaveBeenCalled()
    expect(h.captureMock).toHaveBeenCalledWith('push_token_failed', { platform: 'web', reason: 'no_token' })
  })

  it('returns error and never calls getToken when the VAPID key is not configured', async () => {
    const { requestPushPermission } = await loadFcm('')

    const result = await requestPushPermission('u1')

    expect(result).toBe('error')
    expect(h.getTokenMock).not.toHaveBeenCalled()
    expect(h.updateDocMock).not.toHaveBeenCalled()
    expect(h.captureMock).toHaveBeenCalledWith('push_token_failed', { platform: 'web', reason: 'no_vapid_key' })
  })

  it('returns denied, mints nothing, and reports the declined permission', async () => {
    installPushApis({ requestResult: 'denied' })
    const { requestPushPermission } = await loadFcm('vapid-key')

    const result = await requestPushPermission('u1')

    expect(result).toBe('denied')
    expect(h.getTokenMock).not.toHaveBeenCalled()
    expect(h.updateDocMock).not.toHaveBeenCalled()
    expect(h.captureMock).toHaveBeenCalledWith('push_permission_denied', { platform: 'web' })
  })
})
