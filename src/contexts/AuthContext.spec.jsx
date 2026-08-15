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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// Shared capture holders (vi.hoisted runs before the mock factories).
const h = vi.hoisted(() => ({
  onAuthCb: { current: null },
  snap: { next: null, error: null },
  signOut: vi.fn(() => Promise.resolve()),
  // One shared callable stand-in: AuthContext binds `bootstrapUserProfile` at
  // module scope, so the deletion tests below need a spy that survives that.
  callable: vi.fn(() => Promise.resolve({ data: {} })),
  setAuthStateTag: vi.fn(),
  reportAuthInitFailure: vi.fn(),
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
  httpsCallable: () => h.callable,
}))

// Side-effect utils — stubbed; their behaviour is not under test here.
vi.mock('../utils/runtime', () => ({ isNativePlatform: () => false }))
vi.mock('../utils/sentry', () => ({
  setSentryUser: vi.fn(),
  clearSentryUser: vi.fn(),
  setAuthStateTag: h.setAuthStateTag,
  reportAuthInitFailure: h.reportAuthInitFailure,
}))
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
import { beginAccountDeletion, endAccountDeletion } from '../utils/accountDeletionState'

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

/**
 * Profile repair vs. account deletion.
 *
 * The profile listener treats a missing `users/{uid}` as damage and repairs it
 * by calling `bootstrapUserProfile`. That is right for the case it was written
 * for — a signup whose profile write did not land — and was the client half of
 * the deletion bug: the purge deleted `users/{uid}` while the tab was still
 * signed in, this listener fired, and the callable wrote a fresh `learner`
 * profile back carrying the email we had been asked to erase.
 *
 * Both directions are pinned here, because the fix is only correct if it does
 * nothing at all when a deletion is NOT in flight.
 */
describe('AuthProvider profile repair during account deletion', () => {
  beforeEach(() => {
    h.onAuthCb.current = null
    h.snap.next = null
    h.callable.mockClear()
    endAccountDeletion()
  })

  afterEach(() => { endAccountDeletion() })

  const vanish = async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    act(() => { h.onAuthCb.current({ uid: 'u1', getIdToken: vi.fn() }) })
    // The profile is there, then it is not — the shape of a purge.
    act(() => { h.snap.next({ exists: () => true, data: () => ({ role: 'learner' }) }) })
    await act(async () => { h.snap.next({ exists: () => false }) })
  }

  it('does NOT rebuild a profile that is being deleted on purpose', async () => {
    beginAccountDeletion()
    await vanish()
    expect(h.callable).not.toHaveBeenCalled()
    const f = JSON.parse(screen.getByTestId('flags').textContent)
    expect(f.hasProfile).toBe(false)
  })

  it('still repairs a genuinely missing profile when no deletion is in flight', async () => {
    await vanish()
    expect(h.callable).toHaveBeenCalledTimes(1)
  })

  it('resumes repairing once the deletion flag is cleared', async () => {
    beginAccountDeletion()
    endAccountDeletion()
    await vanish()
    expect(h.callable).toHaveBeenCalledTimes(1)
  })
})

/* ── the session-restoration watchdog on a device that HAS a session ─────────
   Sentry PYTHON-K. Firebase Auth's IndexedDB persistence closes its database on
   `visibilitychange → hidden` and refuses to retry, so a tab hidden while auth
   is initialising leaves `_initializationPromise` rejected and `_isInitialized`
   false permanently. `registerStateListener` attaches its callback with a bare
   `.then()` — no rejection path — so `onAuthStateChanged` NEVER fires, and
   `notifyAuthListeners` is gated behind `_isInitialized` so no later sign-in
   can revive it either.

   The watchdog is the only thing that runs in that state. Dropping the loading
   gate there leaves `loading === false && currentUser === null`, which
   ProtectedRoute reads as "genuinely signed out" and redirects to /login —
   logging out a user whose session was fine. On a hinted device it must
   RELOAD instead, which is the only way to re-drive Firebase's init. */

describe('AuthProvider restoration watchdog — hinted device recovery', () => {
  let reload
  let realLocation
  let visibility

  beforeEach(() => {
    h.onAuthCb.current = null
    window.localStorage.clear()
    window.sessionStorage.clear()
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
    reload = vi.fn()
    realLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...realLocation, reload },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: realLocation,
    })
    delete document.visibilityState
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  const runWatchdog = () => {
    vi.useFakeTimers()
    try {
      render(<AuthProvider><SettleProbe /></AuthProvider>)
      act(() => { vi.advanceTimersByTime(31_000) })
    } finally {
      vi.useRealTimers()
    }
  }

  it('reloads instead of presenting the user as signed out', () => {
    window.localStorage.setItem('auth:hasSession', '1')
    runWatchdog()
    expect(reload).toHaveBeenCalledTimes(1)
    // Critically it must NOT have revealed: loading:false + uid:null is exactly
    // what ProtectedRoute turns into a redirect to /login.
    expect(readSettle().loading).toBe(true)
    expect(readSettle().authSettled).toBe(false)
  })

  it('spends the reload only once — a second failure reveals instead of looping', () => {
    window.localStorage.setItem('auth:hasSession', '1')
    window.sessionStorage.setItem('auth:initRecoveryAttempted', '1')
    runWatchdog()
    expect(reload).not.toHaveBeenCalled()
    expect(readSettle().loading).toBe(false)
  })

  it('defers the reload while the tab is hidden, then recovers on return', () => {
    window.localStorage.setItem('auth:hasSession', '1')
    visibility = 'hidden'
    runWatchdog()
    // Reloading a hidden tab re-runs init in the very conditions that break it.
    expect(reload).not.toHaveBeenCalled()
    expect(readSettle().loading).toBe(true)

    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never reloads a device with no session — nothing to rescue', () => {
    runWatchdog()
    expect(reload).not.toHaveBeenCalled()
    expect(readSettle().loading).toBe(false)
  })

  it('a real auth event returns the reload to the tab for a later episode', () => {
    window.localStorage.setItem('auth:hasSession', '1')
    window.sessionStorage.setItem('auth:initRecoveryAttempted', '1')
    render(<AuthProvider><SettleProbe /></AuthProvider>)
    act(() => { h.onAuthCb.current({ uid: 'u1', getIdToken: vi.fn() }) })
    expect(window.sessionStorage.getItem('auth:initRecoveryAttempted')).toBe(null)
  })
})

