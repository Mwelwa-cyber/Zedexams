import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  rememberPremiumAction,
  peekPremiumAction,
  consumePremiumAction,
  clearPremiumAction,
} from './pendingPremiumAction'

describe('pendingPremiumAction', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useRealTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('remembers and peeks without clearing', () => {
    rememberPremiumAction({ sourceRoute: '/teacher/generate/worksheet', tool: 'worksheet', reason: 'monthly-limit' })
    expect(peekPremiumAction()).toMatchObject({ sourceRoute: '/teacher/generate/worksheet', tool: 'worksheet' })
    expect(peekPremiumAction()).not.toBeNull() // still there
  })

  it('consume is read-and-clear (honoured exactly once)', () => {
    rememberPremiumAction({ sourceRoute: '/teacher/test-papers/abc/edit' })
    expect(consumePremiumAction()).toMatchObject({ sourceRoute: '/teacher/test-papers/abc/edit' })
    expect(consumePremiumAction()).toBeNull()
  })

  it('ignores actions without a sourceRoute', () => {
    rememberPremiumAction({ tool: 'worksheet' })
    expect(peekPremiumAction()).toBeNull()
  })

  it('expires after the TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T12:00:00Z'))
    rememberPremiumAction({ sourceRoute: '/teacher/generate/notes' })
    vi.setSystemTime(new Date('2026-07-13T12:31:00Z'))
    expect(peekPremiumAction()).toBeNull()
  })

  it('clears explicitly (paywall dismissed without upgrading)', () => {
    rememberPremiumAction({ sourceRoute: '/teacher/generate/rubric' })
    clearPremiumAction()
    expect(peekPremiumAction()).toBeNull()
  })

  it('survives garbage in storage', () => {
    sessionStorage.setItem('zedexams:pending-premium-action', '{not json')
    expect(peekPremiumAction()).toBeNull()
    expect(consumePremiumAction()).toBeNull()
  })
})
