import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedCallback } from './useDebouncedCallback.js'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedCallback', () => {
  it('executes only once after multiple rapid calls', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 300))

    act(() => {
      result.current.run(1)
      result.current.run(2)
      result.current.run(3)
    })
    expect(fn).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(300) })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('uses the latest arguments from the burst', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 300))

    act(() => {
      result.current.run('first')
      result.current.run('second')
      result.current.run('third')
    })
    act(() => { vi.advanceTimersByTime(300) })
    expect(fn).toHaveBeenCalledWith('third')
  })

  it('supports cancel', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 300))

    act(() => { result.current.run('x') })
    act(() => { result.current.cancel() })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(fn).not.toHaveBeenCalled()
  })

  it('supports flush to run immediately', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 300))

    act(() => { result.current.run('x') })
    act(() => { result.current.flush() })
    expect(fn).toHaveBeenCalledWith('x')

    // The pending timer should not fire again after flush.
    act(() => { vi.advanceTimersByTime(300) })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not execute after unmount', () => {
    const fn = vi.fn()
    const { result, unmount } = renderHook(() => useDebouncedCallback(fn, 300))

    act(() => { result.current.run('x') })
    unmount()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(fn).not.toHaveBeenCalled()
  })

  it('preserves the latest callback across re-renders (avoids stale closures)', () => {
    let seen = null
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedCallback(() => { seen = value }, 300),
      { initialProps: { value: 'old' } },
    )
    rerender({ value: 'new' })
    act(() => { result.current.run() })
    act(() => { vi.advanceTimersByTime(300) })
    expect(seen).toBe('new')
  })

  it('reports isPending while a call is scheduled', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 300))

    expect(result.current.isPending()).toBe(false)
    act(() => { result.current.run('x') })
    expect(result.current.isPending()).toBe(true)
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current.isPending()).toBe(false)
  })

  it('supports a leading call in addition to the trailing one', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 300, { leading: true }))

    act(() => { result.current.run('a') })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('a')

    act(() => { result.current.run('b') })
    expect(fn).toHaveBeenCalledTimes(1) // still mid-burst, no second leading call

    act(() => { vi.advanceTimersByTime(300) })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('b')
  })
})
