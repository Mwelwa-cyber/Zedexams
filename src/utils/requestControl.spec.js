import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildRequestKey,
  classifyError,
  createRequestError,
  getRequestMetrics,
  isAbortError,
  recordMetric,
  REQUEST_ERROR_CODES,
  resetRequestMetrics,
  toDisplayMessage,
  withTimeout,
} from './requestControl.js'

beforeEach(() => {
  resetRequestMetrics()
})

describe('buildRequestKey', () => {
  it('produces distinct keys for distinct parts', () => {
    const a = buildRequestKey('syllabus-search', 'user-1', 'grade-4', 'fractions')
    const b = buildRequestKey('syllabus-search', 'user-2', 'grade-4', 'fractions')
    expect(a).not.toBe(b)
  })

  it('produces the same key for the same parts (so callers actually dedupe)', () => {
    const a = buildRequestKey('syllabus-search', 'user-1', 'grade-4', 'fractions')
    const b = buildRequestKey('syllabus-search', 'user-1', 'grade-4', 'fractions')
    expect(a).toBe(b)
  })

  it('never merges two fields via a naive string-join collision', () => {
    // ['a:b', 'c'] vs ['a', 'b:c'] would collide under `.join(':')`.
    const a = buildRequestKey('a:b', 'c')
    const b = buildRequestKey('a', 'b:c')
    expect(a).not.toBe(b)
  })

  it('treats undefined parts consistently (curriculumVersion omitted vs present)', () => {
    const withVersion = buildRequestKey('type', 'user-1', 'v2')
    const withoutVersion = buildRequestKey('type', 'user-1', undefined)
    expect(withVersion).not.toBe(withoutVersion)
  })
})

describe('isAbortError', () => {
  it('recognises a DOMException-style AbortError', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true)
  })
  it('recognises our own REQUEST_ABORTED structured error', () => {
    expect(isAbortError(createRequestError(REQUEST_ERROR_CODES.ABORTED, 'x'))).toBe(true)
  })
  it('is false for an unrelated error', () => {
    expect(isAbortError(new Error('boom'))).toBe(false)
  })
  it('is false for null/undefined', () => {
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })
})

describe('classifyError', () => {
  it('passes an existing RequestError through untouched', () => {
    const err = createRequestError(REQUEST_ERROR_CODES.NOT_FOUND, 'gone')
    expect(classifyError(err)).toBe(err)
  })

  it('maps an AbortError to REQUEST_ABORTED, not retryable', () => {
    const result = classifyError({ name: 'AbortError' })
    expect(result.code).toBe(REQUEST_ERROR_CODES.ABORTED)
    expect(result.retryable).toBe(false)
  })

  it('maps a Firestore permission-denied error', () => {
    const result = classifyError({ code: 'permission-denied', message: 'nope' })
    expect(result.code).toBe(REQUEST_ERROR_CODES.PERMISSION_DENIED)
    expect(result.retryable).toBe(false)
  })

  it('maps a Firestore not-found error', () => {
    const result = classifyError({ code: 'not-found' })
    expect(result.code).toBe(REQUEST_ERROR_CODES.NOT_FOUND)
  })

  it('maps unavailable to a retryable NETWORK_ERROR', () => {
    const result = classifyError({ code: 'unavailable' })
    expect(result.code).toBe(REQUEST_ERROR_CODES.NETWORK_ERROR)
    expect(result.retryable).toBe(true)
  })

  it('maps an unrecognised backend code to BACKEND_ERROR', () => {
    const result = classifyError({ code: 'some/weird-backend-code', message: 'oops' })
    expect(result.code).toBe(REQUEST_ERROR_CODES.BACKEND_ERROR)
  })

  it('falls back to UNKNOWN for a plain Error with no code', () => {
    const result = classifyError(new Error('mystery'))
    expect(result.code).toBe(REQUEST_ERROR_CODES.UNKNOWN)
  })

  it('never throws even given a hostile input', () => {
    // A getter that throws must not blow up the classifier itself.
    const hostile = {}
    Object.defineProperty(hostile, 'code', { get() { throw new Error('nope') } })
    expect(() => classifyError(hostile)).not.toThrow()
    expect(classifyError(hostile).code).toBe(REQUEST_ERROR_CODES.UNKNOWN)
  })
})

describe('toDisplayMessage', () => {
  it('unwraps the original Error message from a classified error', () => {
    const classified = classifyError(new Error('Network failure'))
    expect(toDisplayMessage(classified)).toBe('Network failure')
  })

  it('stringifies a non-Error rejection reason the same way legacy call sites did', () => {
    const classified = classifyError('something went wrong')
    expect(toDisplayMessage(classified)).toBe('something went wrong')
  })
})

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves normally when the promise settles before the timeout', async () => {
    const promise = withTimeout(Promise.resolve('ok'), 1000)
    await expect(promise).resolves.toBe('ok')
  })

  it('rejects with a structured REQUEST_TIMEOUT error once the clock runs out', async () => {
    const never = new Promise(() => {}) // never settles on its own
    const result = withTimeout(never, 1000)
    const assertion = expect(result).rejects.toMatchObject({ code: REQUEST_ERROR_CODES.TIMEOUT, retryable: true })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('aborts the given controller on timeout', async () => {
    const controller = new AbortController()
    const never = new Promise(() => {})
    const result = withTimeout(never, 500, { controller })
    const assertion = expect(result).rejects.toMatchObject({ code: REQUEST_ERROR_CODES.TIMEOUT })
    await vi.advanceTimersByTimeAsync(500)
    await assertion
    expect(controller.signal.aborted).toBe(true)
  })

  it('is a no-op passthrough when timeoutMs is falsy', async () => {
    const promise = Promise.resolve('value')
    expect(withTimeout(promise, 0)).toBe(promise)
    expect(withTimeout(promise, null)).toBe(promise)
  })
})

describe('request metrics', () => {
  it('starts at zero and accumulates recorded events', () => {
    resetRequestMetrics()
    expect(getRequestMetrics().duplicatesAvoided).toBe(0)
    recordMetric('duplicatesAvoided')
    recordMetric('duplicatesAvoided')
    recordMetric('cancelled')
    const metrics = getRequestMetrics()
    expect(metrics.duplicatesAvoided).toBe(2)
    expect(metrics.cancelled).toBe(1)
  })

  it('computes an average duration from completed events', () => {
    resetRequestMetrics()
    recordMetric('completed', 100)
    recordMetric('completed', 300)
    expect(getRequestMetrics().averageDurationMs).toBe(200)
  })

  it('reports 0 average duration when nothing has completed', () => {
    resetRequestMetrics()
    expect(getRequestMetrics().averageDurationMs).toBe(0)
  })
})
