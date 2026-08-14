import { describe, expect, it } from 'vitest'
import { isReminderSuppressedPath } from './reminderVisibility'

describe('isReminderSuppressedPath', () => {
  it('returns false for an empty / missing path', () => {
    expect(isReminderSuppressedPath('')).toBe(false)
    expect(isReminderSuppressedPath(null)).toBe(false)
    expect(isReminderSuppressedPath(undefined)).toBe(false)
  })

  it('suppresses marketing / auth / legal exact paths', () => {
    for (const p of ['/', '/welcome', '/login', '/register', '/auth/action',
      '/pricing', '/plans', '/teachers', '/privacy', '/terms', '/status',
      '/blog', '/my-subscription']) {
      expect(isReminderSuppressedPath(p)).toBe(true)
    }
  })

  it('suppresses immersive runners and public viewers by prefix', () => {
    expect(isReminderSuppressedPath('/quiz/abc123')).toBe(true)
    expect(isReminderSuppressedPath('/exam/daily/2026-06-19')).toBe(true)
    expect(isReminderSuppressedPath('/exam-results/xyz')).toBe(true)
    expect(isReminderSuppressedPath('/games/play/timed')).toBe(true)
    expect(isReminderSuppressedPath('/papers/grade-7/maths')).toBe(true)
    expect(isReminderSuppressedPath('/parent/child-1')).toBe(true)
    expect(isReminderSuppressedPath('/share/quiz-1')).toBe(true)
    expect(isReminderSuppressedPath('/grade-7')).toBe(true)
    expect(isReminderSuppressedPath('/blog/study-tips')).toBe(true)
    expect(isReminderSuppressedPath('/teacher/welcome-to-pro')).toBe(true)
  })

  it('does NOT suppress the dashboards and authoring surfaces (reminders belong there)', () => {
    expect(isReminderSuppressedPath('/dashboard')).toBe(false)
    expect(isReminderSuppressedPath('/teacher')).toBe(false)
    expect(isReminderSuppressedPath('/teacher/lesson-plan')).toBe(false)
    expect(isReminderSuppressedPath('/admin')).toBe(false)
    expect(isReminderSuppressedPath('/my-results')).toBe(false)
  })

  it('does not over-match the /games hub (only /games/play is suppressed)', () => {
    expect(isReminderSuppressedPath('/games')).toBe(false)
    expect(isReminderSuppressedPath('/games/play')).toBe(true)
  })
})
