import { describe, it, expect } from 'vitest'
import { claimReminderHost, isReminderHostClaimed, subscribeReminderHost } from './reminderHost'

describe('reminderHost', () => {
  it('is unclaimed until something claims it, and released again after', () => {
    expect(isReminderHostClaimed()).toBe(false)
    const release = claimReminderHost()
    expect(isReminderHostClaimed()).toBe(true)
    release()
    expect(isReminderHostClaimed()).toBe(false)
  })

  it('is a counter: one shell unmounting cannot release another shell\'s claim', () => {
    const a = claimReminderHost()
    const b = claimReminderHost()
    a()
    expect(isReminderHostClaimed()).toBe(true)
    b()
    expect(isReminderHostClaimed()).toBe(false)
  })

  it('release is idempotent — a double release cannot go negative or steal a claim', () => {
    const a = claimReminderHost()
    const b = claimReminderHost()
    a(); a()
    expect(isReminderHostClaimed()).toBe(true)
    b()
    expect(isReminderHostClaimed()).toBe(false)
  })

  it('tells subscribers when the claim changes, and stops after unsubscribe', () => {
    let calls = 0
    const off = subscribeReminderHost(() => { calls += 1 })
    const release = claimReminderHost()
    release()
    expect(calls).toBe(2)
    off()
    claimReminderHost()()
    expect(calls).toBe(2)
  })
})
