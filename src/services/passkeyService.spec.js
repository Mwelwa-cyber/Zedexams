// Behaviour tests for the regional routing inside passkeyService.js — the
// staged us-central1 → africa-south1 migration. Firebase is fully mocked;
// what's under test is OURS: which region instance and callable name each
// flow uses, the narrow fallback, the device-hint lifecycle, live rollback
// via the settings snapshot, and management calls staying on us-central1.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const state = vi.hoisted(() => ({
  calls: [],
  snapshotCb: null,
  flags: {},
  currentUser: null,
  verifiedUid: 'someLearnerUid001',
  failOnce: null, // { name, region, code } → that callable throws once
}))

vi.mock('firebase/functions', () => ({
  getFunctions: (_app, region) => ({ __region: region }),
  httpsCallable: (fns, name) => async (payload) => {
    state.calls.push({ region: fns.__region, name, payload })
    if (state.failOnce && state.failOnce.name === name && state.failOnce.region === fns.__region) {
      const err = new Error('mock callable failure')
      err.code = state.failOnce.code
      state.failOnce = null
      throw err
    }
    if (name.startsWith('generatePasskeyAuthenticationOptions')) {
      return { data: { options: { challenge: 'mock-auth-challenge' }, challengeId: 'mockChallenge01' } }
    }
    if (name.startsWith('verifyPasskeyAuthentication')) {
      return { data: { token: 'mock-custom-token' } }
    }
    if (name.startsWith('generatePasskeyRegistrationOptions')) {
      return { data: { options: { challenge: 'mock-reg-challenge' }, challengeId: 'mockChallenge02' } }
    }
    if (name.startsWith('verifyPasskeyRegistration')) {
      return { data: { passkey: { id: 'mockCredential0001', name: 'Mock device' } } }
    }
    return { data: { passkeys: [] } }
  },
}))

vi.mock('firebase/auth', () => ({
  signInWithCustomToken: async () => ({ user: { uid: state.verifiedUid } }),
}))

vi.mock('firebase/firestore', () => ({
  doc: () => ({ __doc: 'settings/global' }),
  onSnapshot: (_ref, cb) => {
    state.snapshotCb = cb
    cb({ exists: () => true, data: () => ({ featureFlags: state.flags }) })
    return () => {}
  },
}))

vi.mock('../firebase/config', () => ({
  default: {},
  db: {},
  auth: {
    get currentUser() {
      return state.currentUser
    },
  },
}))

vi.mock('../utils/analytics', () => ({ capture: vi.fn() }))

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication: async () => ({ id: 'mockAssertionResponse' }),
  startRegistration: async () => ({ id: 'mockAttestationResponse' }),
}))

const HINT_KEY = 'zedexams.passkeyRegionHint'
const TEACHER = 'testTeacherUid001'

async function loadService() {
  vi.resetModules()
  return import('./passkeyService')
}

function flowCalls() {
  return state.calls.map((c) => `${c.region}:${c.name}`)
}

beforeEach(() => {
  state.calls = []
  state.snapshotCb = null
  state.flags = {}
  state.currentUser = null
  state.verifiedUid = 'someLearnerUid001'
  state.failOnce = null
  window.localStorage.clear()
})

