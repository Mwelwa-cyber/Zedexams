// src/utils/requestDeduplication.js
//
// In-flight request de-duplication: when several callers ask for the same
// data (same fully-qualified key) at the same time, they share one
// underlying fetch instead of each firing their own. Built on top of the
// primitives in `requestControl.js`.
//
// This is for READS and safe repeated retrieval only — see CLAUDE.md /
// AI_DEVELOPMENT_GUIDE.md and the task brief: writes (publish, submit,
// delete, assign, generate, payment, attendance finalisation) must use
// explicit idempotency keys, never argument-matching dedup.

import {
  assertSafeRequestKey,
  createRequestError,
  isAbortError,
  logRequestEvent,
  recordMetric,
  REQUEST_ERROR_CODES,
  withTimeout,
} from './requestControl.js'

const DEFAULT_MAX_PENDING = 500

// key -> { promise, controller, refCount, startedAt }
const registry = new Map()

/** Number of distinct requests currently in flight. Exposed for tests/metrics. */
export function getPendingRequestCount() {
  return registry.size
}

/** Test-only escape hatch — wipe all in-flight bookkeeping between specs. */
export function __resetRequestDeduplicationForTests() {
  registry.clear()
}

function raceWithSignal(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.reject(createRequestError(REQUEST_ERROR_CODES.ABORTED, 'Request aborted before it started'))
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(createRequestError(REQUEST_ERROR_CODES.ABORTED, 'Request aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    // Both branches of this then() are handled (settle the outer Promise
    // either way) — the `return` is only here so lint's catch-or-return
    // check doesn't flag it as a floating, unhandled chain.
    return promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err) },
    )
  })
}

/**
 * Share one in-flight async operation across every caller using the same
 * key. The FIRST caller for a key runs `fetcher`; every subsequent caller
 * for the same key, while it's still pending, awaits that same promise
 * instead of starting a new one. The pending entry is removed as soon as it
 * settles (success or failure) so the next call for that key runs fresh.
 *
 * `fetcher` receives `{ signal }` — an AbortController's signal shared by
 * the underlying call, aborted once every joined caller has stopped
 * waiting (each caller's OWN `signal` cancels only their wait, via
 * ref-counting: the shared work is only aborted when nobody is left).
 * Fetchers that can't honour AbortSignal (most Firestore reads) can ignore
 * it — pair this with `useLatestRequest`/`useAbortableRequest` so a result
 * that arrives anyway is dropped if it's no longer current.
 *
 * @param {string} key - fully-qualified key; build with `buildRequestKey()`.
 * @param {(ctx: {signal: AbortSignal}) => Promise<any>} fetcher
 * @param {{signal?: AbortSignal, timeoutMs?: number, maxPending?: number, label?: string}} [options]
 */
export async function deduplicatedRequest(key, fetcher, options = {}) {
  const { signal, timeoutMs, maxPending = DEFAULT_MAX_PENDING, label } = options
  assertSafeRequestKey(key)

  if (signal?.aborted) {
    throw createRequestError(REQUEST_ERROR_CODES.ABORTED, 'Request aborted before it started')
  }

  let entry = registry.get(key)
  if (entry) {
    logRequestEvent('joined', key)
    recordMetric('duplicatesAvoided')
  } else {
    if (registry.size >= maxPending) {
      throw createRequestError(
        REQUEST_ERROR_CODES.TOO_MANY_PENDING,
        `Too many pending requests (limit ${maxPending})`,
        { retryable: true },
      )
    }

    const controller = new AbortController()
    const startedAt = Date.now()
    // Invoke fetcher() synchronously (not deferred via .then()) so it
    // registers any abort listener immediately — a caller that aborts right
    // after starting a request must not race a not-yet-registered listener.
    let basePromise = Promise.resolve(fetcher({ signal: controller.signal }))
    if (timeoutMs) basePromise = withTimeout(basePromise, timeoutMs, { controller, label: label || key })

    entry = {
      controller,
      refCount: 0,
      promise: basePromise
        .then((value) => {
          recordMetric('completed', Date.now() - startedAt)
          logRequestEvent('completed', key)
          return value
        })
        .catch((err) => {
          if (isAbortError(err)) {
            logRequestEvent('cancelled', key)
            recordMetric('cancelled')
          } else if (err?.code === REQUEST_ERROR_CODES.TIMEOUT) {
            logRequestEvent('timedOut', key)
            recordMetric('timedOut')
          } else {
            logRequestEvent('failed', key)
            recordMetric('failed')
          }
          throw err
        })
        .finally(() => {
          // Only the entry that's still registered under this key is ours to
          // remove — guards against a same-key request that started again
          // after this one already finished (shouldn't happen given the map
          // is keyed by `key`, but keeps the invariant explicit).
          if (registry.get(key) === entry) registry.delete(key)
        }),
    }
    registry.set(key, entry)
    logRequestEvent('started', key)
  }

  entry.refCount += 1
  try {
    return await raceWithSignal(entry.promise, signal)
  } finally {
    entry.refCount -= 1
    if (entry.refCount <= 0) {
      // Nobody is left waiting on the shared work — cancel it where the
      // fetcher honours AbortSignal. A no-op for fetchers that don't (and
      // harmless if the work already settled).
      entry.controller.abort()
    }
  }
}

/**
 * A resolved-value cache layered on top of `deduplicatedRequest`, matching
 * the "load once per session, share across every studio" shape used
 * throughout the curriculum pickers (previously hand-rolled per file as
 * `_cache`/`_promise` module globals). `loader(key)` is called at most once
 * per key until `invalidate()`/`invalidate(key)` is called or `force: true`
 * is passed.
 */
export function createAsyncCache(loader, { name = 'asyncCache' } = {}) {
  const cache = new Map()

  async function get(key, { force = false, signal, timeoutMs } = {}) {
    if (!force && cache.has(key)) return cache.get(key)
    const dedupKey = buildCacheDedupKey(name, key)
    const value = await deduplicatedRequest(dedupKey, () => loader(key), { signal, timeoutMs, label: dedupKey })
    cache.set(key, value)
    return value
  }

  function peek(key) {
    return cache.has(key) ? cache.get(key) : undefined
  }

  function invalidate(key) {
    if (key === undefined) { cache.clear(); return }
    cache.delete(key)
  }

  return { get, peek, invalidate }
}

function buildCacheDedupKey(name, key) {
  return `asyncCache:${name}:${JSON.stringify(key === undefined ? null : key)}`
}
