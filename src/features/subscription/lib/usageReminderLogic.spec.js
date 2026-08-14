import { describe, it, expect } from 'vitest'
import { resolveUsageReminder, REMINDER_THRESHOLD } from './usageReminderLogic'

const LABELS = { plans: 'lesson plans', worksheets: 'worksheets' }

function data(overrides = {}) {
  return {
    plan: 'free',
    used: { plans: 0, worksheets: 0 },
    caps: { plans: 2, worksheets: 25 },
    daily: 2,
    today: 0,
    credits: 0,
    resetDays: 9,
    ...overrides,
  }
}

describe('resolveUsageReminder', () => {
  it('stays quiet well below the threshold', () => {
    expect(resolveUsageReminder(data(), { labels: LABELS })).toBeNull()
  })

  it('fires at >=80% of a monthly allowance with the remaining count', () => {
    const r = resolveUsageReminder(
      data({ used: { plans: 0, worksheets: 20 }, caps: { plans: 2, worksheets: 25 }, daily: 10 }),
      { labels: LABELS },
    )
    expect(r).toMatchObject({ kind: 'monthly', scope: 'monthly:worksheets', remaining: 5 })
    expect(r.title).toBe('Almost out of worksheets — 5 left this month')
    expect(r.body).toMatch(/resets in 9 days/)
  })

  it('uses the singular phrasing for exactly one left', () => {
    const r = resolveUsageReminder(
      data({ used: { plans: 1 }, caps: { plans: 2 }, daily: 10 }),
      { labels: LABELS },
    )
    expect(r.title).toBe('Almost out of lesson plans — 1 left this month')
  })

  it('goes quiet AT the limit — the contextual paywall takes over there', () => {
    expect(
      resolveUsageReminder(data({ used: { plans: 2 }, caps: { plans: 2 }, daily: 10 }), { labels: LABELS }),
    ).toBeNull()
  })

  it('falls back to the daily cap when no monthly allowance is near', () => {
    const r = resolveUsageReminder(data({ today: 8, daily: 10 }), { labels: LABELS })
    expect(r).toMatchObject({ kind: 'daily', remaining: 2 })
    const one = resolveUsageReminder(data({ today: 9, daily: 10 }), { labels: LABELS })
    expect(one.title).toBe('1 generation remaining today')
  })

  it('studio variant checks only its own feature before the daily cap', () => {
    const r = resolveUsageReminder(
      data({ used: { plans: 0, worksheets: 20 }, caps: { plans: 2, worksheets: 25 }, daily: 10 }),
      { feature: 'plans', labels: LABELS },
    )
    expect(r).toBeNull() // plans is fine; worksheets is not this studio's concern
  })

  it('dashboard variant picks the most exhausted allowance when several qualify', () => {
    const r = resolveUsageReminder(
      // plans at 80% (4/5), worksheets at 96% (24/25) → worksheets wins.
      data({ used: { plans: 4, worksheets: 24 }, caps: { plans: 5, worksheets: 25 }, daily: 10 }),
      { labels: LABELS },
    )
    expect(r.scope).toBe('monthly:worksheets')
  })

  it('is silent for Max teachers (nothing to upgrade to)', () => {
    expect(
      resolveUsageReminder(data({ plan: 'max', used: { plans: 1 }, caps: { plans: 2 } }), { labels: LABELS }),
    ).toBeNull()
  })

  it('is silent when a top-up credit is available', () => {
    expect(
      resolveUsageReminder(data({ credits: 1, used: { plans: 1 }, caps: { plans: 2 } }), { labels: LABELS }),
    ).toBeNull()
  })

  it('ignores features with no allowance on the plan (cap 0 → locked, not reminded)', () => {
    expect(
      resolveUsageReminder(data({ used: { worksheets: 0 }, caps: { worksheets: 0 }, daily: 10 }), { labels: LABELS }),
    ).toBeNull()
  })

  it('handles missing data safely', () => {
    expect(resolveUsageReminder(null)).toBeNull()
    expect(resolveUsageReminder({})).toBeNull()
  })

  it('threshold is 80%', () => {
    expect(REMINDER_THRESHOLD).toBe(0.8)
  })

  it('fires on "1 left" even when the ratio is under 80% (small caps)', () => {
    // Free plan: 2 lesson plans/month — 1 used is only 50% but IS the last
    // warning opportunity.
    const r = resolveUsageReminder(data({ used: { plans: 1 }, caps: { plans: 2 }, daily: 10 }), { labels: LABELS })
    expect(r).toMatchObject({ scope: 'monthly:plans', remaining: 1 })
  })

  it('never warns before anything has been used (taster caps of 1)', () => {
    expect(
      resolveUsageReminder(data({ used: { plans: 0 }, caps: { plans: 1 }, daily: 10 }), { labels: LABELS }),
    ).toBeNull()
    expect(resolveUsageReminder(data({ today: 0, daily: 1 }), { labels: LABELS })).toBeNull()
  })
})
