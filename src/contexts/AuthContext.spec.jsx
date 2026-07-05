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
})
