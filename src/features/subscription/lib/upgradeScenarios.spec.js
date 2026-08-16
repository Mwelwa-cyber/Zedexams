import { describe, it, expect } from 'vitest'
import { PLANS } from '../../../engines/payment-engine/subscriptionConfig'
import { resolveUpgradeScenario, UPGRADE_REASONS } from './upgradeScenarios'

// The copy map behind the compact contextual upgrade pop-up. Pure module —
// no mocks needed. The price assertions read the canonical PLANS catalogue so
// a price change there can never silently drift from the pop-up copy.

describe('resolveUpgradeScenario — completeness', () => {
  for (const reason of UPGRADE_REASONS) {
    it(`resolves a complete scenario for "${reason}"`, () => {
      const s = resolveUpgradeScenario(reason, { feature: 'worksheets', tool: 'worksheet' })
      expect(s).toBeTruthy()
      expect(s.heading).toBeTruthy()
      expect(s.description).toBeTruthy()
      expect(s.primaryLabel).toBeTruthy()
      expect(s.dismissLabel).toBe('Not now')
      expect(s.planSummary.name).toBeTruthy()
      expect(s.planIds.length).toBeGreaterThan(0)
      expect(s.planIds).toContain(s.defaultPlanId)
      // Compact modal contract: never more than three benefits.
      expect(s.benefits.length).toBeLessThanOrEqual(3)
    })
  }

  it('returns null for reasons this pop-up does not handle', () => {
    expect(resolveUpgradeScenario('quiz-preview-limit', {})).toBeNull()
    expect(resolveUpgradeScenario('not-a-real-scenario', {})).toBeNull()
    expect(resolveUpgradeScenario(undefined, {})).toBeNull()
  })

  it('survives an empty ctx without leaking "undefined" into copy', () => {
    for (const reason of UPGRADE_REASONS) {
      const s = resolveUpgradeScenario(reason, {})
      expect(s.heading).not.toMatch(/undefined/)
      expect(s.description).not.toMatch(/undefined/)
    }
  })
})

describe('resolveUpgradeScenario — contextual copy', () => {
  it('names the blocked feature in the heading', () => {
    const s = resolveUpgradeScenario('monthly-limit', { feature: 'lesson plans' })
    expect(s.heading).toContain('lesson plans')
  })

  it('uses studio-specific description when the tool is known', () => {
    const s = resolveUpgradeScenario('monthly-limit', { feature: 'lesson plans', tool: 'lesson_plan' })
    expect(s.description).toMatch(/lesson plans, worksheets, tests/)
    expect(s.description).toMatch(/saved work is safe/i)
  })

  it('adds the reset note when resetDays is provided', () => {
    const s = resolveUpgradeScenario('monthly-limit', { feature: 'worksheets', resetDays: 9 })
    expect(s.note).toBe('Your free allowance resets in 9 days.')
    expect(resolveUpgradeScenario('monthly-limit', { feature: 'worksheets' }).note).toBeNull()
  })

  it('routes max-feature to the Max plans and everything else to Pro', () => {
    const max = resolveUpgradeScenario('max-feature', { feature: 'Test papers' })
    expect(max.planTarget).toBe('max')
    expect(max.defaultPlanId).toBe('max_monthly')
    for (const reason of ['feature-locked', 'monthly-limit', 'daily-cap']) {
      const s = resolveUpgradeScenario(reason, { feature: 'worksheets' })
      expect(s.planTarget).toBe('pro')
      expect(s.defaultPlanId).toBe('pro_monthly')
    }
  })

  it('offers the K25 top-up on limit scenarios but not on locked studios', () => {
    expect(resolveUpgradeScenario('monthly-limit', {}).secondary?.action).toBe('topup')
    expect(resolveUpgradeScenario('daily-cap', {}).secondary?.action).toBe('topup')
    expect(resolveUpgradeScenario('max-feature', {}).secondary?.action).toBe('topup')
    expect(resolveUpgradeScenario('feature-locked', {}).secondary).toBeNull()
  })
})

describe('resolveUpgradeScenario — prices come from the PLANS catalogue', () => {
  it('derives the Pro price for the primary CTA and plan summary', () => {
    const s = resolveUpgradeScenario('monthly-limit', { feature: 'worksheets' })
    expect(s.primaryLabel).toBe(`Upgrade to Pro · K${PLANS.pro_monthly.priceZMW}/mo`)
    expect(s.planSummary.priceLabel).toBe(`K${PLANS.pro_monthly.priceZMW}/month`)
  })

  it('derives the Max price for the Max upsell', () => {
    const s = resolveUpgradeScenario('max-feature', { feature: 'Exam papers' })
    expect(s.primaryLabel).toBe(`Upgrade to Max · K${PLANS.max_monthly.priceZMW}/mo`)
    expect(s.planSummary.priceLabel).toBe(`K${PLANS.max_monthly.priceZMW}/month`)
  })
})

describe('resolveUpgradeScenario — native (Google Play) rules', () => {
  it('strips ZMW price literals and the Lenco top-up on native', () => {
    for (const reason of UPGRADE_REASONS) {
      const s = resolveUpgradeScenario(reason, { feature: 'worksheets' }, { native: true })
      expect(s.primaryLabel).not.toMatch(/K\d/)
      expect(s.planSummary.priceLabel).toBeNull()
      expect(s.secondary).toBeNull()
      expect(s.footerNote).toMatch(/Play Store/)
    }
  })

  it('keeps ZMW prices and the top-up on web', () => {
    const s = resolveUpgradeScenario('daily-cap', {}, { native: false })
    expect(s.primaryLabel).toMatch(/K\d/)
    expect(s.secondary?.label).toMatch(/K25/)
    expect(s.footerNote).not.toMatch(/Play Store/)
  })
})
