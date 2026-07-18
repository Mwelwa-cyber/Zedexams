import {describe, it, expect, vi, beforeEach} from 'vitest'
import {StrictMode} from 'react'
import {renderHook, act} from '@testing-library/react'
import {useAiOperationLock} from './useAiOperationLock.js'

// useAiOperationLock is the shared double-click/rapid-tap/rerender guard in
// front of every AI "Generate" button (see file header for the full
// rationale). This spec drives it exactly like a real click handler would —
// through `run()`, never by reaching into internals — so it proves the same
// guarantees a studio's onGenerate() gets in production.

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return {promise, resolve, reject}
}

function uniqueKey(name) {
  // Each test gets its own lockKey so the module-level lock registry never
  // leaks state between tests (it's intentionally shared across the WHOLE
  // tab in production, which is exactly what we're testing).
  return `test:${name}:${Math.random().toString(36).slice(2)}`
}

beforeEach(() => {
  sessionStorage.clear()
})

describe('useAiOperationLock', () => {
  it('a double-click sends exactly one request', async () => {
    const key = uniqueKey('double-click')
    const {result} = renderHook(() => useAiOperationLock(key))
    const action = vi.fn().mockResolvedValue('done')

    let first
    let second
    await act(async () => {
      // Fired back-to-back in the same tick, like two rapid click events.
      const p1 = result.current.run({fingerprint: 'fp', action})
      const p2 = result.current.run({fingerprint: 'fp', action})
      ;[first, second] = await Promise.all([p1, p2])
    })

    expect(action).toHaveBeenCalledTimes(1)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(second.reason).toBe('locked')
  })

  it('rapid taps (5x) send exactly one request', async () => {
    const key = uniqueKey('rapid-taps')
    const {result} = renderHook(() => useAiOperationLock(key))
    const action = vi.fn().mockResolvedValue('done')

    let results
    await act(async () => {
      results = await Promise.all(
          Array.from({length: 5}, () => result.current.run({fingerprint: 'fp', action})),
      )
    })

    expect(action).toHaveBeenCalledTimes(1)
    expect(results.filter((r) => r.ok).length).toBe(1)
    expect(results.filter((r) => !r.ok && r.reason === 'locked').length).toBe(4)
  })

  it('the lock activates synchronously — a second call in the same tick sees it, before any await resolves', async () => {
    const key = uniqueKey('sync-lock')
    const {result} = renderHook(() => useAiOperationLock(key))
    const gate = deferred()
    const action = vi.fn().mockReturnValue(gate.promise)

    let firstCallResult
    let secondCallResult
    act(() => {
      // Not awaited — this proves the lock is set BEFORE the microtask queue
      // even runs, not merely "eventually" via a state update. run() never
      // rejects (it resolves {ok:false,...} on failure), so no .catch needed.
      // eslint-disable-next-line promise/catch-or-return -- run() never rejects
      result.current.run({fingerprint: 'fp', action}).then((r) => { firstCallResult = r })
      // eslint-disable-next-line promise/catch-or-return -- run() never rejects
      result.current.run({fingerprint: 'fp', action}).then((r) => { secondCallResult = r })
    })

    expect(action).toHaveBeenCalledTimes(1)

    await act(async () => {
      gate.resolve('ok')
      await gate.promise
    })

    expect(firstCallResult.ok).toBe(true)
    expect(secondCallResult).toEqual({ok: false, reason: 'locked'})
  })

  it('isRunning is true while the action is in flight and false once it settles (success)', async () => {
    const key = uniqueKey('is-running-success')
    const {result} = renderHook(() => useAiOperationLock(key))
    const gate = deferred()

    expect(result.current.isRunning).toBe(false)

    let runPromise
    act(() => {
      runPromise = result.current.run({fingerprint: 'fp', action: () => gate.promise})
    })
    expect(result.current.isRunning).toBe(true)

    await act(async () => {
      gate.resolve('done')
      await runPromise
    })
    expect(result.current.isRunning).toBe(false)
  })

  it('isRunning returns to false after a failure too, so the button unlocks on error', async () => {
    const key = uniqueKey('is-running-failure')
    const {result} = renderHook(() => useAiOperationLock(key))
    const gate = deferred()

    let runPromise
    act(() => {
      runPromise = result.current.run({fingerprint: 'fp', action: () => gate.promise})
    })
    expect(result.current.isRunning).toBe(true)

    let outcome
    await act(async () => {
      gate.reject(new Error('provider exploded'))
      outcome = await runPromise
    })

    expect(result.current.isRunning).toBe(false)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('error')
  })

  it('a rerender does not resend while the operation is still in flight', async () => {
    const key = uniqueKey('rerender')
    const {result, rerender} = renderHook(() => useAiOperationLock(key))
    const gate = deferred()
    const action = vi.fn().mockReturnValue(gate.promise)

    let runPromise
    act(() => {
      runPromise = result.current.run({fingerprint: 'fp', action})
    })

    // Simulate a parent rerender (e.g. unrelated prop change) while the
    // request is still pending.
    rerender()
    rerender()

    // A second, independently-triggered attempt (e.g. an effect firing again
    // after the rerender) must still see the lock and refuse to call action.
    const second = await act(async () => result.current.run({fingerprint: 'fp', action}))
    expect(second).toEqual({ok: false, reason: 'locked'})
    expect(action).toHaveBeenCalledTimes(1)

    await act(async () => {
      gate.resolve('done')
      await runPromise
    })
  })

  it('React Strict Mode double-invocation does not duplicate the request', async () => {
    const key = uniqueKey('strict-mode')
    const {result} = renderHook(() => useAiOperationLock(key), {wrapper: StrictMode})
    const action = vi.fn().mockResolvedValue('done')

    // The hook itself never calls `action` from an effect — only an explicit
    // run() call does — so mounting under StrictMode (which double-invokes
    // render/effects in dev) must not have called it yet.
    expect(action).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.run({fingerprint: 'fp', action})
    })
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('reuses the same idempotency key when the same logical request is retried after a lost response', async () => {
    const key = uniqueKey('resume-key')
    const {result} = renderHook(() => useAiOperationLock(key))

    let firstKey
    await act(async () => {
      const r = await result.current.run({
        fingerprint: 'topic:cells',
        action: () => Promise.reject(new Error('network dropped mid-request')),
      })
      firstKey = r.idempotencyKey
    })

    let secondKey
    await act(async () => {
      const r = await result.current.run({
        fingerprint: 'topic:cells', // same logical request
        action: (idempotencyKey) => Promise.resolve(idempotencyKey),
      })
      secondKey = r.data
    })

    expect(secondKey).toBe(firstKey)
  })

  it('mints a fresh idempotency key for a genuinely new request (different fingerprint)', async () => {
    const key = uniqueKey('fresh-key')
    const {result} = renderHook(() => useAiOperationLock(key))

    let firstKey
    await act(async () => {
      const r = await result.current.run({fingerprint: 'topic:cells', action: async (k) => k})
      firstKey = r.data
    })

    let secondKey
    await act(async () => {
      const r = await result.current.run({fingerprint: 'topic:digestion', action: async (k) => k})
      secondKey = r.data
    })

    expect(secondKey).not.toBe(firstKey)
  })

  it('a completed request does not resume its key on the next click, even with the same fingerprint', async () => {
    const key = uniqueKey('no-resume-after-success')
    const {result} = renderHook(() => useAiOperationLock(key))

    let firstKey
    await act(async () => {
      const r = await result.current.run({fingerprint: 'topic:cells', action: async (k) => k})
      firstKey = r.data
    })

    let secondKey
    await act(async () => {
      const r = await result.current.run({fingerprint: 'topic:cells', action: async (k) => k})
      secondKey = r.data
    })

    expect(secondKey).not.toBe(firstKey)
  })

  it('two different lock keys run independently (locking one does not block the other)', async () => {
    const keyA = uniqueKey('scope-a')
    const keyB = uniqueKey('scope-b')
    const {result: a} = renderHook(() => useAiOperationLock(keyA))
    const {result: b} = renderHook(() => useAiOperationLock(keyB))
    const gateA = deferred()
    const actionA = vi.fn().mockReturnValue(gateA.promise)
    const actionB = vi.fn().mockResolvedValue('done-b')

    let runA
    act(() => {
      runA = a.current.run({fingerprint: 'fp', action: actionA})
    })
    expect(a.current.isRunning).toBe(true)

    const resultB = await act(async () => b.current.run({fingerprint: 'fp', action: actionB}))
    expect(resultB.ok).toBe(true)
    expect(actionB).toHaveBeenCalledTimes(1)

    await act(async () => {
      gateA.resolve('done-a')
      await runA
    })
  })

  it('clear() lets the next click mint a fresh key even with the same fingerprint', async () => {
    const key = uniqueKey('explicit-clear')
    const {result} = renderHook(() => useAiOperationLock(key))

    let firstKey
    await act(async () => {
      const r = await result.current.run({
        fingerprint: 'topic:cells',
        action: () => Promise.reject(new Error('terminal failure')),
      })
      firstKey = r.idempotencyKey
    })

    act(() => result.current.clear())

    let secondKey
    await act(async () => {
      const r = await result.current.run({fingerprint: 'topic:cells', action: async (k) => k})
      secondKey = r.data
    })

    expect(secondKey).not.toBe(firstKey)
  })
})
