import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePaginatedQuery } from './usePaginatedQuery.js'

// A page fetcher backed by an in-memory array of pages. Cursor carries a
// hidden `__idx` so the next call knows which page to return — mirroring how a
// real Firestore fetcher hands back the last doc snapshot as the cursor.
function makePagedFetcher(pages) {
  const fn = vi.fn(async ({ cursor }) => {
    const idx = cursor?.__idx ?? 0
    const page = pages[idx] || { items: [], hasNextPage: false }
    const last = page.items[page.items.length - 1]
    return {
      items: page.items,
      cursor: last ? { id: last.id, __idx: idx + 1 } : cursor ?? null,
      hasNextPage: Boolean(page.hasNextPage),
    }
  })
  return fn
}

function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

describe('usePaginatedQuery', () => {
  it('loads the first page once on mount', async () => {
    const fetchPage = makePagedFetcher([{ items: [{ id: 'a' }, { id: 'b' }], hasNextPage: true }])
    const { result } = renderHook(() => usePaginatedQuery({ queryKey: 'k1', fetchPage, pageSize: 10 }))

    await waitFor(() => expect(result.current.isInitialLoading).toBe(false))
    expect(result.current.items.map((x) => x.id)).toEqual(['a', 'b'])
    expect(result.current.hasNextPage).toBe(true)
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('appends the next page and stops at end-of-results', async () => {
    const fetchPage = makePagedFetcher([
      { items: [{ id: 'a' }, { id: 'b' }], hasNextPage: true },
      { items: [{ id: 'c' }], hasNextPage: false },
    ])
    const { result } = renderHook(() => usePaginatedQuery({ queryKey: 'k2', fetchPage, pageSize: 10 }))
    await waitFor(() => expect(result.current.items).toHaveLength(2))

    await act(async () => { await result.current.loadNextPage() })
    expect(result.current.items.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(result.current.hasNextPage).toBe(false)
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('blocks duplicate concurrent next-page requests for the same cursor', async () => {
    const first = { items: [{ id: 'a' }], hasNextPage: true }
    const d = deferred()
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: first.items, cursor: { id: 'a', __idx: 1 }, hasNextPage: true })
      .mockImplementationOnce(() => d.promise)

    const { result } = renderHook(() => usePaginatedQuery({ queryKey: 'k3', fetchPage, pageSize: 10 }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    // Fire the next page twice before it resolves — only one read should go out.
    act(() => { result.current.loadNextPage(); result.current.loadNextPage() })
    await act(async () => {
      d.resolve({ items: [{ id: 'b' }], cursor: { id: 'b', __idx: 2 }, hasNextPage: false })
    })

    expect(fetchPage).toHaveBeenCalledTimes(2) // 1 initial + 1 next (not 3)
    expect(result.current.items.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('de-duplicates a record that reappears on a later page', async () => {
    const fetchPage = makePagedFetcher([
      { items: [{ id: 'a' }, { id: 'b' }], hasNextPage: true },
      { items: [{ id: 'b' }, { id: 'c' }], hasNextPage: false }, // b moved / re-surfaced
    ])
    const { result } = renderHook(() => usePaginatedQuery({ queryKey: 'k4', fetchPage, pageSize: 10 }))
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    await act(async () => { await result.current.loadNextPage() })

    expect(result.current.items.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('resets to the first page when the query key changes (filter/sort/search change)', async () => {
    const fetchA = makePagedFetcher([{ items: [{ id: 'a1' }], hasNextPage: true }])
    const fetchB = makePagedFetcher([{ items: [{ id: 'b1' }], hasNextPage: false }])
    const { result, rerender } = renderHook(
      ({ queryKey, fetchPage }) => usePaginatedQuery({ queryKey, fetchPage, pageSize: 10 }),
      { initialProps: { queryKey: 'A', fetchPage: fetchA } },
    )
    await waitFor(() => expect(result.current.items.map((x) => x.id)).toEqual(['a1']))

    rerender({ queryKey: 'B', fetchPage: fetchB })
    await waitFor(() => expect(result.current.items.map((x) => x.id)).toEqual(['b1']))
    expect(result.current.hasNextPage).toBe(false)
  })

  it('drops a stale response from a previous query key (never merges into the new query)', async () => {
    const dA = deferred()
    const dB = deferred()
    const fetchA = vi.fn(() => dA.promise)
    const fetchB = vi.fn(() => dB.promise)
    const { result, rerender } = renderHook(
      ({ queryKey, fetchPage }) => usePaginatedQuery({ queryKey, fetchPage, pageSize: 10 }),
      { initialProps: { queryKey: 'A', fetchPage: fetchA } },
    )

    // Switch to B while A's first page is still in flight.
    rerender({ queryKey: 'B', fetchPage: fetchB })

    // A resolves LATE — must be ignored.
    await act(async () => { dA.resolve({ items: [{ id: 'a1' }], cursor: { id: 'a1' }, hasNextPage: true }) })
    await act(async () => { dB.resolve({ items: [{ id: 'b1' }], cursor: { id: 'b1' }, hasNextPage: false }) })

    expect(result.current.items.map((x) => x.id)).toEqual(['b1'])
  })

  it('ignores a response that resolves after unmount', async () => {
    const d = deferred()
    const fetchPage = vi.fn(() => d.promise)
    const { result, unmount } = renderHook(() => usePaginatedQuery({ queryKey: 'k5', fetchPage, pageSize: 10 }))
    unmount()
    // Resolving after unmount must not throw or warn (no setState on gone component).
    await act(async () => { d.resolve({ items: [{ id: 'a' }], cursor: { id: 'a' }, hasNextPage: false }) })
    expect(result.current.items).toEqual([])
  })

  it('refresh reloads the first page without duplicating rows', async () => {
    const fetchPage = makePagedFetcher([{ items: [{ id: 'a' }, { id: 'b' }], hasNextPage: false }])
    const { result } = renderHook(() => usePaginatedQuery({ queryKey: 'k6', fetchPage, pageSize: 10 }))
    await waitFor(() => expect(result.current.items).toHaveLength(2))

    await act(async () => { await result.current.refresh() })
    expect(result.current.items.map((x) => x.id)).toEqual(['a', 'b']) // not doubled
  })

  it('keeps existing items and surfaces the error when a next page fails', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: 'a' }], cursor: { id: 'a', __idx: 1 }, hasNextPage: true })
      .mockRejectedValueOnce(new Error('network'))

    const { result } = renderHook(() => usePaginatedQuery({ queryKey: 'k7', fetchPage, pageSize: 10 }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => { await result.current.loadNextPage() })
    expect(result.current.items.map((x) => x.id)).toEqual(['a']) // list preserved
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('removeItem drops a deleted record locally', async () => {
    const fetchPage = makePagedFetcher([{ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], hasNextPage: false }])
    const { result } = renderHook(() => usePaginatedQuery({ queryKey: 'k8', fetchPage, pageSize: 10 }))
    await waitFor(() => expect(result.current.items).toHaveLength(3))

    act(() => { result.current.removeItem('b') })
    expect(result.current.items.map((x) => x.id)).toEqual(['a', 'c'])
  })

  it('removeItem also drops the record from the stored pages (keeps items/pages consistent)', async () => {
    const fetchPage = makePagedFetcher([
      { items: [{ id: 'a' }, { id: 'b' }], hasNextPage: true },
      { items: [{ id: 'c' }, { id: 'd' }], hasNextPage: false },
    ])
    const { result } = renderHook(() => usePaginatedQuery({ queryKey: 'k8b', fetchPage, pageSize: 10 }))
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    await act(async () => { await result.current.loadNextPage() })
    expect(result.current.pages).toHaveLength(2)

    act(() => { result.current.removeItem('c') })
    expect(result.current.items.map((x) => x.id)).toEqual(['a', 'b', 'd'])
    // The record must be gone from the per-page view too, not just `items`.
    const pageIds = result.current.pages.flatMap((p) => p.items.map((x) => x.id))
    expect(pageIds).toEqual(['a', 'b', 'd'])
  })

  it('a stale next-page response never overwrites a refresh that superseded it', async () => {
    const dNext = deferred()
    const dRefresh = deferred()
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: 'a' }], cursor: { id: 'a', __idx: 1 }, hasNextPage: true }) // initial
      .mockImplementationOnce(() => dNext.promise) // loadNextPage
      .mockImplementationOnce(() => dRefresh.promise) // refresh

    const { result } = renderHook(() => usePaginatedQuery({ queryKey: 'kgen', fetchPage, pageSize: 10 }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    // A next-page and a refresh are in flight at the same time — same query key,
    // so only the request generation can tell them apart.
    act(() => { result.current.loadNextPage() })
    act(() => { result.current.refresh() })

    // The refresh resolves first: fresh page 1, end-of-results.
    await act(async () => { dRefresh.resolve({ items: [{ id: 'a' }], cursor: { id: 'a', __idx: 1 }, hasNextPage: false }) })
    // The older next-page resolves LATE and must be dropped — not appended, and
    // it must not resurrect hasNextPage over the refreshed state.
    await act(async () => { dNext.resolve({ items: [{ id: 'b' }], cursor: { id: 'b', __idx: 2 }, hasNextPage: true }) })

    expect(result.current.items.map((x) => x.id)).toEqual(['a'])
    expect(result.current.hasNextPage).toBe(false)
  })

  it('does not fetch while disabled and loads once enabled', async () => {
    const fetchPage = makePagedFetcher([{ items: [{ id: 'a' }], hasNextPage: false }])
    const { result, rerender } = renderHook(
      ({ enabled }) => usePaginatedQuery({ queryKey: 'k9', fetchPage, pageSize: 10, enabled }),
      { initialProps: { enabled: false } },
    )
    expect(fetchPage).not.toHaveBeenCalled()
    expect(result.current.isInitialLoading).toBe(false)

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})
