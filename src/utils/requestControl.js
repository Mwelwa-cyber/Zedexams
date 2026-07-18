// src/utils/requestControl.js
//
// Shared low-level primitives for request cancellation, timeouts, and
// structured error handling. Paired with `requestDeduplication.js` (in-flight
// promise sharing) and the `useLatestRequest` / `useAbortableRequest` hooks.
//
// Nothing here is Firestore- or fetch-specific — it works for any async
// operation, including ones that can't be physically aborted (Firestore
// reads), because the guard is "ignore the result if it's no longer current"
// rather than "the network call actually stopped".

const isDev = (() => {
  try {
    return !!import.meta.env?.DEV
  } catch {
    return false
  }
})()

// ── Structured errors ───────────────────────────────────────────────────

export const REQUEST_ERROR_CODES = Object.freeze({
  ABORTED: 'REQUEST_ABORTED',
  TIMEOUT: 'REQUEST_TIMEOUT',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  BACKEND_ERROR: 'BACKEND_ERROR',
  TOO_MANY_PENDING: 'TOO_MANY_PENDING_REQUESTS',
  UNKNOWN: 'UNKNOWN',
})

export class RequestError extends Error {
  constructor(code, message, { retryable = false, cause } = {}) {
    super(message || code)
    this.name = 'RequestError'
    this.code = code
    this.retryable = retryable
    if (cause !== undefined) this.cause = cause
  }
}

export function createRequestError(code, message, opts) {
  return new RequestError(code, message, opts)
}

export function isAbortError(err) {
  if (!err) return false
  if (err.code === REQUEST_ERROR_CODES.ABORTED) return true
  if (err.name === 'AbortError') return true
  return false
}

/**
 * Best-effort mapping of whatever a fetcher threw into one of the
 * structured codes callers are expected to branch on. Never throws — an
 * error we can't classify becomes UNKNOWN rather than blowing up the
 * classifier itself.
 */
export function classifyError(err) {
  try {
    if (err instanceof RequestError) return err
    if (isAbortError(err)) {
      return createRequestError(REQUEST_ERROR_CODES.ABORTED, 'Request was aborted', { retryable: false, cause: err })
    }
    const code = err?.code
    if (code === 'permission-denied' || code === 'PERMISSION_DENIED') {
      return createRequestError(REQUEST_ERROR_CODES.PERMISSION_DENIED, 'Permission denied', { retryable: false, cause: err })
    }
    if (code === 'not-found' || code === 'NOT_FOUND') {
      return createRequestError(REQUEST_ERROR_CODES.NOT_FOUND, 'Not found', { retryable: false, cause: err })
    }
    if (code === 'unavailable' || code === 'deadline-exceeded' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return createRequestError(REQUEST_ERROR_CODES.NETWORK_ERROR, 'Network unavailable', { retryable: true, cause: err })
    }
    if (err instanceof TypeError && /fetch|network/i.test(err.message || '')) {
      return createRequestError(REQUEST_ERROR_CODES.NETWORK_ERROR, 'Network request failed', { retryable: true, cause: err })
    }
    if (typeof code === 'string' && code) {
      return createRequestError(REQUEST_ERROR_CODES.BACKEND_ERROR, err.message || 'Backend error', { retryable: false, cause: err })
    }
    return createRequestError(REQUEST_ERROR_CODES.UNKNOWN, err?.message || 'Unknown error', { retryable: false, cause: err })
  } catch {
    return createRequestError(REQUEST_ERROR_CODES.UNKNOWN, 'Unknown error', { retryable: false })
  }
}

// ── Timeouts ─────────────────────────────────────────────────────────────

/**
 * Races `promise` against a timer. On timeout, aborts `controller` (if
 * given) and rejects with a structured REQUEST_TIMEOUT error — the caller's
 * own promise is left to settle on its own (there's no way to force an
 * arbitrary promise to stop), but nothing downstream should still be
 * listening once the timeout error has been reported.
 */