/* ── the fast path, and the telemetry that made this bug hard to triage ──────
   Two follow-ups to the PYTHON-K fix.

   1. LATENCY. The watchdog is a backstop, not a detector: a hinted device
      waited 30 s before recovering. Firebase's wedged init surfaces as an
      unhandled rejection immediately, so the rejection is the trigger and the
      preconditions (hint + unresolved + hid-during-init) are the evidence —
      deliberately NOT the error message, which would bind us to one SDK
      version's wording and go quietly dead when it changed.

   2. TRIAGE. `setSentryUser` is only called from the auth callback this bug
      prevents, so the issue reported "Users impacted: 0" for eight days while
      it was logging people out. The failure now reports itself. */

describe('AuthProvider auth-init fast path + telemetry', () => {
  let reload
  let realLocation
  let visibility

  beforeEach(() => {
    h.onAuthCb.current = null
    h.setAuthStateTag.mockClear()
    h.reportAuthInitFailure.mockClear()
    window.localStorage.clear()
    window.sessionStorage.clear()
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true, get: () => visibility,
    })
    reload = vi.fn()
    realLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true, writable: true, value: { ...realLocation, reload },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true, writable: true, value: realLocation,
    })
    delete document.visibilityState
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  const hide = () => {
    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
  }
  const show = () => {
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
  }
  // A bare Event is enough precisely because nothing inspects the reason.
  const reject = () => act(() => { window.dispatchEvent(new Event('unhandledrejection')) })

  it('recovers on the rejection instead of waiting out the 30s watchdog', () => {
    window.localStorage.setItem('auth:hasSession', '1')
    render(<AuthProvider><SettleProbe /></AuthProvider>)
    hide()
    reject()
    // Still hidden, so it defers rather than reloading a background tab.
    expect(reload).not.toHaveBeenCalled()
    expect(readSettle().loading).toBe(true)
    // The user comes back — and it recovers immediately, no timers advanced.
    show()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('recovers immediately when the page is already visible again', () => {
    window.localStorage.setItem('auth:hasSession', '1')
    render(<AuthProvider><SettleProbe /></AuthProvider>)
    hide()
    show()
    reject()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('ignores a rejection when the page never hid — not this failure', () => {
    window.localStorage.setItem('auth:hasSession', '1')
    render(<AuthProvider><SettleProbe /></AuthProvider>)
    reject()
    expect(reload).not.toHaveBeenCalled()
    expect(h.reportAuthInitFailure).not.toHaveBeenCalled()
  })

  it('ignores a rejection on a device with no session', () => {
    render(<AuthProvider><SettleProbe /></AuthProvider>)
    hide()
    reject()
    show()
    expect(reload).not.toHaveBeenCalled()
    expect(h.reportAuthInitFailure).not.toHaveBeenCalled()
  })

  it('stops listening once auth speaks, so a later rejection is inert', () => {
    window.localStorage.setItem('auth:hasSession', '1')
    render(<AuthProvider><SettleProbe /></AuthProvider>)
    hide()
    act(() => { h.onAuthCb.current({ uid: 'u1', getIdToken: vi.fn() }) })
    reject()
    show()
    expect(reload).not.toHaveBeenCalled()
  })

  it('tags auth as unresolved on mount and resolved once Firebase speaks', () => {
    render(<AuthProvider><SettleProbe /></AuthProvider>)
    expect(h.setAuthStateTag).toHaveBeenCalledWith('unresolved')
    act(() => { h.onAuthCb.current(null) })
    expect(h.setAuthStateTag).toHaveBeenCalledWith('resolved')
  })

  it('reports the failure to Sentry with the context triage needed', () => {
    window.localStorage.setItem('auth:hasSession', '1')
    render(<AuthProvider><SettleProbe /></AuthProvider>)
    hide()
    reject()
    expect(h.setAuthStateTag).toHaveBeenCalledWith('wedged')
    expect(h.reportAuthInitFailure).toHaveBeenCalledTimes(1)
    expect(h.reportAuthInitFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'defer', viaFastPath: true, documentHidden: true, hidDuringInit: true,
      }),
    )
  })

  it('reports once per episode, not once per path that reaches the same verdict', () => {
    window.localStorage.setItem('auth:hasSession', '1')
    vi.useFakeTimers()
    try {
      render(<AuthProvider><SettleProbe /></AuthProvider>)
      hide()
      reject()
      reject()
      act(() => { vi.advanceTimersByTime(31_000) })
      expect(h.reportAuthInitFailure).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT report a slow signed-out cold start — that is ordinary', () => {
    vi.useFakeTimers()
    try {
      render(<AuthProvider><SettleProbe /></AuthProvider>)
      act(() => { vi.advanceTimersByTime(31_000) })
      expect(readSettle().loading).toBe(false)
      expect(h.reportAuthInitFailure).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
