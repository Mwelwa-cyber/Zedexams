/**
 * Behavioural tests for AuthProvider's role + access resolution.
 *
 * AuthContext derives a large set of access flags (isLearner / isTeacher /
 * isAdmin / isSuperAdmin / isPremium / isPaidTeacher / canAccessFullContent
 * / canAccessLearnerPortal / isSuspended) from the Firestore user profile.
 * A regression here mis-routes every user — a learner could see teacher
 * surfaces, or a paid teacher could slip into the learner portal — so these
 * are locked down here.
 *
 * Strategy: mock only the Firebase + side-effect modules. The pure
 * role/permission helpers (subscriptionConfig, permissions) are the REAL
 * implementations, so this exercises the genuine resolution logic rather
 * than a stub of it. We capture the onAuthStateChanged + onSnapshot
 * callbacks the provider registers and drive them to push a profile.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// Shared capture holders (vi.hoisted runs before the mock factories).
const h = vi.hoisted(() => ({
  onAuthCb: { current: null },
  snap: { next: null, error: null },
  signOut: vi.fn(() => Promise.resolve()),
}))

vi.mock('../firebase/config', () => ({
  default: {},
  auth: { currentUser: null },
  db: {},
  googleProvider: {},
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, cb) => { h.onAuthCb.current = cb; return () => {} },
  signOut: (...a) => h.signOut(...a),
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithCredential: vi.fn(),
  GoogleAuthProvider: { credential: vi.fn() },
  updateProfile: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  doc: (...a) => ({ __ref: a }),
  onSnapshot: (_ref, next, error) => { h.snap.next = next; h.snap.error = error; return () => {} },
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: () => 'ts',
}))

vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => vi.fn(() => Promise.resolve({ data: {} })),
}))

// Side-effect utils — stubbed; their behaviour is not under test here.
vi.mock('../utils/runtime', () => ({ isNativePlatform: () => false }))
vi.mock('../utils/sentry', () => ({ setSentryUser: vi.fn(), clearSentryUser: vi.fn() }))
vi.mock('../utils/analytics', () => ({ capture: vi.fn(), identifyUser: vi.fn(), resetAnalytics: vi.fn() }))
vi.mock('../utils/fcm', () => ({ refreshTokenIfGranted: () => Promise.resolve(), clearPushUser: () => {} }))
vi.mock('../utils/referrals', () => ({
  mintAndPersistReferralCode: vi.fn(() => Promise.resolve(null)),
  readPendingReferral: () => null,
  clearPendingReferral: vi.fn(),
}))
vi.mock('../hooks/useAuthRecovery', () => ({ useAuthRecovery: () => {} }))

// NOTE: ../utils/subscriptionConfig and ../utils/permissions are deliberately
// NOT mocked — the real role-resolution logic is what we're testing.

import { AuthProvider, useAuth } from './AuthContext'

function Probe() {
  const a = useAuth()
  const flags = {
    isLearner: a.isLearner,
    isTeacher: a.isTeacher,
    isAdmin: a.isAdmin,
    isAdminOnly: a.isAdminOnly,
    isSuperAdmin: a.isSuperAdmin,
    isPremium: a.isPremium,
    isPaidTeacher: a.isPaidTeacher,
    canAccessFullContent: a.canAccessFullContent,
    canAccessLearnerPortal: a.canAccessLearnerPortal,
    isSuspended: a.isSuspended,
    userStatus: a.userStatus,
    hasProfile: !!a.userProfile,
    emailVerified: a.emailVerified,
    needsEmailVerification: a.needsEmailVerification,
  }
  return <span data-testid="flags">{JSON.stringify(flags)}</span>
}

// Render the provider, fire the auth-state callback with `user`, then push a
// profile snapshot. Returns the parsed derived flags.
function resolveFlags(profile, { user = { uid: 'u1', getIdToken: vi.fn() } } = {}) {
  render(<AuthProvider><Probe /></AuthProvider>)
  act(() => { h.onAuthCb.current(user) })
  if (profile !== undefined) {
    act(() => { h.snap.next({ exists: () => true, data: () => profile }) })
  }
  return JSON.parse(screen.getByTestId('flags').textContent)
}

describe('AuthProvider role + access resolution', () => {
  beforeEach(() => {
    h.onAuthCb.current = null
    h.snap.next = null
    h.snap.error = null
    h.signOut.mockClear()
  })

  it('a free learner gets learner-only, no premium, no portal', () => {
    const f = resolveFlags({ role: 'learner' })
    expect(f.isLearner).toBe(true)
    expect(f.isTeacher).toBe(false)
    expect(f.isAdmin).toBe(false)
    expect(f.isSuperAdmin).toBe(false)
    expect(f.isPremium).toBe(false)
    expect(f.canAccessFullContent).toBe(false)
    expect(f.canAccessLearnerPortal).toBe(false)
    expect(f.isSuspended).toBe(false)
    expect(f.userStatus).toBe('active')
  })

  it('a premium learner unlocks full content + the learner portal', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const f = resolveFlags({ role: 'learner', subscriptionStatus: 'active', subscriptionExpiry: future })
    expect(f.isLearner).toBe(true)
    expect(f.isPremium).toBe(true)
    expect(f.canAccessFullContent).toBe(true)
    expect(f.canAccessLearnerPortal).toBe(true)
    expect(f.isPaidTeacher).toBe(false)
  })

  it('a free teacher is a teacher but has no premium and no full content', () => {
    const f = resolveFlags({ role: 'teacher' })
    expect(f.isTeacher).toBe(true)
    expect(f.isLearner).toBe(false)
    expect(f.isAdmin).toBe(false)
    expect(f.isPremium).toBe(false)
    expect(f.isPaidTeacher).toBe(false)
    expect(f.canAccessFullContent).toBe(false)
  })

  it('a paid teacher gets full content but is STILL barred from the learner portal', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const f = resolveFlags({ role: 'teacher', subscriptionStatus: 'active', subscriptionExpiry: future })
    expect(f.isTeacher).toBe(true)
    expect(f.isPremium).toBe(true)
    expect(f.isPaidTeacher).toBe(true)
    expect(f.canAccessFullContent).toBe(true)
    // The teacher/learner portals are fully separate — a paid teacher
    // account must never reach the learner side.
    expect(f.canAccessLearnerPortal).toBe(false)
  })

  it('a superAdmin is admin everywhere, premium without a subscription, and overlaps isTeacher', () => {
    const f = resolveFlags({ role: 'superAdmin' })
    expect(f.isSuperAdmin).toBe(true)
    expect(f.isAdmin).toBe(true)
    expect(f.isAdminOnly).toBe(true)
    expect(f.isTeacher).toBe(true) // legacy overlap — admin can use teacher tools
    expect(f.isLearner).toBe(false)
    expect(f.isPremium).toBe(true)
    expect(f.canAccessFullContent).toBe(true)
    expect(f.canAccessLearnerPortal).toBe(true)
  })

  it('the legacy "admin" role resolves to super-admin access too', () => {
    const f = resolveFlags({ role: 'admin' })
    expect(f.isSuperAdmin).toBe(true)
    expect(f.isAdmin).toBe(true)
    expect(f.isAdminOnly).toBe(true)
  })

  it('an expired premium learner does not get premium access', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    const f = resolveFlags({ role: 'learner', subscriptionStatus: 'active', subscriptionExpiry: past })
    expect(f.isPremium).toBe(false)
    expect(f.canAccessFullContent).toBe(false)
  })

  it('a suspended profile signs the user out instead of populating flags', () => {
    const f = resolveFlags({ role: 'learner', status: 'suspended' })
    // The snapshot handler nulls the profile and signs out rather than
    // letting a suspended account keep navigating.
    expect(h.signOut).toHaveBeenCalledTimes(1)
    expect(f.hasProfile).toBe(false)
    expect(f.isLearner).toBe(false)
  })

  it('a deleted profile is also force-signed-out', () => {
    const f = resolveFlags({ role: 'teacher', status: 'deleted' })
    expect(h.signOut).toHaveBeenCalledTimes(1)
    expect(f.hasProfile).toBe(false)
  })

  it('signed-out state exposes no role and never calls signOut', () => {
    const f = resolveFlags(undefined, { user: null })
    expect(f.hasProfile).toBe(false)
    expect(f.isLearner).toBe(false)
    expect(f.isTeacher).toBe(false)
    expect(f.isAdmin).toBe(false)
    expect(f.canAccessFullContent).toBe(false)
    expect(h.signOut).not.toHaveBeenCalled()
  })

  it('an unverified email/password user exposes needsEmailVerification', () => {
    const f = resolveFlags({ role: 'learner' }, {
      user: { uid: 'u1', emailVerified: false, getIdToken: vi.fn() },
    })
    expect(f.emailVerified).toBe(false)
    expect(f.needsEmailVerification).toBe(true)
  })

  it('a verified (or Google) user does not need verification', () => {
    const f = resolveFlags({ role: 'learner' }, {
      user: { uid: 'u1', emailVerified: true, getIdToken: vi.fn() },
    })
    expect(f.emailVerified).toBe(true)
    expect(f.needsEmailVerification).toBe(false)
  })

  it('signed-out state reports emailVerified null and no verification need', () => {
    const f = resolveFlags(undefined, { user: null })
    expect(f.emailVerified).toBe(null)
    expect(f.needsEmailVerification).toBe(false)
  })
})

// refreshEmailVerification is the single choke point the /verify-email page,
// the banner, and AuthAction rely on: it must reload the user, force a token
// refresh (rules see the claim NOW, not in ≤1h), mirror onto the users doc,
// and flip the context state so guards re-evaluate.
describe('AuthProvider refreshEmailVerification', () => {
  beforeEach(() => {
    h.onAuthCb.current = null
    h.snap.next = null
    h.snap.error = null
    h.signOut.mockClear()
  })

  function ProbeRefresh() {
    const a = useAuth()
    return (
      <>
        <span data-testid="verified">{JSON.stringify(a.emailVerified)}</span>
        <button onClick={() => a.refreshEmailVerification()}>refresh</button>
      </>
    )
  }

  it('reloads, force-refreshes the token, mirrors to Firestore, and flips context state', async () => {
    const { auth } = await import('../firebase/config')
    const { updateDoc } = await import('firebase/firestore')
    const user = {
      uid: 'u1',
      emailVerified: false,
      getIdToken: vi.fn(() => Promise.resolve('tok')),
      reload: vi.fn(function () {
        // The real reload() mutates the user in place.
        this.emailVerified = true
        return Promise.resolve()
      }),
    }
    auth.currentUser = user

    render(<AuthProvider><ProbeRefresh /></AuthProvider>)
    act(() => { h.onAuthCb.current(user) })
    expect(screen.getByTestId('verified').textContent).toBe('false')

    await act(async () => {
      screen.getByText('refresh').click()
    })

    expect(user.reload).toHaveBeenCalled()
    expect(user.getIdToken).toHaveBeenCalledWith(true)
    expect(updateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ emailVerified: true }),
    )
    expect(screen.getByTestId('verified').textContent).toBe('true')
    auth.currentUser = null
  })

  it('does NOT touch the token or the mirror when still unverified', async () => {
    const { auth } = await import('../firebase/config')
    const { updateDoc } = await import('firebase/firestore')
    updateDoc.mockClear()
    const user = {
      uid: 'u1',
      emailVerified: false,
      getIdToken: vi.fn(() => Promise.resolve('tok')),
      reload: vi.fn(() => Promise.resolve()),
    }
    auth.currentUser = user

    render(<AuthProvider><ProbeRefresh /></AuthProvider>)
    act(() => { h.onAuthCb.current(user) })
    await act(async () => {
      screen.getByText('refresh').click()
    })

    expect(user.reload).toHaveBeenCalled()
    expect(user.getIdToken).not.toHaveBeenCalled()
    expect(updateDoc).not.toHaveBeenCalled()
    expect(screen.getByTestId('verified').textContent).toBe('false')
    auth.currentUser = null
  })
})

// Regression: the profile-snapshot auth-error path must not sign users out on
// a transient/offline forced-refresh failure. A stale ID token on reload shows
// up as a permission-denied snapshot error; AuthProvider force-refreshes the
// token, and the failure branch used to call expireSession() unconditionally —
// which logged people out whenever that refresh hit a flaky Zambian mobile
// link ("random signed out on reload"). It must now defer to shouldExpireSession
// and only end the session on a genuinely terminal auth failure.
describe('AuthProvider profile-snapshot auth-error recovery', () => {
  beforeEach(() => {
    h.onAuthCb.current = null
    h.snap.next = null
    h.snap.error = null
    h.signOut.mockClear()
  })

  async function driveSnapshotError({ code, refreshRejection }) {
    const user = {
      uid: 'u1',
      getIdToken: vi.fn(() => Promise.reject(refreshRejection)),
    }
    render(<AuthProvider><Probe /></AuthProvider>)
    act(() => { h.onAuthCb.current(user) })
    await act(async () => { await h.snap.error({ code }) })
    return user
  }

  it('keeps the session on a permission-denied whose forced refresh fails with a network error', async () => {
    const user = await driveSnapshotError({
      code: 'permission-denied',
      refreshRejection: { code: 'auth/network-request-failed' },
    })
    expect(user.getIdToken).toHaveBeenCalledWith(true)
    // Transient network failure → recoverable, NOT a logout.
    expect(h.signOut).not.toHaveBeenCalled()
    const flags = JSON.parse(screen.getByTestId('flags').textContent)
    expect(flags.hasProfile).toBe(false)
  })

  it('ends the session when the forced refresh fails with a terminal auth error', async () => {
    const user = await driveSnapshotError({
      code: 'unauthenticated',
      refreshRejection: { code: 'auth/user-token-expired' },
    })
    expect(user.getIdToken).toHaveBeenCalledWith(true)
    // Genuinely dead token → expireSession → signOut.
    expect(h.signOut).toHaveBeenCalledTimes(1)
  })

  it('does not sign out when the forced refresh fails with an unclassifiable error', async () => {
    await driveSnapshotError({
      code: 'permission-denied',
      refreshRejection: new Error('boom'),
    })
    // No auth/* code to classify → default to keeping the session.
    expect(h.signOut).not.toHaveBeenCalled()
  })
})

/* ── authSettled vs loading ──────────────────────────────────────────────────
   Two signals that look interchangeable and are not. `loading` answers "stop
   waiting, render something" and is ALSO cleared by the restoration watchdog —
   after 5s with no session hint, 30s with one — precisely so a slow cold start
   shows a page instead of hanging. In that window a returning learner is
   `loading === false` with `currentUser === null`.

   `authSettled` answers "this IS the answer" and is set only by
   `onAuthStateChanged`. Anything that FREEZES a per-user decision must wait for
   it; `useAssessmentEngineFlag`'s latch is the first such consumer, and gating
   it on `loading` would have committed a returning learner to the anonymous
   rollout bucket for the whole attempt. */

