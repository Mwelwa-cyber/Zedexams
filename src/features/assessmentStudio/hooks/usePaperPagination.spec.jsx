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
import { PAGINATION_STATES } from '../../../utils/paperPaginationCore'

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

  it('a measurement in flight cannot restore READY during the debounce window', async () => {
    // The race the token exists for, in the order it actually happens:
    //   1. measurement A starts
    //   2. the teacher edits
    //   3. the result goes stale
    //   4. A resolves — BEFORE the debounced measurement B has begun
    //   5. A must be discarded
    // Invalidating the token when B starts instead of when the edit lands
    // leaves the whole debounce window open, and A writes a confident page
    // count for a paper that no longer exists.
    let resolveA
    const measure = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveA = r }))
      .mockImplementation(() => new Promise(() => {}))

    const { result, rerender } = renderHook((props) => usePaperPagination(props), {
      initialProps: { ...paper('first'), measure, debounceMs: 5 },
    })
    await waitFor(() => expect(measure).toHaveBeenCalledTimes(1))

    // A long debounce, so B has definitely not started when A lands.
    rerender({ ...paper('second'), measure, debounceMs: 10_000 })
    expect(result.current.status).not.toBe(PAGINATION_STATES.READY)

    await act(async () => { resolveA(ready(7)) })

    expect(measure).toHaveBeenCalledTimes(1)
    expect(result.current.status).not.toBe(PAGINATION_STATES.READY)
    expect(result.current.pageCount).not.toBe(7)
    expect(result.current.label).toBe('Calculating pages…')
  })

  it('a same-length edit still marks the count stale', async () => {
    // Length-based identity would call these the same paper. "IIII" and "WWWW"
    // are the same count of characters and about half a line apart on the page.
    const measure = vi.fn().mockResolvedValue(ready(3))
    const { result, rerender } = renderHook((props) => usePaperPagination(props), {
      initialProps: { ...paper('Which river is longest?'), measure },
    })
    await waitFor(() => expect(result.current.status).toBe(PAGINATION_STATES.READY))

    measure.mockImplementation(() => new Promise(() => {}))
    rerender({ ...paper('Which river is WWWWWWW?'), measure })
    expect(result.current.status).toBe(PAGINATION_STATES.STALE)
    expect(result.current.label).toBe('Calculating pages…')
  })

  it('measures the SAME object it fingerprints', async () => {
    // Fingerprinting passages while rendering only the questions is how an edit
    // marked the count stale and then re-measured a document without the edit.
    const measure = vi.fn().mockResolvedValue(ready(2))
    renderHook(() => usePaperPagination({
      ...paper(),
      passages: [{ localId: 'p', passageText: '<p>A story.</p>' }],
      parts: [{ id: 'P1', title: 'SECTION A' }],
      pagebreaks: ['a'],
      measure,
    }))
    await waitFor(() => expect(measure).toHaveBeenCalledTimes(1))
    const model = measure.mock.calls[0][0]
    expect(model.passages).toHaveLength(1)
    expect(model.parts).toHaveLength(1)
    expect(model.pagebreaks).toEqual(['a'])
    expect(model.mode).toBe('paper')
    expect(model.questions).toHaveLength(1)
  })

  it('a passage edit triggers a new measurement', async () => {
    const measure = vi.fn().mockResolvedValue(ready(2))
    const props = (text) => ({ ...paper(), passages: [{ localId: 'p', passageText: text }], measure })
    const { rerender } = renderHook((p) => usePaperPagination(p), { initialProps: props('<p>One.</p>') })
    await waitFor(() => expect(measure).toHaveBeenCalledTimes(1))
    rerender(props('<p>Two.</p>'))
    await waitFor(() => expect(measure).toHaveBeenCalledTimes(2))
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
