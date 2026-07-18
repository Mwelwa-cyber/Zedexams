import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRequestLock } from './useRequestLock.js'

describe('useRequestLock', () => {
  it('a double-click only sends one request', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const { result } = renderHook(() => useRequestLock())

    let p1, p2
    act(() => {
      p1 = result.current.run(fn)
      p2 = result.current.run(fn) // fired while the first is still in flight
    })
    await act(async () => { await Promise.all([p1, p2]) })

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('locks isLocked while processing and unlocks on success', async () => {
    let resolveFn
    const fn = vi.fn(() => new Promise((resolve) => { resolveFn = resolve }))
    const { result } = renderHook(() => useRequestLock())

    let promise
    act(() => { promise = result.current.run(fn) })
    expect(result.current.isLocked).toBe(true)

    await act(async () => { resolveFn('done'); await promise })
    expect(result.current.isLocked).toBe(false)
  })

  it('unlocks on failure too', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useRequestLock())

    await act(async () => {
      await expect(result.current.run(fn)).rejects.toThrow('boom')
    })
    expect(result.current.isLocked).toBe(false)
  })

  it('passes a fresh request id to each accepted call', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const { result } = renderHook(() => useRequestLock())

    await act(async () => { await result.current.run(fn) })
    await act(async () => { await result.current.run(fn) })

    const [firstId] = fn.mock.calls[0]
    const [secondId] = fn.mock.calls[1]
    expect(firstId).not.toBe(secondId)
  })

  it('a re-render does not resend an in-flight request', async () => {
    let resolveFn
    const fn = vi.fn(() => new Promise((resolve) => { resolveFn = resolve }))
    const { result, rerender } = renderHook(() => useRequestLock())

    let promise
    act(() => { promise = result.current.run(fn) })
    rerender()
    rerender()
    expect(fn).toHaveBeenCalledTimes(1)

    await act(async () => { resolveFn('done'); await promise })
  })
})
