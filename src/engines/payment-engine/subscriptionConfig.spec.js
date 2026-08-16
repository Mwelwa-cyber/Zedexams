import { describe, expect, it } from 'vitest'
import { getPlanTier, hasPremiumAccess } from './subscriptionConfig'

const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const past = new Date(Date.now() - 24 * 60 * 60 * 1000)

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

describe('hasPremiumAccess', () => {
  it('grants a premium flag with a future expiry, denies a past one', () => {
    expect(hasPremiumAccess({ premium: true, subscriptionExpiry: future })).toBe(true)
    expect(hasPremiumAccess({ premium: true, subscriptionExpiry: past })).toBe(false)
  })

  it('denies any non-premium profile', () => {
    expect(hasPremiumAccess({ plan: 'free' })).toBe(false)
    expect(hasPremiumAccess(null)).toBe(false)
    expect(hasPremiumAccess(undefined)).toBe(false)
  })

  // The fail-closed fix: a premium flag with NO parseable expiry must NOT grant
  // access unless it is an explicit lifetime grant.
  it('denies a premium flag with no/invalid expiry and no lifetime marker (fail closed)', () => {
    expect(hasPremiumAccess({ premium: true, subscriptionExpiry: null })).toBe(false)
    expect(hasPremiumAccess({ subscriptionStatus: 'active' })).toBe(false)
    expect(hasPremiumAccess({ premium: true, subscriptionExpiry: 'garbage' })).toBe(false)
  })

  it('grants a premium flag with no expiry WHEN subscriptionLifetime === true', () => {
    expect(hasPremiumAccess({ premium: true, subscriptionExpiry: null, subscriptionLifetime: true })).toBe(true)
  })

  it('still bypasses every check for admins / super-admins', () => {
    expect(hasPremiumAccess({ role: 'superAdmin' })).toBe(true)
    expect(hasPremiumAccess({ role: 'admin' })).toBe(true)
  })
})
