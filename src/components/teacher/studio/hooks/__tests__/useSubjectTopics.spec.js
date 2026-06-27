import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSubjectTopics } from '../useSubjectTopics.js'

// Mock the data service so tests never hit real fetch/data
vi.mock('../../utils/curriculumDataService.js', () => ({
  getTopicsForSubject: vi.fn(),
  getSubtopicDetail: vi.fn(),
}))

import { getTopicsForSubject } from '../../utils/curriculumDataService.js'

const TOPICS = [
  { label: 'WHOLE NUMBERS', subtopics: ['Counting', 'Addition'] },
  { label: 'FRACTIONS', subtopics: ['Proper fractions'] },
]

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Initial / idle state ──────────────────────────────────────────────────────

describe('useSubjectTopics — missing params', () => {
  it('returns empty topics when subject is falsy', () => {
    const { result } = renderHook(() =>
      useSubjectTopics('', 'Grade 4', 'cbc'),
    )
    expect(result.current.topics).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(getTopicsForSubject).not.toHaveBeenCalled()
  })

  it('returns empty topics when grade is falsy', () => {
    const { result } = renderHook(() =>
      useSubjectTopics('Mathematics', '', 'cbc'),
    )
    expect(result.current.topics).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(getTopicsForSubject).not.toHaveBeenCalled()
  })

  it('returns empty topics when curriculumMode is null', () => {
    const { result } = renderHook(() =>
      useSubjectTopics('Mathematics', 'Grade 4', null),
    )
    expect(result.current.topics).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(getTopicsForSubject).not.toHaveBeenCalled()
  })

  it('returns empty topics when all params are falsy', () => {
    const { result } = renderHook(() =>
      useSubjectTopics(null, null, null),
    )
    expect(result.current.topics).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })
})

// ── Loading state ─────────────────────────────────────────────────────────────

