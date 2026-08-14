import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// useGenerationStages drives the AI generation progress tracker. The logic
// worth pinning is its lifecycle: it runs an internal elapsed-time ticker when
// there's no live driver, defers to activeStageId when there is one, freezes on
// error, and latches a "finished/all-done" state when a run completes cleanly.
// resolveStages/computeStageStates are mocked so the spec owns the hook's own
// state machine, not the presentation helpers.

const resolveStages = vi.fn(() => ['intro', 'work', 'done'])
let lastArgs = null
const computeStageStates = vi.fn((args) => {
  lastArgs = args
  return { items: args.stages, activeIndex: 0, percent: 0 }
})

vi.mock('../shared/components/aiGenerationStages', () => ({
  resolveStages: (...a) => resolveStages(...a),
  computeStageStates: (...a) => computeStageStates(...a),
}))

import { useGenerationStages } from './useGenerationStages.js'

beforeEach(() => {
  resolveStages.mockClear()
  computeStageStates.mockClear()
  lastArgs = null
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useGenerationStages', () => {
  it('resolves stages once per preset identity and exposes them', () => {
    const { result, rerender } = renderHook(
      ({ preset }) => useGenerationStages({ running: false, preset }),
      { initialProps: { preset: 'quiz' } },
    )
    expect([...result.current.stages]).toEqual(['intro', 'work', 'done'])
    expect(resolveStages).toHaveBeenCalledTimes(1)

    rerender({ preset: 'quiz' }) // same preset → cached
    expect(resolveStages).toHaveBeenCalledTimes(1)

    rerender({ preset: 'lesson' }) // new preset → re-resolve
    expect(resolveStages).toHaveBeenCalledTimes(2)
  })

  it('advances an internal ticker while running with no live driver', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useGenerationStages({ running: true, preset: 'quiz' }))
    expect(result.current.elapsedMs).toBe(0)

    act(() => { vi.advanceTimersByTime(250) })
    expect(result.current.elapsedMs).toBe(250)
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current.elapsedMs).toBe(750)
  })

  it('does NOT tick when a live activeStageId is steering', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const { result } = renderHook(() =>
      useGenerationStages({ running: true, preset: 'quiz', activeStageId: 'work' }))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.elapsedMs).toBe(0)
    // The real phase is forwarded to the presentation helper.
    expect(lastArgs.activeStageId).toBe('work')
    expect(lastArgs.running).toBe(true)
  })

  it('freezes on error: errored set, activeStageId suppressed, no ticker', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const { result } = renderHook(() =>
      useGenerationStages({ running: true, preset: 'quiz', activeStageId: 'work', error: new Error('x') }))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.elapsedMs).toBe(0)
    expect(lastArgs.errored).toBe(true)
    // When errored, the active stage is not advanced past the failure point.
    expect(lastArgs.activeStageId).toBeUndefined()
    expect(lastArgs.finished).toBe(false)
  })

  it('latches finished when a clean run ends', () => {
    const { rerender } = renderHook(
      ({ running }) => useGenerationStages({ running, preset: 'quiz' }),
      { initialProps: { running: true } },
    )
    expect(lastArgs.finished).toBe(false)

    rerender({ running: false }) // ended without error
    expect(lastArgs.finished).toBe(true)
  })

  it('does not latch finished when a run ends in error', () => {
    const { rerender } = renderHook(
      ({ running, error }) => useGenerationStages({ running, preset: 'quiz', error }),
      { initialProps: { running: true, error: new Error('boom') } },
    )
    rerender({ running: false, error: new Error('boom') }) // ended in error
    expect(lastArgs.finished).toBe(false)
  })

  it('reflects prefers-reduced-motion from matchMedia', () => {
    const listeners = []
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: (_e, cb) => listeners.push(cb),
      removeEventListener: () => {},
    }))
    const { result } = renderHook(() => useGenerationStages({ running: false, preset: 'quiz' }))
    expect(result.current.reducedMotion).toBe(true)
    delete window.matchMedia
  })
})
