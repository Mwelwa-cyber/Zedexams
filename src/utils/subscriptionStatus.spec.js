import { describe, expect, it } from 'vitest'
import {
  SUB_STATUS,
  AUDIENCE,
  audienceForProfile,
  resolveSubscriptionStatus,
  reminderCopy,
} from './subscriptionStatus'

// subscriptionStatus.js is the single source of truth for the four reminder
// states (Free / Trial / Pro / Expired) across both audiences. The gating
// rule that matters most for revenue + UX is `shouldRemind`: reminders show
// ONLY for Free and Expired, and disappear the moment a user is Pro/Trial.
// A stable injectable clock keeps every case deterministic.

const NOW = new Date('2026-07-05T12:00:00Z')
const future = new Date('2026-08-05T12:00:00Z')
const past = new Date('2026-06-05T12:00:00Z')
const at = (profile, audience) =>
  resolveSubscriptionStatus(profile, { now: NOW, audience })

describe('audienceForProfile', () => {
  it('maps teachers to the teacher audience', () => {
    expect(audienceForProfile({ role: 'teacher' })).toBe(AUDIENCE.TEACHER)
  })

  it('maps everyone else (learner, parent, admin, null) to learner', () => {
    expect(audienceForProfile({ role: 'learner' })).toBe(AUDIENCE.LEARNER)
    expect(audienceForProfile({ role: 'parent' })).toBe(AUDIENCE.LEARNER)
    expect(audienceForProfile({ role: 'admin' })).toBe(AUDIENCE.LEARNER)
    expect(audienceForProfile(null)).toBe(AUDIENCE.LEARNER)
  })
})

describe('resolveSubscriptionStatus — learner audience', () => {
  it('a bare learner is Free and gets reminders', () => {
    const s = at({ role: 'learner' }, AUDIENCE.LEARNER)
    expect(s.status).toBe(SUB_STATUS.FREE)
    expect(s.isFree).toBe(true)
    expect(s.shouldRemind).toBe(true)
    expect(s.planLabel).toBe('Free')
  })

  it('an active premium learner is Pro and is NOT reminded', () => {
    const s = at(
      { role: 'learner', isPremium: true, subscriptionPlan: 'pro_monthly', subscriptionExpiry: future },
      AUDIENCE.LEARNER,
    )
    expect(s.status).toBe(SUB_STATUS.PRO)
    expect(s.isPro).toBe(true)
    expect(s.shouldRemind).toBe(false)
    expect(s.planLabel).toBe('Pro')
    expect(s.daysLeft).toBeGreaterThan(0)
  })

  it('a lapsed learner (expiry in the past) is Expired and reminded', () => {
    const s = at(
      { role: 'learner', premium: true, subscriptionPlan: 'pro_monthly', subscriptionExpiry: past },
      AUDIENCE.LEARNER,
    )
    expect(s.status).toBe(SUB_STATUS.EXPIRED)
    expect(s.isExpired).toBe(true)
    expect(s.shouldRemind).toBe(true)
  })

  it('a learner on trial is Trial and NOT reminded', () => {
    const s = at(
      { role: 'learner', subscriptionStatus: 'trial', trialEndsAt: future },
      AUDIENCE.LEARNER,
    )
    expect(s.status).toBe(SUB_STATUS.TRIAL)
    expect(s.isTrial).toBe(true)
    expect(s.shouldRemind).toBe(false)
  })

  it('super admins are always Pro (admin plan), never reminded', () => {
    const s = at({ role: 'admin' }, AUDIENCE.LEARNER)
    expect(s.status).toBe(SUB_STATUS.PRO)
    expect(s.planType).toBe('admin')
    expect(s.shouldRemind).toBe(false)
  })

  it('surfaces learner benefits + locked tagline', () => {
    const s = at({ role: 'learner' }, AUDIENCE.LEARNER)
    expect(s.benefits.length).toBeGreaterThan(0)
    expect(s.lockedTagline).toMatch(/past papers/i)
  })
})

describe('resolveSubscriptionStatus — teacher audience', () => {
  it('a bare teacher is Free and reminded', () => {
    const s = at({ role: 'teacher' }, AUDIENCE.TEACHER)
    expect(s.status).toBe(SUB_STATUS.FREE)
    expect(s.shouldRemind).toBe(true)
    expect(s.benefits.some((b) => /lesson plan/i.test(b))).toBe(true)
  })

  it('an active teacher pro plan is Pro and NOT reminded', () => {
    const s = at(
      { role: 'teacher', teacherPlan: 'pro', teacherPlanExpiresAt: future },
      AUDIENCE.TEACHER,
    )
    expect(s.status).toBe(SUB_STATUS.PRO)
    expect(s.shouldRemind).toBe(false)
  })

  it('a lapsed teacher plan is Expired and reminded', () => {
    const s = at(
      { role: 'teacher', teacherPlan: 'pro', teacherPlanExpiresAt: past },
      AUDIENCE.TEACHER,
    )
    expect(s.status).toBe(SUB_STATUS.EXPIRED)
    expect(s.shouldRemind).toBe(true)
  })
})

describe('reminderCopy', () => {
  it('uses renew wording + expired tone for the Expired state', () => {
    const copy = reminderCopy(SUB_STATUS.EXPIRED, AUDIENCE.LEARNER)
    expect(copy.tone).toBe('expired')
    expect(copy.cta).toMatch(/renew/i)
  })

  it('uses upgrade wording for the Free state', () => {
    const copy = reminderCopy(SUB_STATUS.FREE, AUDIENCE.LEARNER)
    expect(copy.tone).toBe('free')
    expect(copy.cta).toMatch(/upgrade/i)
  })

  it('speaks teacher-specific copy for the teacher audience', () => {
    const copy = reminderCopy(SUB_STATUS.FREE, AUDIENCE.TEACHER)
    expect(copy.body).toMatch(/lesson plan/i)
  })
})
