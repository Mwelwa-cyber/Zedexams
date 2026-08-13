import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLessonSeries } from '../useLessonSeries.js'

// ── Mock firebase/firestore ───────────────────────────────────────────────────
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(),
}))

// ── Mock src/firebase/config.js ───────────────────────────────────────────────
vi.mock('../../../../firebase/config.js', () => ({
  db: {},
}))

import { collection, onSnapshot } from 'firebase/firestore'

// Helper: build a fake Firestore snapshot from an array of doc data objects
function makeSnapshot(docs) {
  return {
    forEach: (cb) => {
      docs.forEach((data) => cb({ data: () => data }))
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Idle / null params ────────────────────────────────────────────────────────

describe('useLessonSeries — null params', () => {
  it('returns zeros when uid is null', () => {
    const { result } = renderHook(() => useLessonSeries(null, 'series-1'))
    expect(result.current.completedCount).toBe(0)
    expect(result.current.completedLessons).toEqual([])
    expect(result.current.seriesLoading).toBe(false)
    expect(result.current.seriesError).toBeNull()
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('returns zeros when seriesId is null', () => {
    const { result } = renderHook(() => useLessonSeries('uid-1', null))
    expect(result.current.completedCount).toBe(0)
    expect(result.current.completedLessons).toEqual([])
    expect(result.current.seriesLoading).toBe(false)
    expect(result.current.seriesError).toBeNull()
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('returns zeros when both uid and seriesId are null', () => {
    const { result } = renderHook(() => useLessonSeries(null, null))
    expect(result.current.completedCount).toBe(0)
    expect(result.current.completedLessons).toEqual([])
    expect(result.current.seriesLoading).toBe(false)
    expect(result.current.seriesError).toBeNull()
  })

  it('returns zeros when uid is empty string', () => {
    const { result } = renderHook(() => useLessonSeries('', 'series-1'))
    expect(result.current.completedCount).toBe(0)
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('returns zeros when seriesId is empty string', () => {
    const { result } = renderHook(() => useLessonSeries('uid-1', ''))
    expect(result.current.completedCount).toBe(0)
    expect(onSnapshot).not.toHaveBeenCalled()
  })
})

// ── Subscription setup ────────────────────────────────────────────────────────

describe('useLessonSeries — subscription', () => {
  it('calls collection with the correct path when both params are provided', () => {
    const fakeRef = {}
    collection.mockReturnValue(fakeRef)
    onSnapshot.mockReturnValue(vi.fn())

    renderHook(() => useLessonSeries('uid-abc', 'series-xyz'))

    expect(collection).toHaveBeenCalledWith(
      expect.anything(),          // db
      'lessonSeries',
      'uid-abc',
      'series-xyz',
    )
    expect(onSnapshot).toHaveBeenCalledWith(fakeRef, expect.any(Function), expect.any(Function))
  })

  it('sets seriesLoading true before the first snapshot arrives', () => {
    collection.mockReturnValue({})
    // onSnapshot that never fires its callback
    onSnapshot.mockReturnValue(vi.fn())

    const { result } = renderHook(() => useLessonSeries('uid-1', 'series-1'))
    expect(result.current.seriesLoading).toBe(true)
  })
})

// ── Snapshot processing ───────────────────────────────────────────────────────

describe('useLessonSeries — snapshot processing', () => {
  it('sets seriesLoading false after first snapshot', () => {
    collection.mockReturnValue({})
    let capturedNext
    onSnapshot.mockImplementation((_ref, next) => {
      capturedNext = next
      return vi.fn()
    })

    const { result } = renderHook(() => useLessonSeries('uid-1', 'series-1'))
    expect(result.current.seriesLoading).toBe(true)

    act(() => {
      capturedNext(makeSnapshot([]))
    })

    expect(result.current.seriesLoading).toBe(false)
  })

  it('maps completed lessons correctly', () => {
    collection.mockReturnValue({})
    let capturedNext
    onSnapshot.mockImplementation((_ref, next) => {
      capturedNext = next
      return vi.fn()
    })

    const { result } = renderHook(() => useLessonSeries('uid-1', 'series-1'))

    act(() => {
      capturedNext(makeSnapshot([
        { lessonNumber: '1', status: 'completed' },
        { lessonNumber: '2', status: 'pending' },
        { lessonNumber: '3', status: 'completed' },
      ]))
    })

    expect(result.current.completedLessons).toEqual(expect.arrayContaining(['1', '3']))
    expect(result.current.completedLessons).toHaveLength(2)
    expect(result.current.completedCount).toBe(2)
  })

  it('excludes non-completed lessons from completedLessons', () => {
    collection.mockReturnValue({})
    let capturedNext
    onSnapshot.mockImplementation((_ref, next) => {
      capturedNext = next
      return vi.fn()
    })

    const { result } = renderHook(() => useLessonSeries('uid-1', 'series-1'))

    act(() => {
      capturedNext(makeSnapshot([
        { lessonNumber: '1', status: 'pending' },
        { lessonNumber: '2', status: 'draft' },
      ]))
    })

    expect(result.current.completedLessons).toEqual([])
    expect(result.current.completedCount).toBe(0)
  })

  it('coerces lessonNumber to string', () => {
    collection.mockReturnValue({})
    let capturedNext
    onSnapshot.mockImplementation((_ref, next) => {
      capturedNext = next
      return vi.fn()
    })

    const { result } = renderHook(() => useLessonSeries('uid-1', 'series-1'))

    act(() => {
      capturedNext(makeSnapshot([
        { lessonNumber: 2, status: 'completed' },
      ]))
    })

    expect(result.current.completedLessons).toEqual(['2'])
  })

  it('clears seriesError when a snapshot arrives after an earlier error', () => {
    collection.mockReturnValue({})
    let capturedNext
    let capturedError
    onSnapshot.mockImplementation((_ref, next, error) => {
      capturedNext  = next
      capturedError = error
      return vi.fn()
    })

    const { result } = renderHook(() => useLessonSeries('uid-1', 'series-1'))

    act(() => { capturedError(new Error('Firestore down')) })
    expect(result.current.seriesError).toBe('Firestore down')

    act(() => { capturedNext(makeSnapshot([])) })
    expect(result.current.seriesError).toBeNull()
  })
})

// ── Error handling ────────────────────────────────────────────────────────────

describe('useLessonSeries — error handling', () => {
  it('stores the error message when Firestore errors', () => {
    collection.mockReturnValue({})
    let capturedError
    onSnapshot.mockImplementation((_ref, _next, error) => {
      capturedError = error
      return vi.fn()
    })

    const { result } = renderHook(() => useLessonSeries('uid-1', 'series-1'))

    act(() => {
      capturedError(new Error('Permission denied'))
    })

    expect(result.current.seriesError).toBe('Permission denied')
    expect(result.current.seriesLoading).toBe(false)
  })

  it('stores a string representation when error is not an Error object', () => {
    collection.mockReturnValue({})
    let capturedError
    onSnapshot.mockImplementation((_ref, _next, error) => {
      capturedError = error
      return vi.fn()
    })

    const { result } = renderHook(() => useLessonSeries('uid-1', 'series-1'))

    act(() => {
      capturedError('quota exceeded')
    })

    expect(result.current.seriesError).toBe('quota exceeded')
  })
})

// ── Cleanup / unsubscribe ─────────────────────────────────────────────────────

describe('useLessonSeries — cleanup', () => {
  it('calls the unsubscribe function returned by onSnapshot on unmount', () => {
    collection.mockReturnValue({})
    const unsubscribe = vi.fn()
    onSnapshot.mockReturnValue(unsubscribe)

    const { unmount } = renderHook(() => useLessonSeries('uid-1', 'series-1'))
    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('calls unsubscribe when uid changes (resets subscription)', () => {
    collection.mockReturnValue({})
    const unsubscribe = vi.fn()
    onSnapshot.mockReturnValue(unsubscribe)

    const { rerender } = renderHook(
      ({ uid }) => useLessonSeries(uid, 'series-1'),
      { initialProps: { uid: 'uid-A' } },
    )

    rerender({ uid: 'uid-B' })

    // unsubscribe called once for the cleanup of the first effect
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('resets to zeros and stops loading when uid becomes null after a subscription', () => {
    collection.mockReturnValue({})
    let capturedNext
    onSnapshot.mockImplementation((_ref, next) => {
      capturedNext = next
      return vi.fn()
    })

    const { result, rerender } = renderHook(
      ({ uid }) => useLessonSeries(uid, 'series-1'),
      { initialProps: { uid: 'uid-1' } },
    )

    act(() => {
      capturedNext(makeSnapshot([{ lessonNumber: '1', status: 'completed' }]))
    })
    expect(result.current.completedCount).toBe(1)

    rerender({ uid: null })

    expect(result.current.completedCount).toBe(0)
    expect(result.current.completedLessons).toEqual([])
    expect(result.current.seriesLoading).toBe(false)
    expect(result.current.seriesError).toBeNull()
  })
})