describe('passkey region routing', () => {
  it('defaults every flow to us-central1 with the original callable names', async () => {
    const svc = await loadService()
    await svc.signInWithPasskey()
    expect(flowCalls()).toEqual([
      'us-central1:generatePasskeyAuthenticationOptions',
      'us-central1:verifyPasskeyAuthentication',
    ])
    expect(window.localStorage.getItem(HINT_KEY)).toBeNull()
  })

  it('routes sign-in through the africa-south1 twins when mode is "all"', async () => {
    state.flags = { passkeyFunctionsRegion: { mode: 'all' } }
    const svc = await loadService()
    await svc.signInWithPasskey()
    expect(flowCalls()).toEqual([
      'africa-south1:generatePasskeyAuthenticationOptionsAfrica',
      'africa-south1:verifyPasskeyAuthenticationAfrica',
    ])
    expect(window.localStorage.getItem(HINT_KEY)).toBe('africa-south1')
  })

  it('pilot: only the allow-listed teacher registers regionally, and the device hint is primed', async () => {
    state.flags = { passkeyFunctionsRegion: { mode: 'pilot', pilotUids: [TEACHER] } }
    state.currentUser = { uid: TEACHER }
    const svc = await loadService()
    await svc.registerPasskey('My phone')
    expect(flowCalls()).toEqual([
      'africa-south1:generatePasskeyRegistrationOptionsAfrica',
      'africa-south1:verifyPasskeyRegistrationAfrica',
    ])
    expect(window.localStorage.getItem(HINT_KEY)).toBe('africa-south1')
  })

  it('pilot: a non-pilot user stays on us-central1 even on a primed device, and the stale hint is scrubbed', async () => {
    state.flags = { passkeyFunctionsRegion: { mode: 'pilot', pilotUids: [TEACHER] } }
    window.localStorage.setItem(HINT_KEY, 'africa-south1')
    state.verifiedUid = 'someLearnerUid001' // resolved uid is NOT in the pilot
    const svc = await loadService()
    await svc.signInWithPasskey()
    // Pre-auth the primed hint routes regionally (that's how the pilot
    // teacher signs in), but post-auth the non-pilot uid clears the hint so
    // this device goes back to us-central1 next time.
    expect(state.calls[0].region).toBe('africa-south1')
    expect(window.localStorage.getItem(HINT_KEY)).toBeNull()
  })

  it('falls back to us-central1 when the regional twin is absent, and completes the flow there', async () => {
    state.flags = { passkeyFunctionsRegion: { mode: 'all' } }
    state.failOnce = {
      name: 'generatePasskeyAuthenticationOptionsAfrica',
      region: 'africa-south1',
      code: 'functions/not-found',
    }
    const svc = await loadService()
    const cred = await svc.signInWithPasskey()
    expect(cred.user.uid).toBe('someLearnerUid001')
    expect(flowCalls()).toEqual([
      'africa-south1:generatePasskeyAuthenticationOptionsAfrica',
      'us-central1:generatePasskeyAuthenticationOptions',
      'us-central1:verifyPasskeyAuthentication',
    ])
  })

  it('does NOT retry the verify step on ambiguous failures (no accidental replay)', async () => {
    state.flags = { passkeyFunctionsRegion: { mode: 'all' } }
    const svc = await loadService()
    state.failOnce = {
      name: 'verifyPasskeyAuthenticationAfrica',
      region: 'africa-south1',
      code: 'functions/deadline-exceeded',
    }
    await expect(svc.signInWithPasskey()).rejects.toThrow()
    expect(flowCalls()).toEqual([
      'africa-south1:generatePasskeyAuthenticationOptionsAfrica',
      'africa-south1:verifyPasskeyAuthenticationAfrica',
    ])
  })

  it('rolls back live: a flag flip re-routes the next sign-in without any redeploy', async () => {
    state.flags = { passkeyFunctionsRegion: { mode: 'all' } }
    const svc = await loadService()
    await svc.signInWithPasskey()
    expect(state.calls[0].region).toBe('africa-south1')

    state.calls = []
    state.snapshotCb({
      exists: () => true,
      data: () => ({ featureFlags: { passkeyFunctionsRegion: { mode: 'off' } } }),
    })
    await svc.signInWithPasskey()
    expect(flowCalls()).toEqual([
      'us-central1:generatePasskeyAuthenticationOptions',
      'us-central1:verifyPasskeyAuthentication',
    ])
    expect(window.localStorage.getItem(HINT_KEY)).toBeNull()
  })

  it('management calls always stay on us-central1, whatever the flag says', async () => {
    state.flags = { passkeyFunctionsRegion: { mode: 'all' } }
    const svc = await loadService()
    await svc.listPasskeys()
    expect(flowCalls()).toEqual(['us-central1:listUserPasskeys'])
  })
})
