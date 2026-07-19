/**
 * usePaginatedQuery — the shared cursor-pagination engine (Prompt 16 §5).
 *
 * One hook for every growing list in the app. It loads a small first page,
 * shows it immediately, and loads further pages only when asked — never
 * downloading a whole collection to slice it client-side. It owns:
 *
 *   - initial load vs. next-page load as SEPARATE states, so loading page 2
 *     never blanks page 1 (§8)
 *   - request de-duplication: two triggers reading the same (queryKey, cursor)
 *     share one in-flight promise — covers double-clicks, re-renders, and
 *     React Strict Mode's double-invoke (§13)
 *   - stale-response protection: a page whose queryKey is no longer active
 *     when it resolves is dropped, never merged into the new query (§14)
 *   - duplicate removal by canonical id when merging pages (§12)
 *   - reset-on-change: when `queryKey` changes (filter / sort / search / tenant)
 *     the session resets — cursor cleared, pages dropped, fresh first page (§6/§11)
 *   - end-of-results detection from the fetcher's `hasNextPage` (§7), never
 *     from a total collection count
 *   - optional short-lived page caching, keyed per (scope, queryKey, cursor) (§15)
 *   - unmount safety — a late resolve never setStates a gone component
 *
 * The caller supplies `fetchPage({ pageSize, cursor })` — typically built by
 * `createFirestorePageFetcher` — returning `{ items, cursor, hasNextPage }`.
 * The hook stays storage-agnostic: `fetchPage` could hit a callable, a REST
 * cursor endpoint, or a local array just as well.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useIsMounted } from './useIsMounted.js'
import { DEFAULT_PAGE_SIZE, clampPageSize, mergeUniqueItems, removeById, pageRequestKey } from '../utils/pagination/cursors.js'
import { fetchPageCached } from '../utils/pagination/pageCache.js'

const INITIAL = {
  items: [],
  pages: [],
  hasNextPage: false,
  isInitialLoading: false,
  isLoadingNextPage: false,
  isRefreshing: false,
  error: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'reset':
      return { ...INITIAL, isInitialLoading: action.enabled }
    case 'disabled':
      return { ...INITIAL }
    case 'loading':
      // Separate flags: a next-page or refresh load keeps existing items visible.
      if (action.mode === 'next') return { ...state, isLoadingNextPage: true, error: null }
      if (action.mode === 'refresh') return { ...state, isRefreshing: true, error: null }
      return { ...state, isInitialLoading: state.items.length === 0, error: null }
    case 'page': {
      const base = action.append ? state.items : []
      const items = mergeUniqueItems(base, action.items, action.getId)
      const page = { items: action.items, cursor: action.cursor ?? null }
      const pages = action.append ? [...state.pages, page] : [page]
      return {
        items,
        pages,
        hasNextPage: action.hasNextPage,
        isInitialLoading: false,
        isLoadingNextPage: false,
        isRefreshing: false,
        error: null,
      }
    }
    case 'error':
      // Keep whatever we already have — a failed next page must not wipe the list (§37).
      return { ...state, isInitialLoading: false, isLoadingNextPage: false, isRefreshing: false, error: action.error }
    case 'removeItem': {
      // Drop the record from BOTH representations the hook exposes — the
      // flattened `items` and the per-page `pages` — so a caller rendering
      // pages (or computing page-level metadata) never keeps showing a record
      // `items` already reports as gone (§19).
      const pages = state.pages.map((p) => {
        const filtered = removeById(p.items, action.id, action.getId)
        return filtered.length === p.items.length ? p : { ...p, items: filtered }
      })
      return { ...state, items: removeById(state.items, action.id, action.getId), pages }
    }
    default:
      return state
  }
}

/**
 * @param {object} config
 * @param {string} config.queryKey stable session key (see createPaginationKey) — changing it resets pagination
 * @param {(args: { pageSize: number, cursor: any }) => Promise<{ items: any[], cursor: any, hasNextPage: boolean }>} config.fetchPage
 * @param {number} [config.pageSize]
 * @param {boolean} [config.enabled] skip loading while false (e.g. waiting for auth) — defaults true
 * @param {(item: any) => (string|number|undefined)} [config.getId] id accessor for de-dup (defaults to `item.id`)
 * @param {string} [config.scope] enables page caching under this scope when `cachePages` is set
 * @param {boolean} [config.cachePages] cache completed pages (short TTL) — default false
 * @param {number} [config.cacheTtlMs]
 */
