import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useCachedQuery } from './useCachedQuery.js'
import { MemoryCache } from '../../../utils/cache/memoryCache.js'

// useCachedQuery is the React-facing layer over the shared search/query cache
// (searchCache.js + memoryCache.js) — this exercises the guarantees that
// matter most to a caller: no spinner flash on a warm cache, exactly one
// network call per key, and stale responses from an abandoned key never
// clobbering the current selection's state (CLAUDE.md #13.8).

function fakeClock(start = 0) {
  let t = start
  const now = () => t
  now.advance = (ms) => { t += ms }
  return now
}

describe('useCachedQuery', () => {
  it('a cache miss performs exactly one fetch and lands the result', async () => {
    const cache = new MemoryCache({ now: fakeClock() })
    const fetcher = vi.fn().mockResolvedValue(['Mathematics'])

    const { result } = renderHook(() => useCachedQuery('k1', fetcher, { cache }))
    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(['Mathematics'])
    expect(result.current.error).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('a fresh cache hit renders with data immediately and never calls the fetcher', async () => {
    const cache = new MemoryCache({ now: fakeClock() })
    cache.set('k1', ['cached-subjects'])
    const fetcher = vi.fn().mockResolvedValue(['network-subjects'])

    const { result } = renderHook(() => useCachedQuery('k1', fetcher, { cache }))
    // First render already reflects the cached value — no loading flash.
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toEqual(['cached-subjects'])

    await waitFor(() => expect(fetcher).not.toHaveBeenCalled())
  })

  it('two hooks requesting the same key at once share one fetch (dedup)', async () => {
    const cache = new MemoryCache({ now: fakeClock() })
    let resolveFetch
    const fetcher = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))

    const { result: r1 } = renderHook(() => useCachedQuery('shared', fetcher, { cache }))
    const { result: r2 } = renderHook(() => useCachedQuery('shared', fetcher, { cache }))

    await act(async () => { await Promise.resolve() })
    resolveFetch(['dedup-result'])

    await waitFor(() => expect(r1.current.loading).toBe(false))
    await waitFor(() => expect(r2.current.loading).toBe(false))
    expect(r1.current.data).toEqual(['dedup-result'])
    expect(r2.current.data).toEqual(['dedup-result'])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('a null key skips fetching entirely', () => {
    const cache = new MemoryCache({ now: fakeClock() })
    const fetcher = vi.fn()
    const { result } = renderHook(() => useCachedQuery(null, fetcher, { cache }))
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('switching to a new key ignores a stale response from the abandoned key', async () => {
    const cache = new MemoryCache({ now: fakeClock() })
    let resolveOld
    const fetchOld = vi.fn(() => new Promise((resolve) => { resolveOld = resolve }))
    const fetchNew = vi.fn().mockResolvedValue(['grade-8-subjects'])

    const { result, rerender } = renderHook(
      ({ key, fetcher }) => useCachedQuery(key, fetcher, { cache }),
      { initialProps: { key: 'grade-7', fetcher: fetchOld } },
    )
    expect(result.current.loading).toBe(true)
    // Let the grade-7 fetch actually start (getOrSet invokes it a microtask
    // later) so `resolveOld` below is guaranteed to be assigned.
    await waitFor(() => expect(fetchOld).toHaveBeenCalledTimes(1))

    // Switch curriculum selection before the old request resolves.
    rerender({ key: 'grade-8', fetcher: fetchNew })
    await waitFor(() => expect(result.current.data).toEqual(['grade-8-subjects']))

    // The old (grade-7) request finally resolves — it must not clobber grade-8's state.
    resolveOld(['grade-7-subjects'])
    await act(async () => { await Promise.resolve() })
    expect(result.current.data).toEqual(['grade-8-subjects'])
  })

  it('refresh() bypasses the cache and re-fetches', async () => {
    const cache = new MemoryCache({ now: fakeClock() })
    const fetcher = vi.fn().mockResolvedValueOnce(['v1']).mockResolvedValueOnce(['v2'])

    const { result } = renderHook(() => useCachedQuery('k1', fetcher, { cache }))
    await waitFor(() => expect(result.current.data).toEqual(['v1']))

    await act(async () => { await result.current.refresh() })
    expect(result.current.data).toEqual(['v2'])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('a rejected fetch surfaces the error, and refresh() retries instead of replaying the failure', async () => {
    const cache = new MemoryCache({ now: fakeClock() })
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(['recovered'])

    const { result } = renderHook(() => useCachedQuery('k1', fetcher, { cache }))
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.data).toBeUndefined()
    expect(cache.has('k1')).toBe(false) // the failure was never cached as a valid result

    await act(async () => { await result.current.refresh() })
    expect(result.current.data).toEqual(['recovered'])
    expect(result.current.error).toBeNull()
  })
})
