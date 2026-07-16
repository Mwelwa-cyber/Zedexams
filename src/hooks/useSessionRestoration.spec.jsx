import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionRestoration } from './useSessionRestoration.js'

const USER = { uid: 'u1', getIdToken: vi.fn() }
const PROFILE = { id: 'u1', role: 'teacher' }

function setOnline(value) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true, writable: true })
}

describe('useSessionRestoration', () => {
  beforeEach(() => {
    setOnline(true)
    vi.useRealTimers()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('derives restoring-auth while no user is resolved', () => {
    const { result } = renderHook(() =>
      useSessionRestoration({ currentUser: null, userProfile: null, retry: vi.fn() }),
    )
    expect(result.current.stage).toBe('restoring-auth')
  })

  it('advances to loading-profile only once a user exists', () => {
    const { result } = renderHook(() =>
      useSessionRestoration({ currentUser: USER, userProfile: null, retry: vi.fn() }),
    )
    expect(result.current.stage).toBe('loading-profile')
  })

  it('advances to loading-dashboard once the profile has resolved', () => {
    const { result } = renderHook(() =>
      useSessionRestoration({ currentUser: USER, userProfile: PROFILE, retry: vi.fn() }),
    )
    expect(result.current.stage).toBe('loading-dashboard')
  })

  it('surfaces error on a profile-fetch failure', () => {
    const { result } = renderHook(() =>
      useSessionRestoration({ currentUser: USER, userProfile: null, profileIssue: 'unreadable', retry: vi.fn() }),
    )
    expect(result.current.stage).toBe('error')
  })

  it('honours a forced working stage', () => {
    const { result } = renderHook(() =>
      useSessionRestoration({ currentUser: USER, userProfile: null, retry: vi.fn(), forcedStage: 'loading-dashboard' }),
    )
    expect(result.current.stage).toBe('loading-dashboard')
  })

  it('reports offline when the browser starts offline', () => {
    setOnline(false)
    const { result } = renderHook(() =>
      useSessionRestoration({ currentUser: null, userProfile: null, retry: vi.fn() }),
    )
    expect(result.current.stage).toBe('offline')
    expect(result.current.isOffline).toBe(true)
  })

  it('flips to offline on the browser offline event and back on online', () => {
    const retry = vi.fn().mockResolvedValue()
    const { result } = renderHook(() =>
      useSessionRestoration({ currentUser: USER, userProfile: null, retry }),
    )
    expect(result.current.stage).toBe('loading-profile')

    act(() => { setOnline(false); window.dispatchEvent(new Event('offline')) })
    expect(result.current.stage).toBe('offline')

    // Connection restored → auto-retry exactly once.
    act(() => { setOnline(true); window.dispatchEvent(new Event('online')) })
    expect(result.current.isOffline).toBe(false)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('shows timeout after the configured window while still working', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useSessionRestoration({ currentUser: USER, userProfile: null, retry: vi.fn(), timeoutMs: 10_000 }),
    )
    expect(result.current.stage).toBe('loading-profile')
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(result.current.stage).toBe('timeout')
    vi.useRealTimers()
  })

  it('re-arms (clears) the timeout when the working stage advances', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ profile }) => useSessionRestoration({ currentUser: USER, userProfile: profile, retry: vi.fn(), timeoutMs: 10_000 }),
      { initialProps: { profile: null } },
    )
    act(() => { vi.advanceTimersByTime(9_000) })
    expect(result.current.stage).toBe('loading-profile')
    // Real progress (profile arrives) resets the watchdog.
    rerender({ profile: PROFILE })
    act(() => { vi.advanceTimersByTime(9_000) })
    expect(result.current.stage).toBe('loading-dashboard')
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(result.current.stage).toBe('timeout')
    vi.useRealTimers()
  })

  it('runs the retry callback and toggles the retrying flag', async () => {
    let resolveRetry
    const retry = vi.fn(() => new Promise((r) => { resolveRetry = r }))
    const { result } = renderHook(() =>
      useSessionRestoration({ currentUser: USER, userProfile: null, retry }),
    )
    await act(async () => { result.current.onRetry() })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(result.current.retrying).toBe(true)
    await act(async () => { resolveRetry(); await Promise.resolve() })
    expect(result.current.retrying).toBe(false)
  })

  it('prevents duplicate simultaneous retry requests', async () => {
    let resolveRetry
    const retry = vi.fn(() => new Promise((r) => { resolveRetry = r }))
    const { result } = renderHook(() =>
      useSessionRestoration({ currentUser: USER, userProfile: null, retry }),
    )
    await act(async () => {
      result.current.onRetry()
      result.current.onRetry()
      result.current.onRetry()
    })
    // Only the first went through; the others were dropped by the in-flight guard.
    expect(retry).toHaveBeenCalledTimes(1)
    await act(async () => { resolveRetry(); await Promise.resolve() })
  })

  it('does not call Firebase on a manual retry while offline', async () => {
    setOnline(false)
    const retry = vi.fn().mockResolvedValue()
    const { result } = renderHook(() =>
      useSessionRestoration({ currentUser: USER, userProfile: null, retry }),
    )
    await act(async () => { result.current.onRetry() })
    expect(retry).not.toHaveBeenCalled()
  })

  it('cleans up its timeout on unmount (no state update after teardown)', () => {
    vi.useFakeTimers()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = renderHook(() =>
      useSessionRestoration({ currentUser: USER, userProfile: null, retry: vi.fn(), timeoutMs: 10_000 }),
    )
    unmount()
    act(() => { vi.advanceTimersByTime(20_000) })
    // React would warn on a post-unmount setState; none should be logged.
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
    vi.useRealTimers()
  })
})
