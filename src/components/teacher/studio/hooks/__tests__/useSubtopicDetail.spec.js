import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSubtopicDetail } from '../useSubtopicDetail.js'

vi.mock('../../utils/curriculumDataService.js', () => ({
  getTopicsForSubject: vi.fn(),
  getSubtopicDetail: vi.fn(),
}))

import { getSubtopicDetail } from '../../utils/curriculumDataService.js'

const CBC_ROW = {
  topic: 'WHOLE NUMBERS',
  subtopic: 'Counting',
  specificCompetence: 'Count up to 1 000 000',
  learningActivities: ['Count objects', 'Use a number line'],
  expectedStandard: 'Learner counts correctly',
}

const OLD_ROW = {
  topic: 'WHOLE NUMBERS',
  subtopic: 'Counting',
  specificOutcomes: ['Count objects in groups of 2', 'Count backwards'],
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Missing params ────────────────────────────────────────────────────────────

describe('useSubtopicDetail — missing params', () => {
  it('returns null when subject is falsy', () => {
    const { result } = renderHook(() =>
      useSubtopicDetail('', 'Grade 4', 'WHOLE NUMBERS', 'Counting', 'cbc'),
    )
    expect(result.current.subtopicRow).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(getSubtopicDetail).not.toHaveBeenCalled()
  })

  it('returns null when grade is falsy', () => {
    const { result } = renderHook(() =>
      useSubtopicDetail('Mathematics', '', 'WHOLE NUMBERS', 'Counting', 'cbc'),
    )
    expect(result.current.subtopicRow).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(getSubtopicDetail).not.toHaveBeenCalled()
  })

  it('returns null when topic is falsy', () => {
    const { result } = renderHook(() =>
      useSubtopicDetail('Mathematics', 'Grade 4', '', 'Counting', 'cbc'),
    )
    expect(result.current.subtopicRow).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(getSubtopicDetail).not.toHaveBeenCalled()
  })

  it('returns null when subtopic is falsy', () => {
    const { result } = renderHook(() =>
      useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', '', 'cbc'),
    )
    expect(result.current.subtopicRow).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(getSubtopicDetail).not.toHaveBeenCalled()
  })

  it('returns null when curriculumMode is null', () => {
    const { result } = renderHook(() =>
      useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', 'Counting', null),
    )
    expect(result.current.subtopicRow).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(getSubtopicDetail).not.toHaveBeenCalled()
  })

  it('returns null when all params are falsy', () => {
    const { result } = renderHook(() =>
      useSubtopicDetail(null, null, null, null, null),
    )
    expect(result.current.subtopicRow).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })
})

// ── Loading state ─────────────────────────────────────────────────────────────

describe('useSubtopicDetail — loading state', () => {
  it('sets loading true while the promise is pending', () => {
    let resolve
    getSubtopicDetail.mockReturnValue(new Promise((r) => { resolve = r }))

    const { result } = renderHook(() =>
      useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', 'Counting', 'cbc'),
    )

    expect(result.current.loading).toBe(true)
    expect(result.current.subtopicRow).toBeNull()
    expect(result.current.error).toBeNull()

    resolve(null)
  })

  it('sets loading false after the promise resolves', async () => {
    getSubtopicDetail.mockResolvedValue(CBC_ROW)

    const { result } = renderHook(() =>
      useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', 'Counting', 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
  })
})

// ── Successful fetch ──────────────────────────────────────────────────────────

describe('useSubtopicDetail — successful fetch', () => {
  it('stores a CBC row in state', async () => {
    getSubtopicDetail.mockResolvedValue(CBC_ROW)

    const { result } = renderHook(() =>
      useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', 'Counting', 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.subtopicRow).toEqual(CBC_ROW)
    expect(result.current.error).toBeNull()
  })

  it('stores a previous-curriculum row in state', async () => {
    getSubtopicDetail.mockResolvedValue(OLD_ROW)

    const { result } = renderHook(() =>
      useSubtopicDetail('Mathematics', 'Grade 10', 'WHOLE NUMBERS', 'Counting', 'previous'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.subtopicRow).toEqual(OLD_ROW)
    expect(result.current.error).toBeNull()
  })

  it('calls getSubtopicDetail with the correct arguments', async () => {
    getSubtopicDetail.mockResolvedValue(CBC_ROW)

    renderHook(() =>
      useSubtopicDetail('Food & Nutrition', 'Form 1', 'NUTRITION', 'Vitamins', 'cbc'),
    )

    await waitFor(() => expect(getSubtopicDetail).toHaveBeenCalledTimes(1))
    expect(getSubtopicDetail).toHaveBeenCalledWith(
      'Food & Nutrition', 'Form 1', 'NUTRITION', 'Vitamins', 'cbc',
    )
  })

  it('stores null without error when the service returns null (not found)', async () => {
    getSubtopicDetail.mockResolvedValue(null)

    const { result } = renderHook(() =>
      useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', 'Unknown sub', 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.subtopicRow).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('re-fetches when subtopic changes', async () => {
    getSubtopicDetail.mockResolvedValue(CBC_ROW)

    const { rerender } = renderHook(
      ({ subtopic }) =>
        useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', subtopic, 'cbc'),
      { initialProps: { subtopic: 'Counting' } },
    )

    await waitFor(() => expect(getSubtopicDetail).toHaveBeenCalledTimes(1))

    rerender({ subtopic: 'Addition' })

    await waitFor(() => expect(getSubtopicDetail).toHaveBeenCalledTimes(2))
    expect(getSubtopicDetail).toHaveBeenLastCalledWith(
      'Mathematics', 'Grade 4', 'WHOLE NUMBERS', 'Addition', 'cbc',
    )
  })

  it('re-fetches when topic changes', async () => {
    getSubtopicDetail.mockResolvedValue(CBC_ROW)

    const { rerender } = renderHook(
      ({ topic }) =>
        useSubtopicDetail('Mathematics', 'Grade 4', topic, 'Counting', 'cbc'),
      { initialProps: { topic: 'WHOLE NUMBERS' } },
    )

    await waitFor(() => expect(getSubtopicDetail).toHaveBeenCalledTimes(1))

    rerender({ topic: 'FRACTIONS' })

    await waitFor(() => expect(getSubtopicDetail).toHaveBeenCalledTimes(2))
  })

  it('re-fetches when curriculumMode changes', async () => {
    getSubtopicDetail.mockResolvedValue(CBC_ROW)

    const { rerender } = renderHook(
      ({ mode }) =>
        useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', 'Counting', mode),
      { initialProps: { mode: 'cbc' } },
    )

    await waitFor(() => expect(getSubtopicDetail).toHaveBeenCalledTimes(1))

    rerender({ mode: 'previous' })

    await waitFor(() => expect(getSubtopicDetail).toHaveBeenCalledTimes(2))
  })
})

// ── Error handling ────────────────────────────────────────────────────────────

describe('useSubtopicDetail — error handling', () => {
  it('stores the error message when the service rejects', async () => {
    getSubtopicDetail.mockRejectedValue(new Error('Fetch failed'))

    const { result } = renderHook(() =>
      useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', 'Counting', 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('Fetch failed')
    expect(result.current.subtopicRow).toBeNull()
  })

  it('stores a string representation when the rejection is not an Error', async () => {
    getSubtopicDetail.mockRejectedValue('timeout')

    const { result } = renderHook(() =>
      useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', 'Counting', 'cbc'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('timeout')
  })

  it('clears error on a subsequent successful fetch', async () => {
    getSubtopicDetail
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce(CBC_ROW)

    const { result, rerender } = renderHook(
      ({ subtopic }) =>
        useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', subtopic, 'cbc'),
      { initialProps: { subtopic: 'Counting' } },
    )

    await waitFor(() => expect(result.current.error).toBe('first failure'))

    rerender({ subtopic: 'Addition' })

    await waitFor(() => {
      expect(result.current.error).toBeNull()
      expect(result.current.subtopicRow).toEqual(CBC_ROW)
    })
  })
})

// ── Stale request cancellation ────────────────────────────────────────────────

describe('useSubtopicDetail — stale request cancellation', () => {
  it('ignores a stale response that resolves after params have changed', async () => {
    let resolveFirst
    const firstPromise = new Promise((r) => { resolveFirst = r })

    getSubtopicDetail
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(CBC_ROW)

    const { result, rerender } = renderHook(
      ({ subtopic }) =>
        useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', subtopic, 'cbc'),
      { initialProps: { subtopic: 'Counting' } },
    )

    // Trigger second fetch before first resolves
    rerender({ subtopic: 'Addition' })

    // Second fetch resolves immediately
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Now resolve the stale first request with different data
    resolveFirst({ topic: 'STALE', subtopic: 'STALE', specificCompetence: 'STALE' })

    await new Promise((r) => setTimeout(r, 0))

    // Must reflect the fresh (second) response
    expect(result.current.subtopicRow).toEqual(CBC_ROW)
  })

  it('resets to null when params become falsy after a successful fetch', async () => {
    getSubtopicDetail.mockResolvedValue(CBC_ROW)

    const { result, rerender } = renderHook(
      ({ subtopic }) =>
        useSubtopicDetail('Mathematics', 'Grade 4', 'WHOLE NUMBERS', subtopic, 'cbc'),
      { initialProps: { subtopic: 'Counting' } },
    )

    await waitFor(() => expect(result.current.subtopicRow).toEqual(CBC_ROW))

    rerender({ subtopic: '' })

    expect(result.current.subtopicRow).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
