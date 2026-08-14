import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLearnerSearch } from './useLearnerSearch.js'
import { __resetRequestDeduplicationForTests } from '../utils/requestDeduplication.js'

// This hook fans out to 4 content sources, ranks the merged list
// client-side, and must protect against a slow response for a PREVIOUS
// grade landing after the learner has already switched grades. The sources
// + ranking utils are mocked; this spec owns the hook's own fetch/staleness
// logic, not theirs.

const getQuizzes = vi.fn()
const fetchLearnerNotes = vi.fn()
const loadPublishedPapers = vi.fn()
const listGames = vi.fn()
const reportClientError = vi.fn()

vi.mock('./useFirestore', () => ({ useFirestore: () => ({ getQuizzes: (...a) => getQuizzes(...a) }) }))
vi.mock('../features/notes', () => ({ fetchLearnerNotes: (...a) => fetchLearnerNotes(...a) }))
vi.mock('../utils/pastPapers', () => ({ loadPublishedPapers: (...a) => loadPublishedPapers(...a) }))
vi.mock('../utils/gamesService', () => ({ listGames: (...a) => listGames(...a) }))
vi.mock('../utils/clientErrorReporting', () => ({ reportClientError: (...a) => reportClientError(...a) }))
vi.mock('../utils/learnerSearch', () => ({
  buildResultItems: ({ quizzes, notes, papers, games }) => [...quizzes, ...notes, ...papers, ...games],
  rankResults: (query, items) => items,
  groupByType: (items) => ({ items }),
}))

function createDeferred() {
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  __resetRequestDeduplicationForTests()
  getQuizzes.mockReset().mockResolvedValue([{ id: 'q1' }])
  fetchLearnerNotes.mockReset().mockResolvedValue([{ id: 'n1' }])
  loadPublishedPapers.mockReset().mockResolvedValue([])
  listGames.mockReset().mockResolvedValue([])
  reportClientError.mockReset()
})

describe('useLearnerSearch', () => {
  it('loads and merges all four sources for a grade', async () => {
    const { result } = renderHook(() => useLearnerSearch('', 'Grade 4'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.results).toEqual(expect.arrayContaining([{ id: 'q1' }, { id: 'n1' }]))
  })

  it('a slow response for a previous grade cannot overwrite the new grade’s results', async () => {
    const first = createDeferred()
    getQuizzes.mockReturnValueOnce(first.promise) // Grade 4's quizzes fetch never resolves during this test
    getQuizzes.mockResolvedValueOnce([{ id: 'grade5-quiz' }]) // Grade 5's fetch resolves fast

    const { result, rerender } = renderHook(
      ({ grade }) => useLearnerSearch('', grade),
      { initialProps: { grade: 'Grade 4' } },
    )

    rerender({ grade: 'Grade 5' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.results.some((r) => r.id === 'grade5-quiz')).toBe(true)

    // The stale Grade 4 fetch finally resolves — it must not replace the
    // Grade 5 results now shown.
    first.resolve([{ id: 'grade4-quiz-STALE' }])
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.results.some((r) => r.id === 'grade4-quiz-STALE')).toBe(false)
    expect(result.current.results.some((r) => r.id === 'grade5-quiz')).toBe(true)
  })

  it('two components searching the same grade at once share one fetch', async () => {
    renderHook(() => useLearnerSearch('', 'Grade 6'))
    renderHook(() => useLearnerSearch('', 'Grade 6'))
    await waitFor(() => expect(getQuizzes).toHaveBeenCalledTimes(1))
  })

  it('a rejected source is reported but does not block the other results', async () => {
    listGames.mockRejectedValueOnce(new Error('games offline'))
    const { result } = renderHook(() => useLearnerSearch('', 'Grade 7'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.results.some((r) => r.id === 'q1')).toBe(true)
    expect(reportClientError).toHaveBeenCalledWith(expect.any(Error), 'learnerSearch.source')
  })
})
