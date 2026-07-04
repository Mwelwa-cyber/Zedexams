import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// useSubscriptionReminder layers the once-a-day reminder cadence on top of
// resolveSubscriptionStatus (which has its own test). The two promises worth
// pinning: (1) a Pro/Trial user is NEVER eligible for the nudge — upgrading
// silently removes every reminder — and (2) a dismissed popup stays snoozed
// for ~20h, persisted to the profile so "once per day" holds across devices.
//
// useAuth is mocked (Firebase); the real resolveSubscriptionStatus runs.

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

import { useAuth } from '../contexts/AuthContext'
import { useSubscriptionReminder } from './useSubscriptionReminder.js'

const HOUR = 60 * 60 * 1000
const updateProfileFields = vi.fn().mockResolvedValue(undefined)

function setAuth(userProfile, update = updateProfileFields) {
  useAuth.mockReturnValue({ userProfile, updateProfileFields: update })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateProfileFields.mockResolvedValue(undefined)
})

describe('popup eligibility', () => {
  it('is eligible for a free learner who has not snoozed', () => {
    setAuth({ role: 'learner', subscriptionPlan: 'free' })
    const { result } = renderHook(() => useSubscriptionReminder())
    expect(result.current.shouldRemind).toBe(true)
    expect(result.current.isSnoozed).toBe(false)
    expect(result.current.popupEligible).toBe(true)
  })

  it('is NOT eligible for a Pro user — upgrading removes the nudge', () => {
    // premium access flag, no expiry → resolveSubscriptionStatus = Pro,
    // shouldRemind = false.
    setAuth({ role: 'learner', premium: true })
    const { result } = renderHook(() => useSubscriptionReminder())
    expect(result.current.isPro).toBe(true)
    expect(result.current.shouldRemind).toBe(false)
    expect(result.current.popupEligible).toBe(false)
  })

  it('is NOT eligible while a free learner is still snoozed', () => {
    setAuth({
      role: 'learner',
      subscriptionPlan: 'free',
      reminderDismissedUntil: new Date(Date.now() + 5 * HOUR),
    })
    const { result } = renderHook(() => useSubscriptionReminder())
    expect(result.current.shouldRemind).toBe(true)
    expect(result.current.isSnoozed).toBe(true)
    expect(result.current.popupEligible).toBe(false)
  })

  it('becomes eligible again once the snooze window has passed', () => {
    setAuth({
      role: 'learner',
      subscriptionPlan: 'free',
      reminderDismissedUntil: new Date(Date.now() - HOUR),
    })
    const { result } = renderHook(() => useSubscriptionReminder())
    expect(result.current.isSnoozed).toBe(false)
    expect(result.current.popupEligible).toBe(true)
  })
})

describe('dismissedUntil parsing', () => {
  it('reads a Firestore Timestamp-like value via toDate()', () => {
    const when = new Date(Date.now() + 5 * HOUR)
    setAuth({ role: 'learner', subscriptionPlan: 'free', reminderDismissedUntil: { toDate: () => when } })
    const { result } = renderHook(() => useSubscriptionReminder())
    expect(result.current.dismissedUntil).toEqual(when)
    expect(result.current.isSnoozed).toBe(true)
  })

  it('returns null for a missing or unparseable value', () => {
    setAuth({ role: 'learner', subscriptionPlan: 'free', reminderDismissedUntil: 'not-a-date' })
    const { result } = renderHook(() => useSubscriptionReminder())
    expect(result.current.dismissedUntil).toBeNull()
    expect(result.current.isSnoozed).toBe(false)
  })
})

describe('audience override', () => {
  it('resolves teacher status when audience is forced', () => {
    setAuth({ role: 'teacher', teacherPlan: 'free' })
    const { result } = renderHook(() => useSubscriptionReminder({ audience: 'teacher' }))
    expect(result.current.audience).toBe('teacher')
  })
})

describe('snoozeReminders', () => {
  it('writes a ~60h dismissal window plus the shown timestamp', async () => {
    setAuth({ role: 'learner', subscriptionPlan: 'free' })
    const { result } = renderHook(() => useSubscriptionReminder())

    const before = Date.now()
    await result.current.snoozeReminders()
    const after = Date.now()

    expect(updateProfileFields).toHaveBeenCalledTimes(1)
    const fields = updateProfileFields.mock.calls[0][0]
    const until = fields.reminderDismissedUntil.getTime()
    // ~60h (2.5 days) ahead, allowing for the elapsed test time.
    expect(until).toBeGreaterThanOrEqual(before + 60 * HOUR - 1000)
    expect(until).toBeLessThanOrEqual(after + 60 * HOUR + 1000)
    expect(fields.lastPaymentReminderShownAt).toBeInstanceOf(Date)
  })

  it('does not throw if the profile write fails', async () => {
    setAuth({ role: 'learner', subscriptionPlan: 'free' }, vi.fn().mockRejectedValue(new Error('offline')))
    const { result } = renderHook(() => useSubscriptionReminder())
    await expect(result.current.snoozeReminders()).resolves.toBeUndefined()
  })
})

describe('recordReminderShown', () => {
  it('writes only the shown timestamp, not a dismissal window', async () => {
    setAuth({ role: 'learner', subscriptionPlan: 'free' })
    const { result } = renderHook(() => useSubscriptionReminder())

    await result.current.recordReminderShown()

    expect(updateProfileFields).toHaveBeenCalledTimes(1)
    const fields = updateProfileFields.mock.calls[0][0]
    expect(fields.lastPaymentReminderShownAt).toBeInstanceOf(Date)
    expect(fields.reminderDismissedUntil).toBeUndefined()
  })

  it('does not throw if the profile write fails', async () => {
    setAuth({ role: 'learner', subscriptionPlan: 'free' }, vi.fn().mockRejectedValue(new Error('offline')))
    const { result } = renderHook(() => useSubscriptionReminder())
    await expect(result.current.recordReminderShown()).resolves.toBeUndefined()
  })
})
