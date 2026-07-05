/**
 * Regression test for native (Android / Capacitor) push registration.
 *
 * The bug: on the Android build, push notifications never arrived because there
 * was no native FCM integration at all — isPushSupported() returned false on
 * native, so no token was ever minted or written to users/{uid}.fcmTokens, and
 * the server-side sender had nowhere to deliver. This module drives the
 * @capacitor-firebase/messaging plugin to request permission, fetch the native
 * token, and persist it into the SAME fcmTokens array the web path uses.
 *
 * These tests assert the token actually lands in Firestore on grant, stays out
 * on denial, and that the sync permission cache the shared UI reads is primed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  updateDocMock: vi.fn(async () => {}),
  state: { plugin: null },
}))

vi.mock('./runtime', () => ({
  isNativePlatform: () => true,
  nativePlugin: (name) => (name === 'FirebaseMessaging' ? h.state.plugin : null),
}))
vi.mock('firebase/firestore', () => ({
  doc: (...args) => ({ __doc: args }),
  arrayUnion: (value) => ({ __arrayUnion: value }),
  serverTimestamp: () => ({ __ts: true }),
  updateDoc: (...args) => h.updateDocMock(...args),
}))
vi.mock('../firebase/config', () => ({ db: { __db: true } }))

function makePlugin({
  receiveOnRequest = 'granted',
  receiveOnCheck = 'granted',
  token = 'native-token-123',
} = {}) {
  return {
    requestPermissions: vi.fn(async () => ({ receive: receiveOnRequest })),
    checkPermissions: vi.fn(async () => ({ receive: receiveOnCheck })),
    getToken: vi.fn(async () => ({ token })),
    addListener: vi.fn(async () => ({ remove() {} })),
  }
}

// Fresh module per test so the module-level permission cache / listener guard
// reset — mirrors how the app loads it once per process.
async function load() {
  vi.resetModules()
  return import('./nativePush')
}

describe('nativePush', () => {
  beforeEach(() => {
    h.updateDocMock.mockClear()
    h.state.plugin = null
  })

  it('registers the native FCM token into fcmTokens on grant', async () => {
    h.state.plugin = makePlugin({ receiveOnRequest: 'granted', token: 'tok-A' })
    const { requestNativePushPermission } = await load()

    const result = await requestNativePushPermission('user1')

    expect(result).toBe('granted')
    expect(h.updateDocMock).toHaveBeenCalledTimes(1)
    const [, data] = h.updateDocMock.mock.calls[0]
    expect(data.fcmTokens).toEqual({ __arrayUnion: 'tok-A' })
  })

  it('does NOT register a token when permission is denied', async () => {
    h.state.plugin = makePlugin({ receiveOnRequest: 'denied' })
    const { requestNativePushPermission } = await load()

    const result = await requestNativePushPermission('user1')

    expect(result).toBe('denied')
    expect(h.updateDocMock).not.toHaveBeenCalled()
  })

  it('silently re-registers on sign-in when already granted', async () => {
    h.state.plugin = makePlugin({ receiveOnCheck: 'granted', token: 'tok-refresh' })
    const { refreshNativeTokenIfGranted } = await load()

    const out = await refreshNativeTokenIfGranted('user2')

    expect(out).toBe('tok-refresh')
    expect(h.updateDocMock).toHaveBeenCalledTimes(1)
  })

  it('refresh is a no-op (never prompts) when permission not yet granted', async () => {
    h.state.plugin = makePlugin({ receiveOnCheck: 'prompt' })
    const { refreshNativeTokenIfGranted } = await load()

    const out = await refreshNativeTokenIfGranted('user2')

    expect(out).toBe(null)
    expect(h.updateDocMock).not.toHaveBeenCalled()
  })

  it('reports unsupported when the messaging plugin is not registered', async () => {
    h.state.plugin = null
    const { isNativePushSupported, nativePushPermissionSync } = await load()

    expect(isNativePushSupported()).toBe(false)
    expect(nativePushPermissionSync()).toBe('unsupported')
  })

  it('primes the sync permission cache the UI reads (default → granted)', async () => {
    h.state.plugin = makePlugin({ receiveOnRequest: 'granted' })
    const mod = await load()

    // Before any request, the UI should see 'default' so the opt-in prompt shows.
    expect(mod.nativePushPermissionSync()).toBe('default')
    await mod.requestNativePushPermission('u')
    // After grant, the sync read flips so the prompt hides / settings show on.
    expect(mod.nativePushPermissionSync()).toBe('granted')
  })
})
