import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAILessonCount, suggestLessonCount } from '../useAILessonCount.js'
import { fetchAiLessonCount } from '../../../../utils/aiLessonCount.js'

vi.mock('../../../../utils/aiLessonCount.js', () => ({
  fetchAiLessonCount: vi.fn(),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TOPIC = 'WHOLE NUMBERS'
const SUBTOPIC = 'Addition of whole numbers'
const ACTIVITIES = ['Group work', 'Drill', 'Game']
const STANDARD = 'Learner adds whole numbers up to 1000'

const AI_REC = {
  count: 4,
  reason: 'Four steps: place value, no-carry, carrying, application.',
  breakdown: [
    { lessonNumber: 1, title: 'Place value recap', focus: 'Revise tens/units.', status: 'pending' },
    { lessonNumber: 2, title: 'Adding without carrying', focus: 'Column addition.', status: 'pending' },
    { lessonNumber: 3, title: 'Adding with carrying', focus: 'Carrying practice.', status: 'pending' },
    { lessonNumber: 4, title: 'Word problems', focus: 'Apply to daily life.', status: 'pending' },
  ],
}

function renderAiHook(overrides = {}) {
  const props = {
    topic: TOPIC,
    subtopic: SUBTOPIC,
    activities: ACTIVITIES,
    standard: STANDARD,
    mode: 'cbc',
    context: { grade: 'G5', subject: 'mathematics', enabled: true },
    ...overrides,
  }
  return renderHook(
    ({ topic, subtopic, activities, standard, mode, context }) =>
      useAILessonCount(topic, subtopic, activities, standard, mode, context),
    { initialProps: props },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchAiLessonCount.mockResolvedValue(AI_REC)
})

// ── suggestLessonCount (pure heuristic — the offline fallback) ────────────────

describe('suggestLessonCount', () => {
  it('returns one lesson per learning activity (clamped 1–6)', () => {
    expect(suggestLessonCount(['a']).count).toBe(1)
    expect(suggestLessonCount(['a', 'b', 'c']).count).toBe(3)
    expect(suggestLessonCount(Array.from({ length: 10 }, (_, i) => `a${i}`)).count).toBe(6)
  })

  it('defaults to a 2-lesson series when there are no activities', () => {
    expect(suggestLessonCount([]).count).toBe(2)
    expect(suggestLessonCount(undefined).count).toBe(2)
  })

  it('always returns a non-empty reason string', () => {
    expect(typeof suggestLessonCount(['a']).reason).toBe('string')
    expect(suggestLessonCount(['a']).reason.length).toBeGreaterThan(0)
    expect(suggestLessonCount([]).reason.length).toBeGreaterThan(0)
  })

  it('successive variants surface DIFFERENT counts', () => {
    expect(suggestLessonCount(ACTIVITIES, 0).count).toBe(3)
    expect(suggestLessonCount(ACTIVITIES, 1).count).toBe(4)
    expect(suggestLessonCount(ACTIVITIES, 2).count).toBe(2)
  })

  it('cycles through the full 1–6 span and wraps back to the base', () => {
    const seen = [0, 1, 2, 3, 4, 5].map((v) => suggestLessonCount(ACTIVITIES, v).count)
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
    expect(suggestLessonCount(ACTIVITIES, 6).count).toBe(3)
  })

  it('clamps every variant into 1–6', () => {
    for (let v = 0; v < 12; v += 1) {
      const { count } = suggestLessonCount(ACTIVITIES, v)
      expect(count).toBeGreaterThanOrEqual(1)
      expect(count).toBeLessThanOrEqual(6)
    }
  })
})

// ── Idle / guard ──────────────────────────────────────────────────────────────

describe('useAILessonCount — idle state', () => {
  it('returns null recommendation, loading false when not ready', () => {
    const { result } = renderAiHook({ topic: '', subtopic: '', activities: [], standard: '', mode: null })
    expect(result.current.recommendation).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(fetchAiLessonCount).not.toHaveBeenCalled()
  })

  it('exposes a fetchRecommendation function', () => {
    const { result } = renderAiHook({ topic: '', subtopic: '' })
    expect(typeof result.current.fetchRecommendation).toBe('function')
  })

  it('does not call the backend for non-CBC mode', () => {
    renderAiHook({ mode: 'previous' })
    expect(fetchAiLessonCount).not.toHaveBeenCalled()
  })

  it('does not call the backend when subtopic is empty', () => {
    renderAiHook({ subtopic: '' })
    expect(fetchAiLessonCount).not.toHaveBeenCalled()
  })

  it('does not call the backend when disabled (single-lesson mode)', () => {
    const { result } = renderAiHook({ context: { enabled: false } })
    expect(fetchAiLessonCount).not.toHaveBeenCalled()
    expect(result.current.recommendation).toBeNull()
  })
})

// ── AI recommendation path ────────────────────────────────────────────────────

describe('useAILessonCount — AI recommendation', () => {
  it('fetches from the backend and surfaces count/reason/breakdown', async () => {
    const { result } = renderAiHook()
    await waitFor(() => expect(result.current.recommendation).not.toBeNull())
    expect(fetchAiLessonCount).toHaveBeenCalledTimes(1)
    expect(fetchAiLessonCount).toHaveBeenCalledWith(expect.objectContaining({
      grade: 'G5',
      subject: 'mathematics',
      topic: TOPIC,
      subtopic: SUBTOPIC,
      learningActivities: ACTIVITIES,
      expectedStandard: STANDARD,
      avoidCounts: [],
    }))
    expect(result.current.recommendation).toMatchObject({
      count: 4,
      reason: AI_REC.reason,
      source: 'ai',
    })
    expect(result.current.recommendation.breakdown).toHaveLength(4)
    expect(result.current.loading).toBe(false)
  })

  it('starts fetching when enabled flips on (single → series)', async () => {
    const { result, rerender } = renderAiHook({ context: { grade: 'G5', subject: 'mathematics', enabled: false } })
    expect(fetchAiLessonCount).not.toHaveBeenCalled()
    rerender({
      topic: TOPIC, subtopic: SUBTOPIC, activities: ACTIVITIES, standard: STANDARD, mode: 'cbc',
      context: { grade: 'G5', subject: 'mathematics', enabled: true },
    })
    await waitFor(() => expect(result.current.recommendation).not.toBeNull())
    expect(fetchAiLessonCount).toHaveBeenCalledTimes(1)
  })

  it('refetches when the sub-topic changes', async () => {
    const { result, rerender } = renderAiHook()
    await waitFor(() => expect(result.current.recommendation).not.toBeNull())
    rerender({
      topic: TOPIC, subtopic: 'Subtraction', activities: ACTIVITIES, standard: STANDARD, mode: 'cbc',
      context: { grade: 'G5', subject: 'mathematics', enabled: true },
    })
    await waitFor(() => expect(fetchAiLessonCount).toHaveBeenCalledTimes(2))
    expect(fetchAiLessonCount).toHaveBeenLastCalledWith(
      expect.objectContaining({ subtopic: 'Subtraction' }),
    )
  })

  it('does not refetch on unrelated re-renders with the same context', async () => {
    const { result, rerender } = renderAiHook()
    await waitFor(() => expect(result.current.recommendation).not.toBeNull())
    rerender({
      topic: TOPIC, subtopic: SUBTOPIC, activities: ACTIVITIES, standard: STANDARD, mode: 'cbc',
      context: { grade: 'G5', subject: 'mathematics', enabled: true },
    })
    expect(fetchAiLessonCount).toHaveBeenCalledTimes(1)
  })

  it('clears the recommendation when params become invalid', async () => {
    const { result, rerender } = renderAiHook()
    await waitFor(() => expect(result.current.recommendation).not.toBeNull())
    rerender({
      topic: TOPIC, subtopic: SUBTOPIC, activities: ACTIVITIES, standard: STANDARD, mode: 'previous',
      context: { grade: 'G5', subject: 'mathematics', enabled: true },
    })
    expect(result.current.recommendation).toBeNull()
  })

  it('"Get New Suggestion" refetches, passing the counts already shown', async () => {
    fetchAiLessonCount
      .mockResolvedValueOnce(AI_REC)
      .mockResolvedValueOnce({ count: 2, reason: 'Consolidated pace.', breakdown: [] })
    const { result } = renderAiHook()
    await waitFor(() => expect(result.current.recommendation?.count).toBe(4))

    act(() => result.current.fetchRecommendation())
    await waitFor(() => expect(result.current.recommendation?.count).toBe(2))

    expect(fetchAiLessonCount).toHaveBeenCalledTimes(2)
    expect(fetchAiLessonCount).toHaveBeenLastCalledWith(
      expect.objectContaining({ avoidCounts: [4] }),
    )
  })
})

// ── Offline / failure fallback ────────────────────────────────────────────────

describe('useAILessonCount — heuristic fallback when the backend fails', () => {
  it('falls back to the deterministic heuristic (never blocks series mode)', async () => {
    fetchAiLessonCount.mockRejectedValue(new Error('offline'))
    const { result } = renderAiHook()
    await waitFor(() => expect(result.current.recommendation).not.toBeNull())
    expect(result.current.recommendation).toMatchObject({
      count: 3, // one per activity
      source: 'heuristic',
      breakdown: [],
    })
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('fallback presses still cycle to different counts', async () => {
    fetchAiLessonCount.mockRejectedValue(new Error('offline'))
    const { result } = renderAiHook()
    await waitFor(() => expect(result.current.recommendation?.count).toBe(3))

    act(() => result.current.fetchRecommendation())
    await waitFor(() => expect(result.current.recommendation?.count).toBe(4))

    act(() => result.current.fetchRecommendation())
    await waitFor(() => expect(result.current.recommendation?.count).toBe(2))
  })
})
