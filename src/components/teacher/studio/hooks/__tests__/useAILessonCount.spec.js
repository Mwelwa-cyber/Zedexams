import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useAILessonCount } from '../useAILessonCount.js'

// ── Mock firebase/functions ───────────────────────────────────────────────────

const mockFn = vi.fn()

vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => mockFn,
}))

vi.mock('../../../../../firebase/config.js', () => ({ default: {} }))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TOPIC = 'WHOLE NUMBERS'
const SUBTOPIC = 'Addition of whole numbers'
const ACTIVITIES = ['Group work', 'Drill']
const STANDARD = 'Learner adds whole numbers up to 1000'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Initial / idle state ──────────────────────────────────────────────────────

describe('useAILessonCount — initial state', () => {
  it('returns null recommendation, loading false, error null initially', () => {
    mockFn.mockResolvedValue({ data: { count: 3, reason: 'ok' } })
    // All params missing → stays idle
    const { result } = renderHook(() =>
      useAILessonCount('', '', [], '', null),
    )
    expect(result.current.recommendation).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('exposes a fetchRecommendation function', () => {
    const { result } = renderHook(() =>
      useAILessonCount('', '', [], '', null),
    )
    expect(typeof result.current.fetchRecommendation).toBe('function')
  })
})

// ── CBC-only guard ────────────────────────────────────────────────────────────

describe('useAILessonCount — does not fire for non-CBC mode', () => {
  it('does not call the function when curriculumMode is "previous"', () => {
    renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, 'previous'),
    )
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('does not call the function when curriculumMode is null', () => {
    renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, null),
    )
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('does not call the function when topic is empty', () => {
    renderHook(() =>
      useAILessonCount('', SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
    )
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('does not call the function when subtopic is empty', () => {
    renderHook(() =>
      useAILessonCount(TOPIC, '', ACTIVITIES, STANDARD, 'cbc'),
    )
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('does not call the function when learningActivities is empty', () => {
    renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, [], STANDARD, 'cbc'),
    )
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('does not call the function when expectedStandard is empty', () => {
    renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, '', 'cbc'),
    )
    expect(mockFn).not.toHaveBeenCalled()
  })
})

// ── Auto-fire when params are ready ──────────────────────────────────────────

describe('useAILessonCount — auto-fires when all CBC params present', () => {
  it('calls aiLessonCount automatically when all params are truthy and mode is cbc', async () => {
    mockFn.mockResolvedValue({ data: { count: 4, reason: 'Sufficient depth' } })

    renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
    )

    await waitFor(() => expect(mockFn).toHaveBeenCalledTimes(1))
    expect(mockFn).toHaveBeenCalledWith({
      topic: TOPIC,
      subtopic: SUBTOPIC,
      learningActivities: ACTIVITIES,
      expectedStandard: STANDARD,
    })
  })
})

// ── Loading state ─────────────────────────────────────────────────────────────

describe('useAILessonCount — loading state', () => {
  it('sets loading true while the promise is pending', () => {
    let resolve
    mockFn.mockReturnValue(new Promise((r) => { resolve = r }))

    const { result } = renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
    )

    expect(result.current.loading).toBe(true)
    // Clean up
    resolve({ data: { count: 2, reason: 'ok' } })
  })

  it('sets loading false after the promise resolves', async () => {
    mockFn.mockResolvedValue({ data: { count: 3, reason: 'ok' } })

    const { result } = renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
  })
})

// ── Successful response ───────────────────────────────────────────────────────

describe('useAILessonCount — stores recommendation on success', () => {
  it('stores count and reason in recommendation', async () => {
    mockFn.mockResolvedValue({ data: { count: 5, reason: 'Topic has many subtopics' } })

    const { result } = renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.recommendation).toEqual({ count: 5, reason: 'Topic has many subtopics' })
    expect(result.current.error).toBeNull()
  })
})

// ── Error handling ────────────────────────────────────────────────────────────

describe('useAILessonCount — error handling', () => {
  it('stores error message when the call rejects with an Error', async () => {
    mockFn.mockRejectedValue(new Error('functions/unavailable'))

    const { result } = renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('functions/unavailable')
    expect(result.current.recommendation).toBeNull()
  })

  it('stores a string representation when rejection is not an Error', async () => {
    mockFn.mockRejectedValue('network error')

    const { result } = renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('network error')
  })

  it('clears error on a subsequent successful call via fetchRecommendation', async () => {
    mockFn
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce({ data: { count: 3, reason: 'ok' } })

    const { result } = renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
    )

    await waitFor(() => expect(result.current.error).toBe('first failure'))

    await act(async () => {
      result.current.fetchRecommendation()
    })

    await waitFor(() => {
      expect(result.current.error).toBeNull()
      expect(result.current.recommendation).toEqual({ count: 3, reason: 'ok' })
    })
  })
})

// ── Re-fires on param change ──────────────────────────────────────────────────

describe('useAILessonCount — re-fires when params change', () => {
  it('re-fetches when topic changes', async () => {
    mockFn.mockResolvedValue({ data: { count: 2, reason: 'ok' } })

    const { rerender } = renderHook(
      ({ topic }) => useAILessonCount(topic, SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
      { initialProps: { topic: TOPIC } },
    )

    await waitFor(() => expect(mockFn).toHaveBeenCalledTimes(1))

    rerender({ topic: 'FRACTIONS' })

    await waitFor(() => expect(mockFn).toHaveBeenCalledTimes(2))
    expect(mockFn).toHaveBeenLastCalledWith(
      expect.objectContaining({ topic: 'FRACTIONS' }),
    )
  })

  it('re-fetches when subtopic changes', async () => {
    mockFn.mockResolvedValue({ data: { count: 2, reason: 'ok' } })

    const { rerender } = renderHook(
      ({ subtopic }) => useAILessonCount(TOPIC, subtopic, ACTIVITIES, STANDARD, 'cbc'),
      { initialProps: { subtopic: SUBTOPIC } },
    )

    await waitFor(() => expect(mockFn).toHaveBeenCalledTimes(1))

    rerender({ subtopic: 'Subtraction' })

    await waitFor(() => expect(mockFn).toHaveBeenCalledTimes(2))
  })
})

// ── Stale request cancellation ────────────────────────────────────────────────

describe('useAILessonCount — stale request cancellation', () => {
  it('ignores a stale response that resolves after params have changed', async () => {
    let resolveFirst
    const firstPromise = new Promise((r) => { resolveFirst = r })
    const freshData = { count: 7, reason: 'fresh' }

    mockFn
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({ data: freshData })

    const { result, rerender } = renderHook(
      ({ topic }) => useAILessonCount(topic, SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
      { initialProps: { topic: TOPIC } },
    )

    // Trigger second fetch
    rerender({ topic: 'FRACTIONS' })

    // Second fetch resolves immediately
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Now resolve the stale first request with different data
    resolveFirst({ data: { count: 99, reason: 'stale' } })

    await new Promise((r) => setTimeout(r, 0))

    // Must reflect the second (fresh) response
    expect(result.current.recommendation).toEqual(freshData)
  })

  it('resets recommendation to null when params become invalid', async () => {
    mockFn.mockResolvedValue({ data: { count: 3, reason: 'ok' } })

    const { result, rerender } = renderHook(
      ({ mode }) => useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, mode),
      { initialProps: { mode: 'cbc' } },
    )

    await waitFor(() => expect(result.current.recommendation).not.toBeNull())

    rerender({ mode: 'previous' })

    expect(result.current.recommendation).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
