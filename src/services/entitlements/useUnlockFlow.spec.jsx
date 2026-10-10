/**
 * useUnlockFlow — where a tapped lock goes.
 *
 * Everyone checks out. An under-18 learner on the web enters a parent's
 * mobile-money number; in the Android build every learner reaches Google Play's
 * own purchase sheet. There is no guardian-ask route any more.
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
  it('sends every learner to the checkout, on either platform', () => {
    for (const state of [ADULT, MINOR, null]) {
      for (const opts of [undefined, { native: false }, { native: true }]) {
        expect(resolveUnlockRoute(state, opts)).toBe(UNLOCK_ROUTE.CHECKOUT)
      }
    }
  })

  it('has no guardian route', () => {
    expect(UNLOCK_ROUTE.GUARDIAN).toBeUndefined()
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

  it('an Android-build minor gets the same checkout route', () => {
    mockNative = true
    const { result } = renderHook(() => useUnlockFlow())
    expect(result.current.route).toBe(UNLOCK_ROUTE.CHECKOUT)
    expect(result.current.isUnder18).toBe(true)
  })

  it('an adult is priced and is not under 18', () => {
    mockPlanState = ADULT
    const { result } = renderHook(() => useUnlockFlow())
    expect(result.current.showsPrice).toBe(true)
    expect(result.current.isUnder18).toBe(false)
  })
})