function SettleProbe() {
  const { loading, authSettled, currentUser } = useAuth()
  return (
    <span data-testid="settle">
      {JSON.stringify({ loading, authSettled, uid: currentUser?.uid ?? null })}
    </span>
  )
}
const readSettle = () => JSON.parse(screen.getByTestId('settle').textContent)

describe('AuthProvider authSettled', () => {
  beforeEach(() => {
    h.onAuthCb.current = null
    h.snap.next = null
    h.snap.error = null
    h.signOut.mockClear()
    window.localStorage.clear()
  })

  it('starts false — nothing has been heard yet', () => {
    render(<AuthProvider><SettleProbe /></AuthProvider>)
    expect(readSettle()).toEqual({ loading: true, authSettled: false, uid: null })
  })

  it('the WATCHDOG clears loading without settling auth', () => {
    // The state the engine flag's latch must not commit on. Driven through the
    // real timer the provider installs, so this fails if the watchdog is ever
    // rewired to set both.
    vi.useFakeTimers()
    try {
      render(<AuthProvider><SettleProbe /></AuthProvider>)
      act(() => { vi.advanceTimersByTime(31_000) })
      const state = readSettle()
      expect(state.loading).toBe(false)   // render something
      expect(state.authSettled).toBe(false) // but do not claim to know who
      expect(state.uid).toBe(null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the first auth event settles it, signed in or out', () => {
    render(<AuthProvider><SettleProbe /></AuthProvider>)
    act(() => { h.onAuthCb.current({ uid: 'u1', getIdToken: vi.fn() }) })
    expect(readSettle().authSettled).toBe(true)
    expect(readSettle().uid).toBe('u1')
  })

  it('a signed-OUT answer settles it too — "nobody" is an answer', () => {
    render(<AuthProvider><SettleProbe /></AuthProvider>)
    act(() => { h.onAuthCb.current(null) })
    expect(readSettle()).toEqual({ loading: false, authSettled: true, uid: null })
  })

  it('a late auth event after the watchdog still settles it', () => {
    // The correctable path: the watchdog gave up, then Firebase spoke.
    vi.useFakeTimers()
    try {
      render(<AuthProvider><SettleProbe /></AuthProvider>)
      act(() => { vi.advanceTimersByTime(31_000) })
      expect(readSettle().authSettled).toBe(false)
      act(() => { h.onAuthCb.current({ uid: 'late-1', getIdToken: vi.fn() }) })
      expect(readSettle()).toMatchObject({ authSettled: true, uid: 'late-1' })
    } finally {
      vi.useRealTimers()
    }
  })
})
