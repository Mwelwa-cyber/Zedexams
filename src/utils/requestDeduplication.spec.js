import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createAsyncCache,
  deduplicatedRequest,
  getPendingRequestCount,
  __resetRequestDeduplicationForTests,
} from './requestDeduplication.js'
import { buildRequestKey, REQUEST_ERROR_CODES } from './requestControl.js'

function createDeferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  __resetRequestDeduplicationForTests()
})

describe('deduplicatedRequest — in-flight sharing', () => {
  it('two identical active requests share one promise and one underlying call', async () => {
    const deferred = createDeferred()
    const fetcher = vi.fn(() => deferred.promise)
    const key = buildRequestKey('syllabus-search', 'user-1', 'grade-4')

    const a = deduplicatedRequest(key, fetcher)
    const b = deduplicatedRequest(key, fetcher)
    const c = deduplicatedRequest(key, fetcher)

    deferred.resolve({ subjects: ['Math'] })
    const [ra, rb, rc] = await Promise.all([a, b, c])

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(ra).toEqual({ subjects: ['Math'] })
    expect(rb).toEqual({ subjects: ['Math'] })
    expect(rc).toEqual({ subjects: ['Math'] })
  })

  it('different request keys create separate requests', async () => {
    const fetcherA = vi.fn(async () => 'A')
    const fetcherB = vi.fn(async () => 'B')
    const keyA = buildRequestKey('syllabus-search', 'user-1', 'grade-4')
    const keyB = buildRequestKey('syllabus-search', 'user-1', 'grade-5')

    const [ra, rb] = await Promise.all([
      deduplicatedRequest(keyA, fetcherA),
      deduplicatedRequest(keyB, fetcherB),
    ])

    expect(fetcherA).toHaveBeenCalledTimes(1)
    expect(fetcherB).toHaveBeenCalledTimes(1)
    expect(ra).toBe('A')
    expect(rb).toBe('B')
  })

  it('different users never share a request even for the same logical query', async () => {
    const fetcherUser1 = vi.fn(async () => ['private-to-user-1'])
    const fetcherUser2 = vi.fn(async () => ['private-to-user-2'])
    const keyUser1 = buildRequestKey('learner-search', 'user-1', 'grade-4', 'fractions')
    const keyUser2 = buildRequestKey('learner-search', 'user-2', 'grade-4', 'fractions')

    const [r1, r2] = await Promise.all([
      deduplicatedRequest(keyUser1, fetcherUser1),
      deduplicatedRequest(keyUser2, fetcherUser2),
    ])

    expect(fetcherUser1).toHaveBeenCalledTimes(1)
    expect(fetcherUser2).toHaveBeenCalledTimes(1)
    expect(r1).toEqual(['private-to-user-1'])
    expect(r2).toEqual(['private-to-user-2'])
  })

  it('different schools never share a request', async () => {
    const fetcherSchoolA = vi.fn(async () => 'school-a-data')
    const fetcherSchoolB = vi.fn(async () => 'school-b-data')
    const keySchoolA = buildRequestKey('teacher-search', 'school-a', 'query')
    const keySchoolB = buildRequestKey('teacher-search', 'school-b', 'query')

    await Promise.all([
      deduplicatedRequest(keySchoolA, fetcherSchoolA),
      deduplicatedRequest(keySchoolB, fetcherSchoolB),
    ])

    expect(fetcherSchoolA).toHaveBeenCalledTimes(1)
    expect(fetcherSchoolB).toHaveBeenCalledTimes(1)
  })

  it('never mixes CBC and OBC responses sharing the same grade/subject', async () => {
    const fetcherCbc = vi.fn(async () => ({ curriculumId: 'cbc', topics: ['CBC topic'] }))
    const fetcherObc = vi.fn(async () => ({ curriculumId: 'obc', topics: ['OBC topic'] }))
    const keyCbc = buildRequestKey('topics', 'grade-7', 'math', 'cbc', 'v2023')
    const keyObc = buildRequestKey('topics', 'grade-7', 'math', 'obc', 'v2013')

    const [cbc, obc] = await Promise.all([
      deduplicatedRequest(keyCbc, fetcherCbc),
      deduplicatedRequest(keyObc, fetcherObc),
    ])

    expect(cbc.curriculumId).toBe('cbc')
    expect(obc.curriculumId).toBe('obc')
    expect(fetcherCbc).toHaveBeenCalledTimes(1)
    expect(fetcherObc).toHaveBeenCalledTimes(1)
  })

  it('removes a failed request from the pending map so the next call retries fresh', async () => {
    const key = buildRequestKey('doc-list', 'user-1')
    const failing = vi.fn(async () => { throw new Error('backend down') })

    await expect(deduplicatedRequest(key, failing)).rejects.toThrow('backend down')
    expect(getPendingRequestCount()).toBe(0)

    const succeeding = vi.fn(async () => 'recovered')
    await expect(deduplicatedRequest(key, succeeding)).resolves.toBe('recovered')
    expect(succeeding).toHaveBeenCalledTimes(1)
  })

  it('removes a completed request from the pending map', async () => {
    const key = buildRequestKey('doc-list', 'user-2')
    await deduplicatedRequest(key, async () => 'done')
    expect(getPendingRequestCount()).toBe(0)
  })

  it("a caller's own abort signal rejects only that caller, not siblings sharing the request", async () => {
    const deferred = createDeferred()
    const fetcher = vi.fn(() => deferred.promise)
    const key = buildRequestKey('shared-fetch', 'user-1')
    const controllerA = new AbortController()

    const a = deduplicatedRequest(key, fetcher, { signal: controllerA.signal })
    const b = deduplicatedRequest(key, fetcher)

    controllerA.abort()
    await expect(a).rejects.toMatchObject({ code: REQUEST_ERROR_CODES.ABORTED })

    deferred.resolve('shared-result')
    await expect(b).resolves.toBe('shared-result')
  })

  it('aborts the underlying fetcher once every caller has stopped waiting', async () => {
    let capturedSignal
    const fetcher = vi.fn(({ signal }) => {
      capturedSignal = signal
      return new Promise(() => {}) // never resolves
    })
    const key = buildRequestKey('shared-fetch', 'user-3')
    const controller = new AbortController()

    const only = deduplicatedRequest(key, fetcher, { signal: controller.signal })
    controller.abort()
    await expect(only).rejects.toMatchObject({ code: REQUEST_ERROR_CODES.ABORTED })
    expect(capturedSignal.aborted).toBe(true)
  })

  it('rejects immediately if the signal is already aborted before the call starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn(async () => 'never')
    await expect(deduplicatedRequest('k', fetcher, { signal: controller.signal }))
      .rejects.toMatchObject({ code: REQUEST_ERROR_CODES.ABORTED })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('cleans up after a timeout and reports a structured, retryable error', async () => {
    vi.useFakeTimers()
    try {
      const key = buildRequestKey('slow-request', 'user-1')
      const fetcher = vi.fn(() => new Promise(() => {}))
      const result = deduplicatedRequest(key, fetcher, { timeoutMs: 1000 })
      const assertion = expect(result).rejects.toMatchObject({ code: REQUEST_ERROR_CODES.TIMEOUT, retryable: true })
      await vi.advanceTimersByTimeAsync(1000)
      await assertion
      expect(getPendingRequestCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('enforces a maximum pending-request count for brand-new keys', async () => {
    const blockers = [createDeferred(), createDeferred()]
    const p1 = deduplicatedRequest('k1', () => blockers[0].promise, { maxPending: 2 })
    const p2 = deduplicatedRequest('k2', () => blockers[1].promise, { maxPending: 2 })
    expect(getPendingRequestCount()).toBe(2)

    await expect(deduplicatedRequest('k3', async () => 'x', { maxPending: 2 }))
      .rejects.toMatchObject({ code: REQUEST_ERROR_CODES.TOO_MANY_PENDING })

    // Joining an EXISTING key is still allowed even at the cap.
    const joined = deduplicatedRequest('k1', () => blockers[0].promise, { maxPending: 2 })
    blockers[0].resolve('r1')
    blockers[1].resolve('r2')
    await expect(joined).resolves.toBe('r1')
    await Promise.all([p1, p2])
  })
})

describe('createAsyncCache', () => {
  it('caches a resolved value — a second get() does not re-invoke the loader', async () => {
    const loader = vi.fn(async (key) => `value-for-${key}`)
    const cache = createAsyncCache(loader, { name: 'test-cache' })

    await expect(cache.get('a')).resolves.toBe('value-for-a')
    await expect(cache.get('a')).resolves.toBe('value-for-a')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent get() calls for the same key onto one loader call', async () => {
    const deferred = createDeferred()
    const loader = vi.fn(() => deferred.promise)
    const cache = createAsyncCache(loader, { name: 'test-cache-2' })

    const pa = cache.get('k')
    const pb = cache.get('k')
    deferred.resolve('shared')
    const [a, b] = await Promise.all([pa, pb])

    expect(a).toBe('shared')
    expect(b).toBe('shared')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('force:true rebuilds even when a cached value exists', async () => {
    const loader = vi.fn(async () => 'v')
    const cache = createAsyncCache(loader, { name: 'test-cache-3' })
    await cache.get('a')
    await cache.get('a', { force: true })
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('invalidate(key) forces the next get() to reload just that key', async () => {
    const loader = vi.fn(async (key) => `v-${key}`)
    const cache = createAsyncCache(loader, { name: 'test-cache-4' })
    await cache.get('a')
    await cache.get('b')
    cache.invalidate('a')
    await cache.get('a')
    await cache.get('b')
    expect(loader).toHaveBeenCalledTimes(3) // a, b, a-again — b stayed cached
  })

  it('invalidate() with no key clears the whole cache', async () => {
    const loader = vi.fn(async (key) => `v-${key}`)
    const cache = createAsyncCache(loader, { name: 'test-cache-5' })
    await cache.get('a')
    await cache.get('b')
    cache.invalidate()
    await cache.get('a')
    expect(loader).toHaveBeenCalledTimes(3)
  })

  it('peek() returns undefined until the value has resolved', async () => {
    const deferred = createDeferred()
    const loader = vi.fn(() => deferred.promise)
    const cache = createAsyncCache(loader, { name: 'test-cache-6' })
    expect(cache.peek('a')).toBeUndefined()
    const pending = cache.get('a')
    expect(cache.peek('a')).toBeUndefined()
    deferred.resolve('done')
    await pending
    expect(cache.peek('a')).toBe('done')
  })
})
