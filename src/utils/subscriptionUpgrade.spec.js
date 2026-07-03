import { describe, it, expect } from 'vitest'
import {
  dailyRate,
  isUpgradePath,
  computeUpgradeQuote,
  resolveCurrentProPlanId,
  getUpgradeQuoteForProfile,
  MIN_UPGRADE_ZMW,
} from './subscriptionUpgrade'
import { PLANS } from './subscriptionConfig'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-06-19T00:00:00Z')
const inDays = (n) => new Date(NOW.getTime() + n * DAY)

// This is the client mirror of the server proration maths — it must agree with
// functions/subscriptionUpgrade.js exactly (the server is what actually
// charges). The maths + the Pro→Max-only gate are pinned here so a drift in
// either copy is caught.

describe('dailyRate', () => {
  it('is price / duration', () => {
    expect(dailyRate(PLANS.pro_monthly)).toBeCloseTo(PLANS.pro_monthly.priceZMW / 30)
    expect(dailyRate({ priceZMW: 10, durationDays: 0 })).toBe(0)
  })
})

describe('isUpgradePath', () => {
  it('only a same-period pro → max counts', () => {
    expect(isUpgradePath('pro_monthly', 'max_monthly')).toBe(true)
    expect(isUpgradePath('pro_yearly', 'max_yearly')).toBe(true)
    expect(isUpgradePath('max_monthly', 'max_yearly')).toBe(false) // already max
    expect(isUpgradePath('max_monthly', 'pro_monthly')).toBe(false) // downgrade
    expect(isUpgradePath('pro_monthly', 'pro_yearly')).toBe(false) // renewal
    expect(isUpgradePath('grade7_monthly', 'max_monthly')).toBe(false) // learner pack
    // Cross-cadence is a plan change, not a prorated tier bump.
    expect(isUpgradePath('pro_monthly', 'max_yearly')).toBe(false)
    expect(isUpgradePath('pro_yearly', 'max_monthly')).toBe(false)
  })
})

describe('computeUpgradeQuote', () => {
  it('charges the daily-rate difference for the days left', () => {
    const q = computeUpgradeQuote({
      fromPlan: PLANS.pro_monthly, toPlan: PLANS.max_monthly, expiry: inDays(30), now: NOW,
    })
    expect(q.isUpgrade).toBe(true)
    // A full month remaining → pay exactly the Max−Pro monthly difference.
    expect(q.amountZMW).toBe(PLANS.max_monthly.priceZMW - PLANS.pro_monthly.priceZMW)
    expect(q.daysRemaining).toBe(30)
  })

  it('is far cheaper than buying a fresh Max period', () => {
    const q = computeUpgradeQuote({
      fromPlan: PLANS.pro_yearly, toPlan: PLANS.max_monthly, expiry: inDays(114), now: NOW,
    })
    const expected = Math.round((PLANS.max_monthly.priceZMW / 30 - PLANS.pro_yearly.priceZMW / 365) * 114)
    expect(q.amountZMW).toBe(expected)
  })

  it('is not an upgrade when expired or undated', () => {
    expect(computeUpgradeQuote({ fromPlan: PLANS.pro_monthly, toPlan: PLANS.max_monthly, expiry: inDays(-1), now: NOW }).isUpgrade).toBe(false)
    expect(computeUpgradeQuote({ fromPlan: PLANS.pro_monthly, toPlan: PLANS.max_monthly, expiry: null, now: NOW }).isUpgrade).toBe(false)
  })

  it('never charges below the floor for a real upgrade', () => {
    const q = computeUpgradeQuote({ fromPlan: PLANS.pro_monthly, toPlan: PLANS.max_monthly, expiry: inDays(1), now: NOW })
    expect(q.amountZMW).toBeGreaterThanOrEqual(MIN_UPGRADE_ZMW)
  })
})

describe('getUpgradeQuoteForProfile', () => {
  it('quotes a live Pro teacher stepping up to Max', () => {
    const q = getUpgradeQuoteForProfile(
      { subscriptionPlan: 'pro_monthly', teacherPlanExpiresAt: inDays(30) }, 'max_monthly', NOW,
    )
    expect(q.isUpgrade).toBe(true)
    expect(q.amountZMW).toBe(PLANS.max_monthly.priceZMW - PLANS.pro_monthly.priceZMW)
  })

  it('is a no-op for a teacher already on Max', () => {
    expect(getUpgradeQuoteForProfile(
      { subscriptionPlan: 'max_monthly', teacherPlanExpiresAt: inDays(30) }, 'max_yearly', NOW,
    ).isUpgrade).toBe(false)
  })

  it('does not prorate a Pro · Monthly teacher onto Max · Yearly (cross-period → full price)', () => {
    expect(getUpgradeQuoteForProfile(
      { subscriptionPlan: 'pro_monthly', teacherPlanExpiresAt: inDays(29) }, 'max_yearly', NOW,
    ).isUpgrade).toBe(false)
  })

  it('is a no-op for a free teacher (full price applies)', () => {
    expect(getUpgradeQuoteForProfile({}, 'max_monthly', NOW).isUpgrade).toBe(false)
  })

  it('resolveCurrentProPlanId falls back to pro_monthly', () => {
    expect(resolveCurrentProPlanId({ subscriptionPlan: 'pro_yearly' })).toBe('pro_yearly')
    expect(resolveCurrentProPlanId({ subscriptionPlan: 'legacy' })).toBe('pro_monthly')
  })
})
