import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// useQuizDisplayPrefs debounces the Firestore write of a learner's reading
// prefs (text size, theme, spacing…) so dragging through several settings in
// a row doesn't fire one profile write per click. This spec pins that the
// refactor onto the shared useDebouncedCallback preserved the original
// hand-rolled timer's behaviour: local state + cache update immediately,
// the network write coalesces after WRITE_DEBOUNCE_MS (600ms).

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

import { useAuth } from '../contexts/AuthContext'
import { useQuizDisplayPrefs } from './useQuizDisplayPrefs.js'
import { QUIZ_DISPLAY_STORAGE_KEY, DEFAULT_QUIZ_DISPLAY } from '../utils/quizDisplayPrefs'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

function setAuth(overrides = {}) {
  useAuth.mockReturnValue({
    currentUser: { uid: 'u1' },
    userProfile: null,
    updateProfileFields: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  })
}

describe('useQuizDisplayPrefs', () => {
  it('updates local prefs immediately without waiting for the debounce', () => {
    setAuth()
    const { result } = renderHook(() => useQuizDisplayPrefs())
    act(() => { result.current.setPref('textSize', 'large') })
    expect(result.current.prefs.textSize).toBe('large')
  })

  it('does not write to Firestore on every change, only after the pause', async () => {
    const updateProfileFields = vi.fn().mockResolvedValue(undefined)
    setAuth({ updateProfileFields })
    const { result } = renderHook(() => useQuizDisplayPrefs())

    act(() => { result.current.setPref('textSize', 'large') })
    act(() => { result.current.setPref('textSize', 'xlarge') })
    act(() => { result.current.setPref('lineSpacing', 'wide') })
    expect(updateProfileFields).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(600) })
    expect(updateProfileFields).toHaveBeenCalledTimes(1)
    expect(updateProfileFields).toHaveBeenCalledWith({
      quizDisplayPrefs: expect.objectContaining({ textSize: 'xlarge', lineSpacing: 'wide' }),
    })
  })

  it('caches to localStorage synchronously on every change (not debounced)', () => {
    setAuth()
    const { result } = renderHook(() => useQuizDisplayPrefs())
    act(() => { result.current.setPref('theme', 'dark') })
    const cached = JSON.parse(localStorage.getItem(QUIZ_DISPLAY_STORAGE_KEY))
    expect(cached.theme).toBe('dark')
  })

  it('flips saving true while the debounced write is pending, false once it resolves', async () => {
    let resolveWrite
    const updateProfileFields = vi.fn(() => new Promise((resolve) => { resolveWrite = resolve }))
    setAuth({ updateProfileFields })
    const { result } = renderHook(() => useQuizDisplayPrefs())

    act(() => { result.current.setPref('theme', 'dark') })
    expect(result.current.saving).toBe(true)

    await act(async () => { vi.advanceTimersByTime(600) })
    expect(updateProfileFields).toHaveBeenCalledTimes(1)
    expect(result.current.saving).toBe(true)

    await act(async () => { resolveWrite(); await Promise.resolve() })
    expect(result.current.saving).toBe(false)
  })

  it('does not throw when the write fails (offline) and keeps the local value', async () => {
    const updateProfileFields = vi.fn().mockRejectedValue(new Error('offline'))
    setAuth({ updateProfileFields })
    const { result } = renderHook(() => useQuizDisplayPrefs())

    act(() => { result.current.setPref('theme', 'sepia') })
    await act(async () => { vi.advanceTimersByTime(600); await Promise.resolve() })

    expect(result.current.prefs.theme).toBe('sepia')
    expect(result.current.saving).toBe(false)
  })

  it('does not schedule a write for a signed-out learner', async () => {
    const updateProfileFields = vi.fn()
    setAuth({ currentUser: null, updateProfileFields })
    const { result } = renderHook(() => useQuizDisplayPrefs())

    act(() => { result.current.setPref('theme', 'dark') })
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(updateProfileFields).not.toHaveBeenCalled()
  })

  it('resetPrefs restores defaults locally and schedules a debounced write', async () => {
    const updateProfileFields = vi.fn().mockResolvedValue(undefined)
    setAuth({ updateProfileFields })
    const { result } = renderHook(() => useQuizDisplayPrefs())

    act(() => { result.current.setPref('theme', 'dark') })
    act(() => { result.current.resetPrefs() })
    expect(result.current.prefs).toEqual(DEFAULT_QUIZ_DISPLAY)

    await act(async () => { vi.advanceTimersByTime(600) })
    expect(updateProfileFields).toHaveBeenCalledWith({ quizDisplayPrefs: DEFAULT_QUIZ_DISPLAY })
  })
})
