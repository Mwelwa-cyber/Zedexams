/**
 * useInfiniteFirestoreQuery — usePaginatedQuery plus an IntersectionObserver
 * sentinel for infinite scrolling (Prompt 16 §9).
 *
 * Returns everything usePaginatedQuery does, plus a `sentinelRef` to attach to
 * a small element at the bottom of the list. When that element scrolls into
 * view AND there's a next page AND nothing is already loading, it calls
 * `loadNextPage` exactly once per intersection — the "already loading" guard
 * plus usePaginatedQuery's own request-dedup mean a fast scroll can't fire a
 * burst of overlapping reads (§9: "Prevent repeated observer triggers", "Do
 * not load if a request is already active").
 *
 * `autoLoad` (default true) can be turned off so the observer is inert and the
 * caller drives paging with an explicit "Load more" button instead — the
 * manual fallback the accessibility guidance requires (§9/§36). The button and
 * the observer can coexist: both call the same idempotent `loadNextPage`.
 */

import { useCallback, useEffect, useRef } from 'react'
import { usePaginatedQuery } from './usePaginatedQuery.js'

/**
 * @param {object} config same as usePaginatedQuery, plus:
 * @param {boolean} [config.autoLoad] auto-load on intersection (default true)
 * @param {string} [config.rootMargin] IntersectionObserver rootMargin (default '200px' — prefetch just before the sentinel is visible)
 */
export function useInfiniteFirestoreQuery(config) {
  const { autoLoad = true, rootMargin = '200px', ...paginationConfig } = config
  const pagination = usePaginatedQuery(paginationConfig)

  const { loadNextPage, hasNextPage, isLoadingNextPage, isInitialLoading } = pagination

  // Latest flags in a ref so the observer callback (created once) reads current
  // values without re-subscribing on every render.
  const stateRef = useRef({ hasNextPage, isLoadingNextPage, isInitialLoading })
  stateRef.current = { hasNextPage, isLoadingNextPage, isInitialLoading }

  const sentinelRef = useRef(null)
  const observerRef = useRef(null)

  const attach = useCallback((node) => {
    sentinelRef.current = node
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    if (!node || !autoLoad) return
    if (typeof IntersectionObserver === 'undefined') return // SSR / very old browser — button fallback covers it

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (!entry?.isIntersecting) return
      const s = stateRef.current
      // The trifecta of guards: something to load, nothing loading, not still
      // on the very first page.
      if (s.hasNextPage && !s.isLoadingNextPage && !s.isInitialLoading) {
        loadNextPage()
      }
    }, { rootMargin })

    observer.observe(node)
    observerRef.current = observer
  }, [autoLoad, rootMargin, loadNextPage])

  useEffect(() => () => {
    if (observerRef.current) observerRef.current.disconnect()
  }, [])

  return { ...pagination, sentinelRef: attach }
}
