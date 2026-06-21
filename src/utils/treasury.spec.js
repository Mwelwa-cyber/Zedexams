import { describe, it, expect } from 'vitest'
import {
  computeTreasury,
  deriveBudgetFromRevenueUsd,
  monthProgress,
  fmtUsd,
  fmtZmw,
  fmtRatio,
  fmtRunway,
  seedTreasuryInputs,
  DEFAULT_REINVEST_RATIO,
} from './treasury'

// This fixture is identical to the one asserted in functions/treasury.test.js
// (the authoritative node-tested copy). Keeping both green guarantees the
// client mirror never silently drifts from the server math.
describe('computeTreasury — canonical fixture (mirror of functions/treasury.test.js)', () => {
  const t = computeTreasury({
    revenueZmw: 20000,
    apiCostUsd: 180,
    zmwPerUsd: 26,
    reinvestRatio: 0.3,
    daysElapsed: 10,
    daysInMonth: 30,
  })

  it('converts ZMW revenue to USD', () => {
    expect(t.revenueUsd).toBeCloseTo(769.23, 1)
  })
  it('computes gross profit + margin', () => {
    expect(t.grossProfitUsd).toBeCloseTo(589.23, 1)
    expect(t.grossMarginPct).toBeCloseTo(0.766, 3)
  })
  it('computes the self-funding ratio', () => {
    expect(t.selfFundingRatio).toBeCloseTo(4.273, 2)
    expect(t.sustainable).toBe(true)
  })
  it('derives the revenue-linked budget ceiling and headroom', () => {
    expect(t.derivedBudgetUsd).toBeCloseTo(230.77, 1)
    expect(t.budgetHeadroomUsd).toBeCloseTo(50.77, 1)
    expect(t.budgetUsedPct).toBeCloseTo(0.78, 2)
    expect(t.overBudget).toBe(false)
  })
  it('projects month-end run-rate and a budget runway', () => {
    expect(t.dailyBurnUsd).toBeCloseTo(18, 3)
    expect(t.projectedMonthCostUsd).toBeCloseTo(540, 1)
    expect(t.runwayDays).toBeCloseTo(2.82, 1)
  })
  it('lands in the healthy band', () => {
    expect(t.status).toBe('healthy')
  })
})

describe('computeTreasury — status transitions', () => {
  it('idle when there is no revenue and no spend', () => {
    expect(computeTreasury({ revenueZmw: 0, apiCostUsd: 0 }).status).toBe('idle')
  })
  it('bootstrapping when spending before earning', () => {
    expect(computeTreasury({ revenueZmw: 0, apiCostUsd: 5 }).status).toBe('bootstrapping')
  })
  it('tight above 80% of the ceiling', () => {
    expect(computeTreasury({ revenueZmw: 26000, apiCostUsd: 260, zmwPerUsd: 26 }).status).toBe('tight')
  })
  it('over (governor would pause) above the ceiling', () => {
    const over = computeTreasury({ revenueZmw: 26000, apiCostUsd: 320, zmwPerUsd: 26 })
    expect(over.status).toBe('over')
    expect(over.overBudget).toBe(true)
  })
})

describe('deriveBudgetFromRevenueUsd', () => {
  it('is revenue × ratio', () => {
    expect(deriveBudgetFromRevenueUsd({ revenueUsd: 1000, reinvestRatio: 0.3 })).toBeCloseTo(300, 5)
  })
  it('respects a floor when revenue is tiny', () => {
    expect(deriveBudgetFromRevenueUsd({ revenueUsd: 10, reinvestRatio: 0.3, floorUsd: 50 })).toBe(50)
  })
  it('defaults to the 30% reinvest ratio', () => {
    expect(deriveBudgetFromRevenueUsd({ revenueUsd: 1000 })).toBeCloseTo(1000 * DEFAULT_REINVEST_RATIO, 5)
  })
})

describe('helpers', () => {
  it('monthProgress returns a valid day-of-month window', () => {
    const { daysElapsed, daysInMonth } = monthProgress(new Date('2026-06-20T10:00:00'))
    expect(daysElapsed).toBe(20)
    expect(daysInMonth).toBe(30)
  })
  it('formats money + ratio + runway', () => {
    expect(fmtUsd(769.2307)).toBe('$769.23')
    expect(fmtZmw(20000)).toBe('K20,000')
    expect(fmtRatio(4.273)).toBe('4.3×')
    expect(fmtRatio(null)).toBe('∞')
    expect(fmtRunway(Infinity)).toBe('unbounded')
    expect(fmtRunway(0)).toBe('0 days')
  })
  it('seedTreasuryInputs yields a self-funding preview', () => {
    const seed = seedTreasuryInputs(new Date('2026-06-20T10:00:00'))
    const t = computeTreasury(seed)
    expect(t.revenueZmw).toBeGreaterThan(0)
    expect(t.apiCostUsd).toBeGreaterThan(0)
    expect(t.sustainable).toBe(true)
  })
})
