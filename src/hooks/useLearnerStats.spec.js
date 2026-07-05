import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// useLearnerStats subscribes to the learner's gamification doc and exposes
// live stats + a level derived from xp, with safe defaults before the first
// snapshot. The subtle bits are the no-uid short-circuit, wiring the snapshot
// into state, deriving the level, and unsubscribing on cleanup. The
// gamificationService (Firestore-backed) is mocked.

const subscribeToLearnerStats = vi.fn()
const levelFromXp = vi.fn((xp) => ({ level: Math.floor((xp || 0) / 100) + 1 }))

vi.mock('../utils/gamificationService', () => ({
  subscribeToLearnerStats: (...a) => subscribeToLearnerStats(...a),
  levelFromXp: (...a) => levelFromXp(...a),
}))

import useLearnerStats from './useLearnerStats.js'

beforeEach(() => {
  subscribeToLearnerStats.mockReset()
  levelFromXp.mockClear()
})

describe('useLearnerStats', () => {
  it('short-circuits with defaults and no subscription when there is no uid', () => {
    const { result } = renderHook(() => useLearnerStats(null))
    expect(result.current.stats).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(subscribeToLearnerStats).not.toHaveBeenCalled()
    // level is still derived from xp=0
    expect(levelFromXp).toHaveBeenCalledWith(0)
  })

  it('subscribes for a uid and starts in a loading state', () => {
    subscribeToLearnerStats.mockReturnValue(() => {})
    const { result } = renderHook(() => useLearnerStats('u1'))
    expect(subscribeToLearnerStats).toHaveBeenCalledWith('u1', expect.any(Function))
    expect(result.current.loading).toBe(true)
  })

  it('pushes a snapshot into stats, clears loading, and derives the level', () => {
    let emit
    subscribeToLearnerStats.mockImplementation((_uid, cb) => { emit = cb; return () => {} })
    const { result } = renderHook(() => useLearnerStats('u1'))

    act(() => { emit({ xp: 250 }) })
    expect(result.current.stats).toEqual({ xp: 250 })
    expect(result.current.loading).toBe(false)
    expect(levelFromXp).toHaveBeenCalledWith(250)
    expect(result.current.level).toEqual({ level: 3 })
  })

  it('unsubscribes on unmount', () => {
    const unsub = vi.fn()
    subscribeToLearnerStats.mockReturnValue(unsub)
    const { unmount } = renderHook(() => useLearnerStats('u1'))
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })

  it('resubscribes when the uid changes', () => {
    subscribeToLearnerStats.mockReturnValue(() => {})
    const { rerender } = renderHook(({ uid }) => useLearnerStats(uid), {
      initialProps: { uid: 'u1' },
    })
    rerender({ uid: 'u2' })
    expect(subscribeToLearnerStats).toHaveBeenCalledTimes(2)
    expect(subscribeToLearnerStats).toHaveBeenLastCalledWith('u2', expect.any(Function))
  })
})
