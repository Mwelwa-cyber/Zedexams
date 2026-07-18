import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useInfiniteFirestoreQuery } from './useInfiniteFirestoreQuery.js'

// Minimal controllable IntersectionObserver stand-in — jsdom has none.
let observers = []
class MockIO {
  constructor(cb) { this.cb = cb; this.elements = new Set(); observers.push(this) }
  observe(el) { this.elements.add(el) }
  disconnect() { this.elements.clear() }
  // test helper: simulate the sentinel scrolling into view
  trigger() { this.cb([{ isIntersecting: true }]) }
}

function makePagedFetcher(pages) {
  return vi.fn(async ({ cursor }) => {
    const idx = cursor?.__idx ?? 0
    const page = pages[idx] || { items: [], hasNextPage: false }
    const last = page.items[page.items.length - 1]
    return {
      items: page.items,
      cursor: last ? { id: last.id, __idx: idx + 1 } : cursor ?? null,
      hasNextPage: Boolean(page.hasNextPage),
    }
  })
}

describe('useInfiniteFirestoreQuery', () => {
  beforeEach(() => { observers = []; global.IntersectionObserver = MockIO })
  afterEach(() => { delete global.IntersectionObserver })

  it('loads the next page when the sentinel intersects', async () => {
    const fetchPage = makePagedFetcher([
      { items: [{ id: 'a' }], hasNextPage: true },
      { items: [{ id: 'b' }], hasNextPage: false },
    ])
    const { result } = renderHook(() => useInfiniteFirestoreQuery({ queryKey: 'i1', fetchPage, pageSize: 10 }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    // Attach sentinel + fire intersection.
    act(() => { result.current.sentinelRef(document.createElement('div')) })
    await act(async () => { observers[observers.length - 1].trigger() })

    await waitFor(() => expect(result.current.items.map((x) => x.id)).toEqual(['a', 'b']))
  })

  it('does not load past the end of results on repeated intersections', async () => {
    const fetchPage = makePagedFetcher([{ items: [{ id: 'a' }], hasNextPage: false }])
    const { result } = renderHook(() => useInfiniteFirestoreQuery({ queryKey: 'i2', fetchPage, pageSize: 10 }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    act(() => { result.current.sentinelRef(document.createElement('div')) })
    await act(async () => { observers[observers.length - 1].trigger(); observers[observers.length - 1].trigger() })

    expect(fetchPage).toHaveBeenCalledTimes(1) // no next page → no extra reads
  })
})
