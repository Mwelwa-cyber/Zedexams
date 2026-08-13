/**
 * useCachedQuery — React data-fetching hook over the shared search/query
 * cache (src/utils/cache/searchCache.js + memoryCache.js).
 *
 * Cache-first render: if `key` is already cached, the first render returns
 * that data with `loading: false` — no spinner flash for a repeated search.
 * On a miss it fetches once (deduped against any identical in-flight
 * request), and on a stale-but-live hit it returns the stale value
 * immediately while a background refresh runs (stale-while-revalidate).
 *
 * Changing `key` (e.g. the caller switched curriculum/grade/subject — the
 * key MUST encode those, see cacheKeys.js) cancels interest in the previous
 * request: if it resolves after the key has already moved on, its result is
 * dropped instead of clobbering the new selection's state (CLAUDE.md #13.8).
 *
 * Never point this hook at money/permissions/entitlement/exam-submission/
 * attendance-lock data — those must be fetched fresh (CLAUDE.md #13.3/#13.6).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSearchCache } from '../../../utils/cache/searchCache.js'

function readCache(cache, key) {
  if (!key) return { has: false, value: undefined }
  const has = cache.has(key)
  return { has, value: has ? cache.get(key) : undefined }
}

/**
 * @param {string|null|undefined} key stable cache key, or null/undefined to skip fetching entirely
 * @param {() => Promise<any>} fetcher performs the real read (Firestore query, callable, etc.)
 * @param {object} [opts]
 * @param {import('../../../utils/cache/memoryCache.js').MemoryCache} [opts.cache] defaults to the shared `"generic-query"` scope cache
 * @param {number} [opts.ttlMs]
 * @param {number} [opts.staleAfterMs] enables stale-while-revalidate when set
 * @param {boolean} [opts.enabled] set false to skip fetching without clearing `key` (defaults true)
 * @returns {{ data: any, loading: boolean, isStale: boolean, error: any, refresh: () => Promise<any>, invalidate: () => void }}
 */
export function useCachedQuery(key, fetcher, opts = {}) {
  const { cache: cacheOverride, ttlMs, staleAfterMs, enabled = true } = opts
  const cache = useMemo(
    () => cacheOverride || getSearchCache('generic-query', { ttlMs }),
    [cacheOverride, ttlMs],
  )
  const active = Boolean(key) && enabled

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const [state, setState] = useState(() => {
    if (!active) return { data: undefined, loading: false, isStale: false, error: null }
    const { has, value } = readCache(cache, key)
    return { data: value, loading: !has, isStale: has && cache.isStale(key), error: null }
  })

  useEffect(() => {
    if (!active) {
      setState({ data: undefined, loading: false, isStale: false, error: null })
      return undefined
    }

    let alive = true
    const { has, value } = readCache(cache, key)
    setState({ data: value, loading: !has, isStale: has && cache.isStale(key), error: null })

    cache.getOrSet(key, () => fetcherRef.current(), {
      ttlMs,
      staleAfterMs,
      onFresh: (fresh) => { if (alive) setState({ data: fresh, loading: false, isStale: false, error: null }) },
    })
      .then((result) => { if (alive) setState({ data: result, loading: false, isStale: false, error: null }) })
      .catch((err) => { if (alive) setState({ data: undefined, loading: false, isStale: false, error: err }) })

    return () => { alive = false }
  }, [active, cache, key, ttlMs, staleAfterMs])

  const refresh = useCallback(() => {
    if (!key) return Promise.resolve(undefined)
    cache.delete(key)
    return cache.getOrSet(key, () => fetcherRef.current(), { ttlMs, staleAfterMs })
      .then((result) => { setState({ data: result, loading: false, isStale: false, error: null }); return result })
      .catch((err) => { setState((prev) => ({ ...prev, loading: false, error: err })); throw err })
  }, [cache, key, ttlMs, staleAfterMs])

  const invalidate = useCallback(() => {
    if (key) cache.delete(key)
  }, [cache, key])

  return { ...state, refresh, invalidate }
}