describe('useSubjectTopics — loading state', () => {
  it('sets loading true while the promise is pending', () => {
    let resolve
    getTopicsForSubject.mockReturnValue(new Promise((r) => { resolve = r }))

    const { result } = renderHook(() =>
      useSubjectTopics('Mathematics', 'Grade 4', 'cbc'),
    )

    expect(result.current.loading).toBe(true)
    expect(result.current.topics).toEqual([])
    expect(result.current.error).toBeNull()

    // Clean up the dangling promise
    resolve([])
  })

  it('sets loading false after the promise resolves', async () => {
    getTopicsForSubject.mockResolvedValue(TOPICS)

    const { result } = renderHook(() =>
      useSubjectTopics('Mathematics', 'Grade 4', 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
  })
})

// ── Successful fetch ──────────────────────────────────────────────────────────

describe('useSubjectTopics — successful fetch', () => {
  it('stores returned topics in state', async () => {
    getTopicsForSubject.mockResolvedValue(TOPICS)

    const { result } = renderHook(() =>
      useSubjectTopics('Mathematics', 'Grade 4', 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.topics).toEqual(TOPICS)
    expect(result.current.error).toBeNull()
  })

  it('calls getTopicsForSubject with the correct arguments', async () => {
    getTopicsForSubject.mockResolvedValue([])

    renderHook(() =>
      useSubjectTopics('Food & Nutrition', 'Form 1', 'previous'),
    )

    await waitFor(() => expect(getTopicsForSubject).toHaveBeenCalledTimes(1))
    expect(getTopicsForSubject).toHaveBeenCalledWith('Food & Nutrition', 'Form 1', 'previous')
  })

  it('re-fetches when subject changes', async () => {
    getTopicsForSubject.mockResolvedValue(TOPICS)

    const { result, rerender } = renderHook(
      ({ subject }) => useSubjectTopics(subject, 'Grade 4', 'cbc'),
      { initialProps: { subject: 'Mathematics' } },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(getTopicsForSubject).toHaveBeenCalledTimes(1)

    rerender({ subject: 'Science' })

    await waitFor(() => expect(getTopicsForSubject).toHaveBeenCalledTimes(2))
    expect(getTopicsForSubject).toHaveBeenLastCalledWith('Science', 'Grade 4', 'cbc')
  })

  it('re-fetches when grade changes', async () => {
    getTopicsForSubject.mockResolvedValue(TOPICS)

    const { rerender } = renderHook(
      ({ grade }) => useSubjectTopics('Mathematics', grade, 'cbc'),
      { initialProps: { grade: 'Grade 4' } },
    )

    await waitFor(() => expect(getTopicsForSubject).toHaveBeenCalledTimes(1))

    rerender({ grade: 'Grade 5' })

    await waitFor(() => expect(getTopicsForSubject).toHaveBeenCalledTimes(2))
  })

  it('re-fetches when curriculumMode changes', async () => {
    getTopicsForSubject.mockResolvedValue(TOPICS)

    const { rerender } = renderHook(
      ({ mode }) => useSubjectTopics('Mathematics', 'Grade 4', mode),
      { initialProps: { mode: 'cbc' } },
    )

    await waitFor(() => expect(getTopicsForSubject).toHaveBeenCalledTimes(1))

    rerender({ mode: 'previous' })

    await waitFor(() => expect(getTopicsForSubject).toHaveBeenCalledTimes(2))
  })
})

// ── Error handling ────────────────────────────────────────────────────────────

describe('useSubjectTopics — error handling', () => {
  it('stores the error message when the service rejects', async () => {
    getTopicsForSubject.mockRejectedValue(new Error('Network failure'))

    const { result } = renderHook(() =>
      useSubjectTopics('Mathematics', 'Grade 4', 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('Network failure')
    expect(result.current.topics).toEqual([])
  })

  it('stores a string representation when the rejection is not an Error', async () => {
    getTopicsForSubject.mockRejectedValue('something went wrong')

    const { result } = renderHook(() =>
      useSubjectTopics('Mathematics', 'Grade 4', 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('something went wrong')
  })

  it('clears error on a subsequent successful fetch', async () => {
    getTopicsForSubject
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce(TOPICS)

    const { result, rerender } = renderHook(
      ({ grade }) => useSubjectTopics('Mathematics', grade, 'cbc'),
      { initialProps: { grade: 'Grade 4' } },
    )

    await waitFor(() => expect(result.current.error).toBe('first failure'))

    rerender({ grade: 'Grade 5' })

    await waitFor(() => {
      expect(result.current.error).toBeNull()
      expect(result.current.topics).toEqual(TOPICS)
    })
  })
})

// ── Stale request cancellation ────────────────────────────────────────────────

describe('useSubjectTopics — stale request cancellation', () => {
  it('ignores a stale response that resolves after params have changed', async () => {
    let resolveFirst
    const firstPromise = new Promise((r) => { resolveFirst = r })
    const secondTopics = [{ label: 'TOPIC B', subtopics: [] }]

    getTopicsForSubject
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(secondTopics)

    const { result, rerender } = renderHook(
      ({ grade }) => useSubjectTopics('Mathematics', grade, 'cbc'),
      { initialProps: { grade: 'Grade 4' } },
    )

    // Trigger the second fetch by changing params
    rerender({ grade: 'Grade 5' })

    // Second fetch resolves immediately
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Now resolve the first (stale) request with different data
    resolveFirst([{ label: 'STALE TOPIC', subtopics: [] }])

    // Give React a tick to process any state update (there should be none)
    await new Promise((r) => setTimeout(r, 0))

    // State must reflect the second (fresh) response, not the stale one
    expect(result.current.topics).toEqual(secondTopics)
  })

  it('resets to empty when params become falsy after a successful fetch', async () => {
    getTopicsForSubject.mockResolvedValue(TOPICS)

    const { result, rerender } = renderHook(
      ({ grade }) => useSubjectTopics('Mathematics', grade, 'cbc'),
      { initialProps: { grade: 'Grade 4' } },
    )

    await waitFor(() => expect(result.current.topics).toEqual(TOPICS))

    rerender({ grade: '' })

    expect(result.current.topics).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
