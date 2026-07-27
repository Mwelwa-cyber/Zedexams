/**
 * The page-count state machine.
 *
 * What matters here is not that a number arrives — it is that a number is never
 * on screen for a paper the teacher has already changed, and that a slow
 * measurement cannot overwrite a newer one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePaperPagination } from './usePaperPagination'
import { PAGINATION_STATES } from '../utils/paperPaginationCore'

const ready = (pageCount) => ({ status: PAGINATION_STATES.READY, pageCount, pages: [], issues: [] })

const paper = (text = 'Q1') => ({
  assessment: { title: 'Topic Test' },
  questions: [{ localId: 'a', text, marks: 2, type: 'short_answer' }],
  mode: 'paper',
  debounceMs: 5,
})

beforeEach(() => { vi.useRealTimers() })
afterEach(() => { vi.restoreAllMocks() })

describe('usePaperPagination', () => {
  it('starts by saying it is calculating, never with a number', () => {
    const measure = vi.fn().mockResolvedValue(ready(4))
    const { result } = renderHook(() => usePaperPagination({ ...paper(), measure }))
    expect(result.current.label).toBe('Calculating pages…')
    expect(result.current.pageCount).toBe(0)
  })

  it('reports the measured count, labelled as Print/PDF', async () => {
    const measure = vi.fn().mockResolvedValue(ready(4))
    const { result } = renderHook(() => usePaperPagination({ ...paper(), measure }))
    await waitFor(() => expect(result.current.status).toBe(PAGINATION_STATES.READY))
    expect(result.current.pageCount).toBe(4)
    expect(result.current.label).toBe('4 Print/PDF pages')
  })

  it('an edit invalidates the number immediately, before the new one exists', async () => {
    const measure = vi.fn().mockResolvedValue(ready(4))
    const { result, rerender } = renderHook((props) => usePaperPagination(props), {
      initialProps: { ...paper('Q1'), measure },
    })
    await waitFor(() => expect(result.current.pageCount).toBe(4))

    // The measurement for the edited paper never resolves, so the ONLY thing
    // that can clear the old number is the invalidation itself.
    measure.mockImplementation(() => new Promise(() => {}))
    rerender({ ...paper('Q1 with much more text'), measure })

    expect(result.current.label).toBe('Calculating pages…')
    expect(result.current.status).not.toBe(PAGINATION_STATES.READY)
  })

  it('typing measures once, not once per keystroke', async () => {
    const measure = vi.fn().mockResolvedValue(ready(2))
    const { rerender } = renderHook((props) => usePaperPagination(props), {
      initialProps: { ...paper('a'), measure, debounceMs: 40 },
    })
    for (const text of ['ab', 'abc', 'abcd', 'abcde']) {
      rerender({ ...paper(text), measure, debounceMs: 40 })
    }
    await new Promise((r) => setTimeout(r, 120))
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it('a slow measurement cannot overwrite a newer one', async () => {
    // The first call resolves LAST. Without the in-flight guard it would land
    // on top of the newer answer and show a count for a paper that is gone.
    let resolveFirst
    const measure = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValue(ready(9))

    const { result, rerender } = renderHook((props) => usePaperPagination(props), {
      initialProps: { ...paper('first'), measure },
    })
    await waitFor(() => expect(measure).toHaveBeenCalledTimes(1))
    rerender({ ...paper('second'), measure })
    await waitFor(() => expect(result.current.pageCount).toBe(9))

    await act(async () => { resolveFirst(ready(1)) })
    expect(result.current.pageCount).toBe(9)
  })

  it('a failed measurement says so rather than falling back to a guess', async () => {
    const measure = vi.fn().mockRejectedValue(new Error('iframe blocked'))
    const { result } = renderHook(() => usePaperPagination({ ...paper(), measure }))
    await waitFor(() => expect(result.current.status).toBe(PAGINATION_STATES.FAILED))
    expect(result.current.label).toBe('Page count unavailable')
    expect(result.current.pageCount).toBe(0)
  })

  it('does nothing at all when disabled', async () => {
    const measure = vi.fn().mockResolvedValue(ready(3))
    const { result } = renderHook(() => usePaperPagination({ ...paper(), measure, enabled: false }))
    await new Promise((r) => setTimeout(r, 40))
    expect(measure).not.toHaveBeenCalled()
    expect(result.current.status).toBe(PAGINATION_STATES.IDLE)
  })

  it('an edit that cannot change the printed page does not remeasure', async () => {
    const measure = vi.fn().mockResolvedValue(ready(2))
    const props = { ...paper('Q1'), measure }
    const { rerender } = renderHook((p) => usePaperPagination(p), { initialProps: props })
    await waitFor(() => expect(measure).toHaveBeenCalledTimes(1))
    // Same paper, new object identities — a re-render, not an edit.
    rerender({ ...paper('Q1'), measure })
    await new Promise((r) => setTimeout(r, 40))
    expect(measure).toHaveBeenCalledTimes(1)
  })
})
