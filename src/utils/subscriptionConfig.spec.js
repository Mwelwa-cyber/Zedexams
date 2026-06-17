import { describe, expect, it } from 'vitest'
import { getPlanTier } from './subscriptionConfig'

const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

describe('getPlanTier', () => {
  it('returns "free" for a non-paying user', () => {
    expect(getPlanTier({ role: 'learner', subscriptionPlan: 'free' })).toBe('free')
    expect(getPlanTier(null)).toBe('free')
  })

  it('returns "free" when a subscription has expired', () => {
    expect(getPlanTier({
      premium: true,
      subscriptionPlan: 'max_monthly',
      subscriptionExpiry: new Date(Date.now() - 1000),
    })).toBe('free')
  })

  it('returns "pro" for an active pro plan', () => {
    expect(getPlanTier({
      isPremium: true,
      subscriptionPlan: 'pro_monthly',
      subscriptionExpiry: future,
    })).toBe('pro')
    expect(getPlanTier({
      isPremium: true,
      subscriptionPlan: 'pro_yearly',
      subscriptionExpiry: future,
    })).toBe('pro')
  })

  it('returns "max" for an active max plan', () => {
    expect(getPlanTier({
      isPremium: true,
      subscriptionPlan: 'max_yearly',
      subscriptionExpiry: future,
    })).toBe('max')
  })

  it('returns "max" for a premium learner plan (no tier field)', () => {
    expect(getPlanTier({
      isPremium: true,
      subscriptionPlan: 'grade7_monthly',
      subscriptionExpiry: future,
    })).toBe('max')
    expect(getPlanTier({
      isPremium: true,
      subscriptionPlan: 'monthly',
      subscriptionExpiry: future,
    })).toBe('max')
  })
})
