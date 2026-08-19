import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ttsAuth builds the headers /api/tts requires, and its callers rely on the
// null return to mean "cannot authenticate — skip the cloud". Both halves are
// pinned here, plus the end-to-end property that actually regressed: a cloud
// synthesis request carrying an Authorization header.
//
// firebase/config is mocked so no SDK is initialised; `auth` is a plain
// mutable object because that is exactly how the real module exposes
// currentUser (it flips as sign-in state changes).

// vi.hoisted: vi.mock factories are hoisted above the file body, so the mock
// state they close over has to be hoisted with them.
const { auth, getAppCheckToken } = vi.hoisted(() => ({
  auth: { currentUser: null },
  getAppCheckToken: vi.fn(),
}))

vi.mock('../firebase/config', () => ({
  auth,
  getAppCheckToken: (...args) => getAppCheckToken(...args),
  default: {},
}))
vi.mock('./runtime', () => ({
  apiUrl: (path) => path,
  isNativePlatform: () => false,
}))

import { ttsAuthHeaders } from './ttsAuth.js'
import { speak, stopSpeaking } from './tts.js'

function signIn(token = 'id-token-123') {
  auth.currentUser = { getIdToken: vi.fn(async () => token) }
  return auth.currentUser
}

beforeEach(() => {
  auth.currentUser = null
  getAppCheckToken.mockReset()
  getAppCheckToken.mockResolvedValue('')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ttsAuthHeaders', () => {
  it('returns null when signed out, so the caller skips the cloud', async () => {
    expect(await ttsAuthHeaders()).toBeNull()
  })

  it('carries a Bearer ID token when signed in', async () => {
    signIn('abc')
    const headers = await ttsAuthHeaders()
    // The whole point: functions/tts.js reads this header and nothing else.
    expect(headers.Authorization).toBe('Bearer abc')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('attaches an App Check token when one is available', async () => {
    signIn()
    getAppCheckToken.mockResolvedValue('appcheck-tok')
    expect((await ttsAuthHeaders())['X-Firebase-AppCheck']).toBe('appcheck-tok')
  })

  it('omits the App Check header rather than sending an empty one', async () => {
    signIn()
    getAppCheckToken.mockResolvedValue('')
    expect('X-Firebase-AppCheck' in (await ttsAuthHeaders())).toBe(false)
  })

  it('still authenticates when App Check rejects — audio must not depend on it', async () => {
    signIn('tok')
    getAppCheckToken.mockRejectedValue(new Error('recaptcha stalled'))
    const headers = await ttsAuthHeaders()
    expect(headers.Authorization).toBe('Bearer tok')
    expect('X-Firebase-AppCheck' in headers).toBe(false)
  })

  it('returns null when the ID token cannot be minted', async () => {
    auth.currentUser = { getIdToken: vi.fn(async () => { throw new Error('network') }) }
    expect(await ttsAuthHeaders()).toBeNull()
  })

  it('returns null on an empty token rather than sending "Bearer "', async () => {
    signIn('')
    expect(await ttsAuthHeaders()).toBeNull()
  })
})

describe('speak() — the request that reaches /api/tts', () => {
  // The regression: speak() POSTed with Content-Type alone, so the endpoint
  // answered 401 on every call and the browser fallback silently absorbed it.
  // A test asserting only "audio played" cannot tell those apart, so this
  // asserts on the REQUEST.
  it('sends the Authorization header on the cloud request', async () => {
    signIn('learner-token')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
    }))
    globalThis.fetch = fetchMock
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:tts')
    globalThis.URL.revokeObjectURL = vi.fn()
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)

    // speak() resolves only when playback ends; we assert on the request, so
    // let it run and inspect the call rather than awaiting the audio.
    speak('Photosynthesis')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/tts')
    expect(init.headers.Authorization).toBe('Bearer learner-token')
    stopSpeaking()
  })

  it('does not call /api/tts at all when signed out', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    // No speechSynthesis in jsdom → the browser fallback rejects; the
    // assertion that matters is that no doomed 401 request was made.
    await speak('Photosynthesis').catch(() => {})
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
