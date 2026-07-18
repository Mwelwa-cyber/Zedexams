import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAbortableRequest } from './useAbortableRequest.js'
import { REQUEST_ERROR_CODES } from '../utils/requestControl.js'

function createDeferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useAbortableRequest', () => {
  it('resolves success for a normal executor', async () => {
    const { result } = renderHook(() => useAbortableRequest())
    let outcome
    await act(async () => {
      outcome = await result.current.run(async () => 'data')
    })
    expect(outcome).toEqual({ status: 'success', data: 'data' })
  })

  it('cancels the previous call when run() fires again — only the latest wins', async () => {
    const { result } = renderHook(() => useAbortableRequest())
    const first = createDeferred()

    let firstOutcome, secondOutcome
    const firstPromise = result.current.run(({ signal }) => {
      const p = first.promise
      signal.addEventListener('abort', () => first.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      return p
    }).then((r) => { firstOutcome = r })

    await act(async () => {
      secondOutcome = await result.current.run(async () => 'second-data')
      await firstPromise
    })

    expect(secondOutcome).toEqual({ status: 'success', data: 'second-data' })
    expect(firstOutcome.status).toBe('aborted')
  })

  it('a stale result (resolves after being superseded but ignoring the signal) is dropped, not applied', async () => {
    const { result } = renderHook(() => useAbortableRequest())
    const first = createDeferred()

    let firstOutcome
    const firstPromise = result.current.run(() => first.promise).then((r) => { firstOutcome = r })

    await act(async () => {
      await result.current.run(async () => 'second')
      first.resolve('late-first-result') // executor ignored the abort signal
      await firstPromise
    })

    expect(firstOutcome).toEqual({ status: 'stale' })
  })

  it('loading state belongs to the latest request only', async () => {
    // Simulates: request A starts, request B starts, request A finishes —
    // A must not report itself as "current" once B has superseded it.
    const { result } = renderHook(() => useAbortableRequest())
    const a = createDeferred()
    const b = createDeferred()

    const runA = result.current.run(() => a.promise)
    const runB = result.current.run(() => b.promise)

    let aOutcome
    await act(async () => {
      a.resolve('A-data') // A finishes first, but B has already superseded it
      aOutcome = await runA
    })
    expect(aOutcome).toEqual({ status: 'stale' })

    let bOutcome
    await act(async () => {
      b.resolve('B-data')
      bOutcome = await runB
    })
    expect(bOutcome).toEqual({ status: 'success', data: 'B-data' })
  })

  it('cancel() aborts the in-flight request and a late resolution does not surface as success', async () => {
    const { result } = renderHook(() => useAbortableRequest())
    const deferred = createDeferred()

    const runPromise = result.current.run(() => deferred.promise)
    act(() => { result.current.cancel() })

    let outcome
    await act(async () => {
      deferred.resolve('too-late')
      outcome = await runPromise
    })
    expect(outcome.status).toBe('stale')
  })

  it('unmounting aborts the controller and does not throw', async () => {
    const { result, unmount } = renderHook(() => useAbortableRequest())
    const deferred = createDeferred()
    const runPromise = result.current.run(() => deferred.promise)

    unmount()
    deferred.resolve('after-unmount')
    const outcome = await runPromise
    expect(outcome.status).toBe('stale')
  })

  it('an aborted request does not return a user-facing "error" status', async () => {
    const { result } = renderHook(() => useAbortableRequest())
    const deferred = createDeferred()

    const runPromise = result.current.run(({ signal }) => {
      signal.addEventListener('abort', () => deferred.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      return deferred.promise
    })
    act(() => { result.current.cancel() })

    const outcome = await runPromise
    expect(outcome.status).toBe('aborted')
    expect(outcome.status).not.toBe('error')
  })

  it('a genuine failure on the still-current request reports status "error"', async () => {
    const { result } = renderHook(() => useAbortableRequest())
    let outcome
    await act(async () => {
      outcome = await result.current.run(async () => { throw new Error('backend exploded') })
    })
    expect(outcome.status).toBe('error')
    expect(outcome.error.code).toBe(REQUEST_ERROR_CODES.UNKNOWN)
  })

  describe('timeouts', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('times out and reports a structured, retryable timeout error (not a bare abort)', async () => {
      const { result } = renderHook(() => useAbortableRequest({ timeoutMs: 1000 }))
      const never = new Promise(() => {})

      const runPromise = result.current.run(() => never)
      await vi.advanceTimersByTimeAsync(1000)
      const outcome = await runPromise

      expect(outcome.status).toBe('error')
      expect(outcome.error.code).toBe(REQUEST_ERROR_CODES.TIMEOUT)
      expect(outcome.error.retryable).toBe(true)
    })
  })
})
