import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAILessonCount, suggestLessonCount } from '../useAILessonCount.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TOPIC = 'WHOLE NUMBERS'
const SUBTOPIC = 'Addition of whole numbers'
const ACTIVITIES = ['Group work', 'Drill', 'Game']
const STANDARD = 'Learner adds whole numbers up to 1000'

// ── suggestLessonCount (pure heuristic) ───────────────────────────────────────

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
})

// ── Idle / guard ──────────────────────────────────────────────────────────────

describe('useAILessonCount — idle state', () => {
  it('returns null recommendation, loading false, error null when not ready', () => {
    const { result } = renderHook(() => useAILessonCount('', '', [], '', null))
    expect(result.current.recommendation).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('exposes a fetchRecommendation function', () => {
    const { result } = renderHook(() => useAILessonCount('', '', [], '', null))
    expect(typeof result.current.fetchRecommendation).toBe('function')
  })

  it('does not recommend for non-CBC mode', () => {
    const { result } = renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, 'previous'),
    )
    expect(result.current.recommendation).toBeNull()
  })

  it('does not recommend when subtopic is empty', () => {
    const { result } = renderHook(() =>
      useAILessonCount(TOPIC, '', ACTIVITIES, STANDARD, 'cbc'),
    )
    expect(result.current.recommendation).toBeNull()
  })
})

// ── Deterministic recommendation ──────────────────────────────────────────────

describe('useAILessonCount — recommends when CBC + topic + subtopic present', () => {
  it('computes a recommendation immediately (no loading, no error)', () => {
    const { result } = renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
    )
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.recommendation).toEqual({
      count: 3,
      reason: expect.stringContaining('3 learning activities'),
    })
  })

  it('recommends even when the syllabus row lists no activities (sparse rows)', () => {
    const { result } = renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, [], '', 'cbc'),
    )
    expect(result.current.recommendation?.count).toBe(2)
  })

  it('recomputes when the subtopic changes', () => {
    const { result, rerender } = renderHook(
      ({ acts }) => useAILessonCount(TOPIC, SUBTOPIC, acts, STANDARD, 'cbc'),
      { initialProps: { acts: ACTIVITIES } },
    )
    expect(result.current.recommendation.count).toBe(3)
    rerender({ acts: ['only one'] })
    expect(result.current.recommendation.count).toBe(1)
  })

  it('clears the recommendation when params become invalid', () => {
    const { result, rerender } = renderHook(
      ({ mode }) => useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, mode),
      { initialProps: { mode: 'cbc' } },
    )
    expect(result.current.recommendation).not.toBeNull()
    rerender({ mode: 'previous' })
    expect(result.current.recommendation).toBeNull()
  })

  it('fetchRecommendation recomputes without throwing', () => {
    const { result } = renderHook(() =>
      useAILessonCount(TOPIC, SUBTOPIC, ACTIVITIES, STANDARD, 'cbc'),
    )
    act(() => result.current.fetchRecommendation())
    expect(result.current.recommendation.count).toBe(3)
  })
})
