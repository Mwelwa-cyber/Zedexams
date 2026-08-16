import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// useCurriculumOptions loads the Syllabi index once per session and exposes
// the per-grade subject dropdown options every teacher studio reads. The
// session cache + the grade→subjects index are the subtle parts (a stale or
// mis-grouped index would surface wrong subjects on the wrong grade), so they
// are pinned here. The syllabi loader, the topic mapper and the option builder
// are mocked — this spec owns the hook's own caching/grouping logic, not theirs.

const getMergedSyllabi = vi.fn()
const syllabiToKbTopics = vi.fn()
const buildSubjectOptions = vi.fn((grade, subjects) => ({ grade, subjects }))
const subjectValuesOf = vi.fn(() => new Set(['math']))

vi.mock('../utils/syllabusKbService', () => ({ getMergedSyllabi: (...a) => getMergedSyllabi(...a) }))
vi.mock('../utils/syllabusMapping', () => ({ syllabiToKbTopics: (...a) => syllabiToKbTopics(...a) }))
vi.mock('../curriculum/resolvers/curriculumOptions', () => ({
  buildSubjectOptions: (...a) => buildSubjectOptions(...a),
  subjectValuesOf: (...a) => subjectValuesOf(...a),
}))
vi.mock('../config/teacherTaxonomy', () => ({ TEACHER_GRADES: ['Grade 7', 'Grade 8', 'Grade 9'] }))

import {
  useCurriculumOptions,
  loadCurriculumIndex,
  invalidateCurriculumIndex,
} from './useCurriculumOptions.js'

beforeEach(() => {
  getMergedSyllabi.mockReset().mockResolvedValue({ any: 'payload' })
  syllabiToKbTopics.mockReset()
  buildSubjectOptions.mockClear()
  subjectValuesOf.mockClear()
  invalidateCurriculumIndex() // wipe module-scope cache between tests
})

describe('loadCurriculumIndex', () => {
  it('groups subjects by grade, skipping topics missing a grade or subject', async () => {
    syllabiToKbTopics.mockReturnValue([
      { grade: 'Grade 7', subject: 'math' },
      { grade: 'Grade 7', subject: 'english' },
      { grade: 'Grade 8', subject: 'science' },
      { grade: 'Grade 7', subject: 'math' }, // duplicate → deduped by the Set
      { grade: '', subject: 'civics' }, // no grade → skipped
      { grade: 'Grade 9' }, // no subject → skipped
    ])

    const index = await loadCurriculumIndex()
    expect([...index.subjectsByGrade.get('Grade 7')]).toEqual(['math', 'english'])
    expect([...index.subjectsByGrade.get('Grade 8')]).toEqual(['science'])
    expect(index.subjectsByGrade.has('Grade 9')).toBe(false)
    expect([...index.grades]).toEqual(['Grade 7', 'Grade 8'])
  })

  it('caches the index — a second call does not re-fetch the syllabi', async () => {
    syllabiToKbTopics.mockReturnValue([{ grade: 'Grade 7', subject: 'math' }])
    const first = await loadCurriculumIndex()
    const second = await loadCurriculumIndex()
    expect(second).toBe(first)
    expect(getMergedSyllabi).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent loads onto a single in-flight fetch', async () => {
    syllabiToKbTopics.mockReturnValue([{ grade: 'Grade 7', subject: 'math' }])
    const [a, b] = await Promise.all([loadCurriculumIndex(), loadCurriculumIndex()])
    expect(a).toBe(b)
    expect(getMergedSyllabi).toHaveBeenCalledTimes(1)
  })

  it('force:true rebuilds even when a cache exists', async () => {
    syllabiToKbTopics.mockReturnValue([{ grade: 'Grade 7', subject: 'math' }])
    await loadCurriculumIndex()
    await loadCurriculumIndex({ force: true })
    expect(getMergedSyllabi).toHaveBeenCalledTimes(2)
  })

  it('falls back to an empty index when the syllabi load throws', async () => {
    getMergedSyllabi.mockRejectedValue(new Error('offline'))
    const index = await loadCurriculumIndex()
    expect(index.subjectsByGrade.size).toBe(0)
    expect(index.grades.size).toBe(0)
  })

  it('falls back to an empty index but does NOT latch it — the next call retries and self-heals', async () => {
    // First load fails (offline / transient blip): the caller gets an empty
    // index rather than a thrown error.
    getMergedSyllabi.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ any: 'payload' })
    syllabiToKbTopics.mockReturnValue([{ grade: 'Grade 7', subject: 'math' }])

    const failed = await loadCurriculumIndex()
    expect(failed.subjectsByGrade.size).toBe(0)

    // The empty fallback was NOT cached — the very next call re-reads the
    // syllabi and returns real data instead of serving the latched empty index.
    const recovered = await loadCurriculumIndex()
    expect([...recovered.subjectsByGrade.get('Grade 7')]).toEqual(['math'])
    expect(getMergedSyllabi).toHaveBeenCalledTimes(2)
  })

  it('invalidateCurriculumIndex forces the next call to re-fetch', async () => {
    syllabiToKbTopics.mockReturnValue([{ grade: 'Grade 7', subject: 'math' }])
    await loadCurriculumIndex()
    invalidateCurriculumIndex()
    await loadCurriculumIndex()
    expect(getMergedSyllabi).toHaveBeenCalledTimes(2)
  })
})

describe('useCurriculumOptions', () => {
  it('becomes ready and feeds the grade’s subject set into buildSubjectOptions', async () => {
    syllabiToKbTopics.mockReturnValue([
      { grade: 'Grade 7', subject: 'math' },
      { grade: 'Grade 7', subject: 'english' },
    ])

    const { result } = renderHook(() => useCurriculumOptions('Grade 7'))
    await waitFor(() => expect(result.current.ready).toBe(true))

    // The grade's syllabus subjects (a Set) are passed to the option builder.
    const lastCall = buildSubjectOptions.mock.calls.at(-1)
    expect(lastCall[0]).toBe('Grade 7')
    expect([...lastCall[1]]).toEqual(['math', 'english'])
    expect(result.current.gradeOptions).toEqual(['Grade 7', 'Grade 8', 'Grade 9'])
  })

  it('passes null subjects for a grade absent from the syllabi', async () => {
    syllabiToKbTopics.mockReturnValue([{ grade: 'Grade 7', subject: 'math' }])
    const { result } = renderHook(() => useCurriculumOptions('Grade 12'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(buildSubjectOptions.mock.calls.at(-1)).toEqual(['Grade 12', null])
  })
})
