import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLiveReveal } from './useLiveReveal.js'
import { PREP_STEPS } from '../shared/components/liveGenerationSections'

// useLiveReveal is the timing state machine behind every teacher studio's
// Live Generation Canvas: a prep-step walk while generating, then a paced
// section-by-section reveal once the result lands, then complete. A
// regression here either dumps the whole doc at once or hangs on a dead
// spinner. Fake timers drive the intervals deterministically. matchMedia is
// absent by default (so `reduced` stays false); one test stubs it true.

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  delete window.matchMedia
})

describe('useLiveReveal — preparing phase', () => {
  it('walks the prep steps on the prep timer while generating', () => {
    const { result } = renderHook(() =>
      useLiveReveal({ status: 'generating', sectionCount: 0, prepMs: 1000 }),
    )
    expect(result.current.phase).toBe('preparing')
    expect(result.current.prepIndex).toBe(0)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.prepIndex).toBe(1)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.prepIndex).toBe(2)
  })

  it('caps prepIndex at the last prep step', () => {
    const { result } = renderHook(() =>
      useLiveReveal({ status: 'generating', sectionCount: 0, prepMs: 500 }),
    )
    act(() => { vi.advanceTimersByTime(500 * (PREP_STEPS.length + 5)) })
    expect(result.current.prepIndex).toBe(PREP_STEPS.length - 1)
  })
})

describe('useLiveReveal — revealing phase', () => {
  it('reveals sections one at a time on the step timer, then completes', () => {
    const { result } = renderHook(() =>
      useLiveReveal({ status: 'success', sectionCount: 3, stepMs: 200 }),
    )
    // First section pops in immediately (no blank beat).
    expect(result.current.revealedCount).toBe(1)
    expect(result.current.phase).toBe('revealing')
    expect(result.current.complete).toBe(false)

    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current.revealedCount).toBe(2)

    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current.revealedCount).toBe(3)
    expect(result.current.phase).toBe('complete')
    expect(result.current.complete).toBe(true)
  })

  it('does not climb past sectionCount once complete', () => {
    const { result } = renderHook(() =>
      useLiveReveal({ status: 'success', sectionCount: 2, stepMs: 100 }),
    )
    act(() => { vi.advanceTimersByTime(100 * 10) })
    expect(result.current.revealedCount).toBe(2)
  })

  it('treats an empty (zero-section) success as immediately complete', () => {
    const { result } = renderHook(() =>
      useLiveReveal({ status: 'success', sectionCount: 0 }),
    )
    expect(result.current.complete).toBe(true)
    expect(result.current.phase).toBe('complete')
  })
})

describe('useLiveReveal — status transitions', () => {
  it('reports the error phase and clears counters on error', () => {
    const { result, rerender } = renderHook((props) => useLiveReveal(props), {
      initialProps: { status: 'success', sectionCount: 3, stepMs: 100 },
    })
    act(() => { vi.advanceTimersByTime(100) }) // reveal a couple

    rerender({ status: 'error', sectionCount: 3, stepMs: 100 })
    expect(result.current.phase).toBe('error')
    expect(result.current.revealedCount).toBe(0)
  })

  it('resets counters when returning to idle', () => {
    const { result, rerender } = renderHook((props) => useLiveReveal(props), {
      initialProps: { status: 'success', sectionCount: 2, stepMs: 100 },
    })
    act(() => { vi.advanceTimersByTime(100) })
    rerender({ status: 'idle', sectionCount: 2, stepMs: 100 })
    expect(result.current.phase).toBe('idle')
    expect(result.current.revealedCount).toBe(0)
    expect(result.current.prepIndex).toBe(0)
  })
})

describe('useLiveReveal — reduced motion', () => {
  it('reveals everything at once and jumps prep to the end', () => {
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const { result } = renderHook(() =>
      useLiveReveal({ status: 'success', sectionCount: 5, stepMs: 200 }),
    )
    // No timer advance — reduced motion shows all sections immediately.
    expect(result.current.revealedCount).toBe(5)
    expect(result.current.complete).toBe(true)
  })
})