export function usePaginatedQuery({
  queryKey,
  fetchPage,
  pageSize = DEFAULT_PAGE_SIZE,
  enabled = true,
  getId,
  scope,
  cachePages = false,
  cacheTtlMs,
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const isMounted = useIsMounted()

  const clamped = clampPageSize(pageSize)

  // Latest-value refs so the loader closure never goes stale and changing
  // fetchPage/getId doesn't re-fire the load effect.
  const fetchPageRef = useRef(fetchPage); fetchPageRef.current = fetchPage
  const getIdRef = useRef(getId); getIdRef.current = getId

  // The query key a resolving request must still match to be applied (§14).
  const activeKeyRef = useRef(queryKey)
  // Cursor of the last loaded page; null = start.
  const cursorRef = useRef(null)
  // Whether another page may exist — the next-page guard reads this, not a count.
  const hasNextRef = useRef(true)
  // pageRequestKey -> in-flight promise, for request de-dup (§13).
  const inflightRef = useRef(new Map())
  // Monotonic request generation. A refresh or a fresh first page opens a NEW
  // generation; a next-page continues the current one. The stale-response guard
  // checks this in ADDITION to the query key, because a refresh and an
  // overlapping next-page share the same query key — key equality alone can't
  // tell them apart, so without a generation an older next-page resolving after
  // a refresh would append pre-refresh-cursor data over the refreshed
  // cursor/hasNextPage state (and an A→B→A toggle could re-admit the original A
  // response into the new A session). The generation is folded into the
  // in-flight lock key so Strict Mode's double-invoke of the load effect still
  // collapses to a single read (the second invoke sees the first's bump).
  const generationRef = useRef(0)

  const loadPage = useCallback((mode) => {
    if (!enabled || typeof fetchPageRef.current !== 'function') return undefined
    const append = mode === 'next'
    if (append && !hasNextRef.current) return undefined // already at the end

    const requestKey = activeKeyRef.current
    const cursor = append ? cursorRef.current : null
    const baseKey = pageRequestKey(requestKey, cursor)
    const startsNewGeneration = mode !== 'next'

    // Dedup against the CURRENT generation first — a concurrent duplicate (a
    // double-click, or Strict Mode's second effect-invoke) has already bumped
    // the generation, so it lands on this same key and joins, never re-reads.
    const existing = inflightRef.current.get(`${baseKey}::g${generationRef.current}`)
    if (existing) return existing

    if (startsNewGeneration) generationRef.current += 1
    const generation = generationRef.current
    const lockKey = `${baseKey}::g${generation}`

    dispatch({ type: 'loading', mode })

    // A response is applied only if the component is still mounted, the query key
    // still matches, AND no newer generation has superseded this request.
    const isCurrent = () => isMounted.current
      && activeKeyRef.current === requestKey
      && generationRef.current === generation

    const run = (async () => {
      try {
        const call = () => fetchPageRef.current({ pageSize: clamped, cursor })
        const result = cachePages && scope
          ? await fetchPageCached(scope, requestKey, cursor, call, { ttlMs: cacheTtlMs, bypass: mode === 'refresh' })
          : await call()

        // Stale-response + unmount guards — a page from an abandoned query key,
        // a superseded generation, or a gone component is dropped (§14).
        if (!isCurrent()) return

        cursorRef.current = result?.cursor ?? cursorRef.current
        hasNextRef.current = Boolean(result?.hasNextPage)
        dispatch({
          type: 'page',
          append,
          items: result?.items || [],
          cursor: result?.cursor ?? null,
          hasNextPage: hasNextRef.current,
          getId: getIdRef.current,
        })
      } catch (error) {
        if (!isCurrent()) return
        dispatch({ type: 'error', error })
      } finally {
        inflightRef.current.delete(lockKey)
      }
    })()

    inflightRef.current.set(lockKey, run)
    return run
    // clamped/enabled/scope/cachePages/cacheTtlMs are the only real inputs; the
    // rest are refs. isMounted is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, clamped, scope, cachePages, cacheTtlMs])

  // Session reset whenever the query key (or enabled) changes: clear cursor +
  // pages and load a fresh first page. Old in-flight reads are NOT force-
  // cleared — they self-remove in `finally`, and their results are dropped by
  // the activeKeyRef check — which also keeps Strict Mode's double-invoke to a
  // single Firestore read (the second invoke joins the first's in-flight lock).
  useEffect(() => {
    activeKeyRef.current = queryKey
    cursorRef.current = null
    hasNextRef.current = true
    if (!enabled) {
      dispatch({ type: 'disabled' })
      return undefined
    }
    dispatch({ type: 'reset', enabled: true })
    loadPage('initial')
    return undefined
    // loadPage is stable except for enabled/clamped/scope/cache — all of which
    // also belong in this reset. queryKey drives the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, enabled, clamped, scope, cachePages, cacheTtlMs])

  const loadNextPage = useCallback(() => loadPage('next'), [loadPage])
  const refresh = useCallback(() => loadPage('refresh'), [loadPage])
  const reset = useCallback(() => {
    cursorRef.current = null
    hasNextRef.current = true
    dispatch({ type: 'reset', enabled })
    return loadPage('initial')
  }, [loadPage, enabled])

  // Optimistically drop a locally-deleted record without a refetch (§19).
  const removeItem = useCallback((id) => {
    dispatch({ type: 'removeItem', id, getId: getIdRef.current })
  }, [])

  return {
    items: state.items,
    pages: state.pages,
    hasNextPage: state.hasNextPage,
    isInitialLoading: state.isInitialLoading,
    isLoadingNextPage: state.isLoadingNextPage,
    isRefreshing: state.isRefreshing,
    error: state.error,
    loadNextPage,
    refresh,
    reset,
    removeItem,
    isEmpty: !state.isInitialLoading && state.items.length === 0,
  }
}
