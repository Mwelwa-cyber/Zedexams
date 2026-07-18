import { useCallback, useEffect, useRef } from 'react'

/**
 * Sequence-number based staleness guard for async work that can't be
 * physically cancelled (most Firestore reads, and anything else that
 * doesn't accept an AbortSignal). Call `next()` when a request starts to
 * get a token; before applying its result, check `isCurrent(token)` — it's
 * only true if no newer request has started AND the component is still
 * mounted.
 *
 * Pairs with `useAbortableRequest` for operations that DO support
 * AbortController — use that one instead when the underlying call can
 * actually be cancelled; use this one as the fallback/backstop when it
 * can't (per the "stale-response protection" requirement: cancellation
 * signals a request to stop, sequence numbers guarantee an old result can
 * never win even if it finishes anyway).
 *
 * @example
 *   const { next, isCurrent } = useLatestRequest()
 *   async function runSearch(query) {
 *     const token = next()
 *     const results = await searchData(query) // not abortable
 *     if (!isCurrent(token)) return // a newer search (or unmount) won
 *     setResults(results)
 *   }
 */
export function useLatestRequest() {
  const seqRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const next = useCallback(() => {
    seqRef.current += 1
    return seqRef.current
  }, [])

  const isCurrent = useCallback((token) => (
    mountedRef.current && token === seqRef.current
  ), [])

  // Bump the sequence without minting a new token — invalidates every
  // outstanding request without starting a replacement (e.g. the user
  // cleared a filter and there's nothing new to wait for yet).
  const invalidate = useCallback(() => {
    seqRef.current += 1
  }, [])

  return { next, isCurrent, invalidate }
}
