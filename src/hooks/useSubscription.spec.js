import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// useSubscription is a thin entitlement-derivation hook: it folds the auth
// flags (isAdmin / isPaidTeacher / isPremium) and the resolved plan into the
// access decisions every gated surface reads — canAccessFullContent, the
// exam-mode / weakness-analysis feature flags, the access badge, and the
// tier label. The underlying getActivePlan / getPlanTier helpers have their
// own spec; this one pins the COMBINATION logic in the hook, which is where
// a learner/teacher gating regression would actually slip through.
//
// useAuth and the attempt limiter are mocked (they pull in Firebase); the real
// subscriptionConfig runs so the plan→feature-flag mapping is exercised
// end-to-end.
//
// The limiter is mocked at `./firestore/attemptLimiter`, which is the module
// `useSubscription` imports. It deliberately does NOT go through
// `useFirestore`: routing it there would drag the whole Firestore surface —
// and the authoring schemas behind it — into the eager app shell. Mocking the
// facade instead of the limiter would make this spec pass while that
// regression shipped, so the mock target is part of what is being asserted.

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('./firestore/attemptLimiter', () => ({ checkAndConsumeAttempt: vi.fn() }))

import { useAuth } from '../contexts/AuthContext'
import { checkAndConsumeAttempt } from './firestore/attemptLimiter'
import { useSubscription } from './useSubscription.js'
import { ACCESS_LEVELS } from '../engines/payment-engine/subscriptionConfig'

const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

// Sensible all-false defaults; each test overrides the bits it cares about.
function setAuth(overrides = {}) {
  useAuth.mockReturnValue({
    currentUser: { uid: 'u1' },
    userProfile: { role: 'learner', subscriptionPlan: 'free' },
    isPremium: false,
    isAdmin: false,
    isPaidTeacher: false,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSubscription — content-access gating', () => {
  it('grants full access + admin badge + every feature flag to an admin', () => {
    // superAdmin profile so the real getActivePlan resolves to the top plan
    // (max_yearly → examMode/weaknessAnalysis true).
    setAuth({ isAdmin: true, userProfile: { role: 'superAdmin' } })
    const { result } = renderHook(() => useSubscription())

    expect(result.current.canAccessFullContent).toBe(true)
    expect(result.current.isDemoOnly).toBe(false)
    expect(result.current.accessLevel).toBe(ACCESS_LEVELS.FULL)
    expect(result.current.accessBadge.label).toBe('Admin Access')
    expect(result.current.canUseExamMode).toBe(true)
    expect(result.current.canUseWeaknessAnalysis).toBe(true)
  })

  it('gives a premium learner full access, Premium badge, and feature flags', () => {
    setAuth({
      isPremium: true,
      userProfile: { role: 'learner', premium: true, subscriptionPlan: 'grade7_monthly', subscriptionExpiry: future },
    })
    const { result } = renderHook(() => useSubscription())

    expect(result.current.canAccessFullContent).toBe(true)
    expect(result.current.accessLevel).toBe(ACCESS_LEVELS.FULL)
    expect(result.current.accessBadge.label).toBe('Premium')
    expect(result.current.canUseExamMode).toBe(true)
    expect(result.current.canUseWeaknessAnalysis).toBe(true)
    expect(result.current.planId).toBe('grade7_monthly')
    // Learner premium plans (no `tier` field) read as 'max' per product naming.
    expect(result.current.planTier).toBe('max')
    expect(result.current.tierLabel).toBe('Max')
  })

  it('labels an active pro-tier subscription as Pro', () => {
    setAuth({
      isPremium: true,
      userProfile: { role: 'teacher', premium: true, subscriptionPlan: 'pro_monthly', subscriptionExpiry: future },
    })
    const { result } = renderHook(() => useSubscription())
    expect(result.current.planTier).toBe('pro')
    expect(result.current.tierLabel).toBe('Pro')
  })

  it('gives a paid teacher full access + Teacher badge — but NOT learner exam mode', () => {
    // A teacher-portal subscription does not stamp a learner premium plan, so
    // the learner-only feature flags stay off even though content is unlocked.
    setAuth({ isPaidTeacher: true, userProfile: { role: 'teacher', subscriptionPlan: 'free' } })
    const { result } = renderHook(() => useSubscription())

    expect(result.current.canAccessFullContent).toBe(true)
    expect(result.current.accessLevel).toBe(ACCESS_LEVELS.FULL)
    expect(result.current.accessBadge.label).toBe('Teacher Plan')
    expect(result.current.canUseExamMode).toBe(false)
    expect(result.current.canUseWeaknessAnalysis).toBe(false)
  })

  it('locks a free user to demo-only access with the Demo badge', () => {
    setAuth()
    const { result } = renderHook(() => useSubscription())

    expect(result.current.canAccessFullContent).toBe(false)
    expect(result.current.isDemoOnly).toBe(true)
    expect(result.current.accessLevel).toBe(ACCESS_LEVELS.DEMO_ONLY)
    expect(result.current.accessBadge.label).toBe('Demo Access')
    expect(result.current.canUseExamMode).toBe(false)
    expect(result.current.canUseWeaknessAnalysis).toBe(false)
    expect(result.current.planId).toBe('free')
    expect(result.current.planTier).toBe('free')
    expect(result.current.tierLabel).toBe('Free')
  })

  it('treats an expired premium learner as free (demo-only)', () => {
    setAuth({
      // The profile still carries a premium access flag, but the expiry is in
      // the past → hasPremiumAccess / getActivePlan / getPlanTier all collapse
      // the access back to free.
      isPremium: false,
      userProfile: {
        role: 'learner',
        premium: true,
        subscriptionPlan: 'grade7_monthly',
        subscriptionExpiry: new Date(Date.now() - 1000),
      },
    })
    const { result } = renderHook(() => useSubscription())
    expect(result.current.canAccessFullContent).toBe(false)
    expect(result.current.planTier).toBe('free')
    expect(result.current.tierLabel).toBe('Free')
  })
})

describe('useSubscription — tryStartQuiz + legacy fields', () => {
  it('blocks tryStartQuiz when unauthenticated', async () => {
    setAuth({ currentUser: null })
    const { result } = renderHook(() => useSubscription())
    await expect(result.current.tryStartQuiz()).resolves.toEqual({
      allowed: false,
      reason: 'not_authenticated',
    })
  })

  it('allows tryStartQuiz when authenticated (daily limit no longer enforced)', async () => {
    setAuth()
    const { result } = renderHook(() => useSubscription())
    await expect(result.current.tryStartQuiz()).resolves.toEqual({ allowed: true, reason: null })
  })

  it('exposes the no-limit legacy fields and the firestore consume passthrough', () => {
    setAuth()
    const { result } = renderHook(() => useSubscription())
    expect(result.current.attemptsLeft).toBe(Infinity)
    expect(result.current.dailyLimit).toBe(Infinity)
    expect(result.current.usedToday).toBe(0)
    expect(result.current.isAtLimit).toBe(false)
    expect(result.current.checkAndConsumeAttempt).toBe(checkAndConsumeAttempt)
  })
})
