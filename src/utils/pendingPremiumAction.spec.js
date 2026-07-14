import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  rememberPremiumAction,
  peekPremiumAction,
  consumePremiumAction,
  clearPremiumAction,
  markPremiumActionPaid,
  readPremiumActionState,
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

  it('markPremiumActionPaid stamps the record and keeps it for the studio card', () => {
    rememberPremiumAction({ sourceRoute: '/teacher/generate/worksheet', tool: 'worksheet', uid: 'u1' })
    const paid = markPremiumActionPaid()
    expect(paid).toMatchObject({ status: 'paid', tool: 'worksheet', uid: 'u1' })
    expect(peekPremiumAction()).toMatchObject({ status: 'paid' })
    expect(readPremiumActionState()).toMatchObject({ expired: false, action: { status: 'paid' } })
  })

  it('paid records go stale after the paid window (no day-old auto-continues)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T12:00:00Z'))
    rememberPremiumAction({ sourceRoute: '/teacher/generate/worksheet' })
    markPremiumActionPaid()
    vi.setSystemTime(new Date('2026-07-14T12:16:00Z'))
    expect(peekPremiumAction()).toBeNull()
    // The card can still tell the difference and show the expired message.
    expect(readPremiumActionState()).toMatchObject({ expired: true })
  })

  it('readPremiumActionState returns null when there is nothing stored', () => {
    expect(readPremiumActionState()).toBeNull()
  })

  it('never stores payment data — only navigation context', () => {
    rememberPremiumAction({ sourceRoute: '/teacher/generate/worksheet', tool: 'worksheet', uid: 'u1', reason: 'monthly-limit', feature: 'worksheets' })
    markPremiumActionPaid()
    const raw = JSON.parse(sessionStorage.getItem('zedexams:pending-premium-action'))
    const allowed = ['sourceRoute', 'tool', 'uid', 'reason', 'feature', 'savedAt', 'status', 'paidAt']
    expect(Object.keys(raw).every((k) => allowed.includes(k))).toBe(true)
    // No phone-number-like digit runs in any stored string (timestamps are
    // numeric fields, not strings).
    const stringValues = Object.values(raw).filter((v) => typeof v === 'string')
    expect(stringValues.some((v) => /\d{9,}/.test(v))).toBe(false)
  })
})
