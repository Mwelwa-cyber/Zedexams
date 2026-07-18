import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue.js'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedValue', () => {
  it('returns the original value initially', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 300))
    expect(result.current).toBe('a')
  })

  it('updates after the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'ab' })
    expect(result.current).toBe('a') // not yet — still debouncing

    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe('a')

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe('ab')
  })

  it('resets the timer when the input changes again mid-debounce', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'ab' })
    act(() => { vi.advanceTimersByTime(200) })
    rerender({ value: 'abc' })
    act(() => { vi.advanceTimersByTime(200) })
    // Only 200ms since the last change ("abc") — timer should have restarted.
    expect(result.current).toBe('a')

    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe('abc')
  })

  it('cleans up its timer on unmount without throwing', () => {
    const { rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'ab' })
    unmount()
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
  })

  it('supports changing the delay between renders', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: 'a', delay: 300 } },
    )
    rerender({ value: 'ab', delay: 50 })
    act(() => { vi.advanceTimersByTime(50) })
    expect(result.current).toBe('ab')
  })
})