export function withTimeout(promise, timeoutMs, { controller, label } = {}) {
  if (!timeoutMs || timeoutMs <= 0) return promise
  let timer
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      if (controller && !controller.signal.aborted) controller.abort()
      reject(createRequestError(
        REQUEST_ERROR_CODES.TIMEOUT,
        `Request timed out after ${timeoutMs}ms${label ? ` (${label})` : ''}`,
        { retryable: true },
      ))
    }, timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
}

// ── Request keys ─────────────────────────────────────────────────────────

// Bare, unqualified keys that have historically caused cross-context bugs
// (e.g. sharing "subjects" between two different grades, or "search"
// between two different users). Not exhaustive — a dev-only nudge, not an
// enforcement mechanism.
const VAGUE_BARE_KEYS = new Set(['subjects', 'search', 'documents', 'syllabus', 'topics', 'results', 'list', 'data'])

/**
 * Build a request key from every field that affects the result. Parts are
 * JSON-serialised as an array (not string-joined) so a value that happens
 * to contain the join delimiter can never merge two fields into one — e.g.
 * `["a:b", "c"]` and `["a", "b:c"]` produce different keys, whereas naive
 * `.join(':')` would collide them.
 *
 * Usage: buildRequestKey('syllabus-search', userId, schoolId, curriculumId,
 *   curriculumVersion, gradeId, subjectId, normalizedQuery)
 */
export function buildRequestKey(...parts) {
  return JSON.stringify(parts.map((p) => (p === undefined ? null : p)))
}

/**
 * Dev-only heuristic warning for keys likely to cause cross-context
 * collisions — either a bare vague string ("subjects") or a
 * `buildRequestKey(...)` call with too few parts to plausibly scope the
 * request (missing user/school/curriculum context).
 */
export function assertSafeRequestKey(key) {
  if (!isDev) return
  try {
    const parsed = JSON.parse(key)
    if (Array.isArray(parsed)) {
      if (parsed.length < 2) {
        console.warn('[requestControl] request key has fewer than 2 parts — likely to collide across users/contexts:', key)
      }
      return
    }
  } catch {
    // Not a buildRequestKey()-style JSON array; fall through to the bare-string heuristic.
  }
  const bare = String(key).trim().toLowerCase()
  if (VAGUE_BARE_KEYS.has(bare)) {
    console.warn(`[requestControl] request key "${key}" is too vague — include user/school/curriculum/grade/subject context`)
  }
}

// ── Dev diagnostics + metrics ────────────────────────────────────────────

export function logRequestEvent(event, key, extra) {
  if (!isDev) return
  try {
    console.debug(`[requestControl] ${event}`, key, extra ?? '')
  } catch {
    /* no console in this environment */
  }
}

const emptyMetrics = () => ({
  duplicatesAvoided: 0,
  staleResponsesBlocked: 0,
  cancelled: 0,
  timedOut: 0,
  completed: 0,
  failed: 0,
  totalDurationMs: 0,
})

export const requestMetrics = emptyMetrics()

export function recordMetric(name, durationMs) {
  if (!(name in requestMetrics)) return
  requestMetrics[name] += 1
  if (name === 'completed' && typeof durationMs === 'number') {
    requestMetrics.totalDurationMs += durationMs
  }
}

export function getRequestMetrics() {
  const { totalDurationMs, completed, ...rest } = requestMetrics
  return {
    ...rest,
    completed,
    averageDurationMs: completed > 0 ? Math.round(totalDurationMs / completed) : 0,
  }
}

export function resetRequestMetrics() {
  Object.assign(requestMetrics, emptyMetrics())
}

/**
 * Plain display string for a `classifyError()` result, matching the
 * `err instanceof Error ? err.message : String(err)` convention call sites
 * used before adopting structured errors — so migrating a hook to the
 * shared error machinery doesn't change what a user (or an existing test)
 * sees on screen.
 */
export function toDisplayMessage(err) {
  const original = err?.cause ?? err
  if (original instanceof Error) return original.message
  return String(original)
}
