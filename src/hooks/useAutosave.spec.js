import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutosave } from './useAutosave.js'

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

async function flushMicrotasks() {
  // let pending promise .then/.catch chains settle under fake timers
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('useAutosave', () => {
  it('does not save on every keystroke, only after the pause', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave({ key: 'doc-1', save, delay: 800 }))

    act(() => { result.current.scheduleSave({ title: 'h' }) })
    act(() => { result.current.scheduleSave({ title: 'he' }) })
    act(() => { result.current.scheduleSave({ title: 'hel' }) })
    expect(save).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(800) })
    await flushMicrotasks()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saves the latest draft, not an intermediate one', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave({ key: 'doc-1', save, delay: 500 }))

    act(() => { result.current.scheduleSave({ title: 'a' }) })
    act(() => { result.current.scheduleSave({ title: 'ab' }) })
    act(() => { vi.advanceTimersByTime(500) })
    await flushMicrotasks()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ title: 'ab' }, expect.anything())
  })

  it('cancels the pending save when the document key changes', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook(
      ({ key }) => useAutosave({ key, save, delay: 500 }),
      { initialProps: { key: 'doc-1' } },
    )
    act(() => { result.current.scheduleSave({ title: 'a' }) })
    rerender({ key: 'doc-2' })
    act(() => { vi.advanceTimersByTime(500) })
    await flushMicrotasks()
    expect(save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('flushes the pending save immediately when saveNow is called', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave({ key: 'doc-1', save, delay: 5000 }))

    act(() => { result.current.scheduleSave({ title: 'a' }) })
    await act(async () => { await result.current.saveNow() })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('reports waiting -> saving -> saved status transitions', async () => {
    let resolveSave
    const save = vi.fn(() => new Promise((resolve) => { resolveSave = resolve }))
    const { result } = renderHook(() => useAutosave({ key: 'doc-1', save, delay: 100 }))

    act(() => { result.current.scheduleSave({ title: 'a' }) })
    expect(result.current.status).toBe('waiting')

    act(() => { vi.advanceTimersByTime(100) })
    await flushMicrotasks()
    expect(result.current.status).toBe('saving')

    await act(async () => { resolveSave(); await Promise.resolve() })
    expect(result.current.status).toBe('saved')
  })

  it('keeps unsaved changes in local storage after a save failure and reports error', async () => {
    const save = vi.fn().mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() =>
      useAutosave({ key: 'doc-1', save, delay: 100, maxRetries: 0, storageKey: 'autosave-test' }),
    )
    act(() => { result.current.scheduleSave({ title: 'a' }) })
    act(() => { vi.advanceTimersByTime(100) })
    await flushMicrotasks()

    expect(result.current.status).toBe('error')
    expect(JSON.parse(localStorage.getItem('autosave-test')).draft).toEqual({ title: 'a' })
  })

  it('does not overwrite with a stale save when the key changed mid-flight', async () => {
    let resolveSave
    const save = vi.fn(() => new Promise((resolve) => { resolveSave = resolve }))
    const { result, rerender } = renderHook(
      ({ key }) => useAutosave({ key, save, delay: 100 }),
      { initialProps: { key: 'doc-1' } },
    )
    act(() => { result.current.scheduleSave({ title: 'a' }) })
    act(() => { vi.advanceTimersByTime(100) })
    await flushMicrotasks()
    expect(result.current.status).toBe('saving')

    rerender({ key: 'doc-2' })
    await act(async () => { resolveSave(); await Promise.resolve() })
    // Resolving the doc-1 save after switching to doc-2 must not mark doc-2 as saved.
    expect(result.current.status).toBe('idle')
  })

  it('surfaces conflict status when save rejects with a conflict error', async () => {
    const err = new Error('stale revision')
    err.code = 'conflict'
    const save = vi.fn().mockRejectedValue(err)
    const { result } = renderHook(() => useAutosave({ key: 'doc-1', save, delay: 100 }))

    act(() => { result.current.scheduleSave({ title: 'a' }) })
    act(() => { vi.advanceTimersByTime(100) })
    await flushMicrotasks()
    expect(result.current.status).toBe('conflict')
  })

  it('goes offline instead of attempting a save when the network is down', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave({ key: 'doc-1', save, delay: 100 }))

    act(() => { result.current.scheduleSave({ title: 'a' }) })
    expect(result.current.status).toBe('offline')
    act(() => { vi.advanceTimersByTime(100) })
    expect(save).not.toHaveBeenCalled()
  })
})
