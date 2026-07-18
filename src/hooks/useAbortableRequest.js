import { useCallback, useEffect, useRef } from 'react'
import { classifyError, createRequestError, isAbortError, REQUEST_ERROR_CODES, withTimeout } from '../utils/requestControl.js'

/**
 * AbortController-backed request runner: automatically cancels the
 * previous call when `run()` fires again (dependency changed, user
 * retyped, etc.) and on unmount, and reports a structured status instead
 * of ever letting a stale result touch state.
 *
 * `run(executor, opts)` returns one of:
 *   { status: 'success', data }  — this IS the latest call; safe to apply
 *   { status: 'stale' }          — a newer call (or unmount) beat it; DROP silently
 *   { status: 'aborted', error } — this call itself was cancelled; DROP silently
 *   { status: 'error', error }   — a real failure on the still-current call
 *
 * Only 'success' and 'error' should ever update visible state — 'stale' and
 * 'aborted' are exactly the cases the task calls out as "usually shouldn't
 * show an error", so callers can simply ignore them.
 *
 * @example
 *   const { run, cancel } = useAbortableRequest({ timeoutMs: 10_000 })
 *   useEffect(() => {
 *     setLoading(true)
 *     run(({ signal }) => fetchSubjects(grade, { signal })).then((result) => {
 *       if (result.status === 'success') { setSubjects(result.data); setLoading(false) }
 *       else if (result.status === 'error') { setError(result.error); setLoading(false) }
 *       // 'stale' / 'aborted' → do nothing; the request that superseded this
 *       // one owns the loading/error state now.
 *     })
 *     return cancel
 *   }, [grade, run, cancel])
 */
export function useAbortableRequest(defaultOptions = {}) {
  const controllerRef = useRef(null)
  const seqRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
    }
  }, [])

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const run = useCallback(async (executor, runOptions = {}) => {
    // Only the newest call may still update state — cancel whatever this
    // hook previously kicked off before starting the new one.
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const token = ++seqRef.current

    const isCurrent = () => mountedRef.current && token === seqRef.current && !controller.signal.aborted

    const timeoutMs = runOptions.timeoutMs ?? defaultOptions.timeoutMs

    try {
      // Invoke executor() synchronously (not deferred via .then()) so it
      // registers any abort listener immediately — otherwise a second run()
      // call in the same synchronous tick could abort this controller
      // before the first executor ever attaches its listener.
      let resultPromise = Promise.resolve(executor({ signal: controller.signal, isCurrent }))
      if (timeoutMs) resultPromise = withTimeout(resultPromise, timeoutMs, { controller, label: runOptions.label })
      const data = await resultPromise
      if (!isCurrent()) return { status: 'stale' }
      return { status: 'success', data }
    } catch (err) {
      // Check TIMEOUT before the abort checks below: withTimeout() aborts
      // this same controller when the clock runs out, so a timeout would
      // otherwise be misclassified as a plain cancellation and lose its
      // distinct (retryable) error code.
      if (err?.code === REQUEST_ERROR_CODES.TIMEOUT) {
        return { status: 'error', error: err }
      }
      if (controller.signal.aborted || isAbortError(err)) {
        return { status: 'aborted', error: createRequestError(REQUEST_ERROR_CODES.ABORTED, 'Request was aborted') }
      }
      if (!isCurrent()) return { status: 'stale' }
      return { status: 'error', error: classifyError(err) }
    }
  }, [defaultOptions.timeoutMs])

  return { run, cancel, isMounted: () => mountedRef.current }
}
