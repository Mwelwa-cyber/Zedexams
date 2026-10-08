/**
 * useUnlockFlow — where a tapped lock goes, per platform.
 *
 * The rule: an adult checks out. An under-18 learner checks out too on the web
 * (the checkout asks for a parent's mobile-money number), and is routed to the
 * guardian ask only inside the Android build, where Play's Families policy
 * governs the listing. Anything that does not say which platform it is on
 * fails towards the guardian ask, never towards a price.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

let mockNative = false
vi.mock('../../utils/runtime', () => ({ isNativePlatform: () => mockNative }))
vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))

let mockPlanState
vi.mock('./useEntitlements', () => ({
  useEntitlements: () => ({ planState: mockPlanState }),
}))

import { UNLOCK_ROUTE, resolveUnlockRoute, useUnlockFlow } from './useUnlockFlow'

const ADULT = { ageBand: 'adult', status: 'active', role: 'learner' }
const MINOR = { ageBand: 'under18', status: 'active', role: 'learner' }

beforeEach(() => {
  mockNative = false
  mockPlanState = MINOR
})

describe('resolveUnlockRoute', () => {
  it('sends an adult to the checkout on either platform', () => {
    expect(resolveUnlockRoute(ADULT, { native: false })).toBe(UNLOCK_ROUTE.CHECKOUT)
    expect(resolveUnlockRoute(ADULT, { native: true })).toBe(UNLOCK_ROUTE.CHECKOUT)
  })

  it('sends an under-18 learner to the checkout on the web — a parent pays', () => {
    expect(resolveUnlockRoute(MINOR, { native: false })).toBe(UNLOCK_ROUTE.CHECKOUT)
  })

  it('sends an under-18 learner to the guardian ask in the Android build', () => {
    expect(resolveUnlockRoute(MINOR, { native: true })).toBe(UNLOCK_ROUTE.GUARDIAN)
  })

  it('fails towards the guardian ask when the platform is not stated or not a real boolean', () => {
    expect(resolveUnlockRoute(MINOR)).toBe(UNLOCK_ROUTE.GUARDIAN)
    for (const native of [undefined, null, 0, '', 'false']) {
      expect(resolveUnlockRoute(MINOR, { native })).toBe(UNLOCK_ROUTE.GUARDIAN)
    }
  })

  it('treats a missing plan state as an unknown age, not as an adult', () => {
    expect(resolveUnlockRoute(null, { native: false })).toBe(UNLOCK_ROUTE.CHECKOUT)
    expect(resolveUnlockRoute(null, { native: true })).toBe(UNLOCK_ROUTE.GUARDIAN)
  })
})

describe('useUnlockFlow', () => {
  it('reads the real platform: a web minor gets a priced route', () => {
    const { result } = renderHook(() => useUnlockFlow())
    expect(result.current.route).toBe(UNLOCK_ROUTE.CHECKOUT)
    expect(result.current.showsPrice).toBe(true)
    // Still under 18 — pricing and being a minor are different questions.
    expect(result.current.isUnder18).toBe(true)
  })

  it('an Android-build minor gets the guardian ask and no price', () => {
    mockNative = true
    const { result } = renderHook(() => useUnlockFlow())
    expect(result.current.route).toBe(UNLOCK_ROUTE.GUARDIAN)
    expect(result.current.showsPrice).toBe(false)
    expect(result.current.isUnder18).toBe(true)
  })

  it('an adult is priced and is not under 18', () => {
    mockPlanState = ADULT
    const { result } = renderHook(() => useUnlockFlow())
    expect(result.current.showsPrice).toBe(true)
    expect(result.current.isUnder18).toBe(false)
  })
})
