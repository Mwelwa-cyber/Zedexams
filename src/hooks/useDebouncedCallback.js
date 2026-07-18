import { useCallback, useEffect, useRef } from 'react'

/**
 * Debounces a callback rather than a value: useful when the thing being
 * delayed is an action (save, search, write) and callers need to cancel,
 * flush, or check pending state rather than just reading a lagged value.
 *
 * The returned `run` reference is stable across renders — it always reads
 * the latest `callback`/`options` via refs, so it's safe to pass to a
 * `useEffect` dependency array or an event handler without re-subscribing.
 *
 * @param {(...args: any[]) => any} callback  may be async
 * @param {number} delay  ms (default 300)
 * @param {object} [options]
 * @param {boolean} [options.leading=false]   invoke immediately on the first
 *   call of a burst, in addition to the trailing call
 * @param {boolean} [options.trailing=true]   invoke after the burst settles
 * @returns {{ run: Function, cancel: Function, flush: Function, isPending: () => boolean }}
 */
export function useDebouncedCallback(callback, delay = 300, options = {}) {
  const { leading = false, trailing = true } = options

  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const timerRef = useRef(null)
  const lastArgsRef = useRef([])
  const pendingRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      pendingRef.current = false
    }
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const invoke = useCallback((args) => {
    pendingRef.current = false
    if (!mountedRef.current) return undefined
    return callbackRef.current(...args)
  }, [])

  const cancel = useCallback(() => {
    clearTimer()
    pendingRef.current = false
  }, [clearTimer])

  const flush = useCallback(() => {
    if (!timerRef.current) return undefined
    clearTimer()
    return invoke(lastArgsRef.current)
  }, [clearTimer, invoke])

  const run = useCallback((...args) => {
    lastArgsRef.current = args
    const isFirstInBurst = !timerRef.current

    if (leading && isFirstInBurst) {
      invoke(args)
    }

    clearTimer()
    pendingRef.current = true
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (trailing) invoke(lastArgsRef.current)
      else pendingRef.current = false
    }, delay)
  }, [clearTimer, delay, invoke, leading, trailing])

  const isPending = useCallback(() => pendingRef.current, [])

  return { run, cancel, flush, isPending }
}
