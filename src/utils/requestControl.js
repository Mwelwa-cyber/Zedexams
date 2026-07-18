/**
 * Framework-agnostic helpers for request control: normalizing search text,
 * guarding against out-of-order ("stale") async responses, caching recent
 * identical searches, and locking an action so it can't fire twice
 * concurrently. Plain functions/closures — no React — so they're usable from
 * hooks (see src/hooks/useRequestLock.js) as well as from Cloud Functions or
 * plain scripts.
 */

/**
 * Normalizes a search string for comparison/caching: trims, lowercases,
 * collapses repeated whitespace, and (by default) strips diacritics so
 * "café" and "cafe" match. Never throws on non-string input.
 *
 * @param {string} text
 * @param {{ stripAccents?: boolean }} [options]
 */
export function normalizeSearchText(text, { stripAccents = true } = {}) {
  if (typeof text !== 'string') return ''
  let out = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (stripAccents && typeof out.normalize === 'function') {
    out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  }
  return out
}

/**
 * True when a (already-trimmed/normalized) query is long enough to search.
 * @param {string} query
 * @param {number} [minLength=2]
 */
export function isSearchableQuery(query, minLength = 2) {
  return typeof query === 'string' && query.length >= minLength
}

/**
 * A monotonic sequence guard for discarding stale async responses: bump()
 * before starting a request, isCurrent(token) after it resolves. Whichever
 * request bumped last wins; every earlier one is stale.
 *
 *   const guard = createSequenceGuard()
 *   const token = guard.bump()
 *   const data = await fetchThing()
 *   if (guard.isCurrent(token)) setResults(data)
 */
export function createSequenceGuard() {
  let current = 0
  return {
    bump: () => (current += 1),
    isCurrent: (token) => token === current,
    current: () => current,
  }
}

/**
 * A tiny TTL+size-bounded cache keyed by normalized query text, for "don't
 * repeat a query we already have a fresh answer for". Not persisted; lives
 * for the component/module's lifetime.
 *
 * @param {{ ttlMs?: number, maxSize?: number }} [options]
 */
export function createSearchCache({ ttlMs = 60_000, maxSize = 50 } = {}) {
  const store = new Map() // key -> { value, expiresAt }

  function get(key) {
    const entry = store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt < currentTime()) {
      store.delete(key)
      return undefined
    }
    // refresh recency
    store.delete(key)
    store.set(key, entry)
    return entry.value
  }

  function set(key, value) {
    store.delete(key)
    store.set(key, { value, expiresAt: currentTime() + ttlMs })
    while (store.size > maxSize) {
      const oldestKey = store.keys().next().value
      store.delete(oldestKey)
    }
  }

  function currentTime() {
    return typeof performance !== 'undefined' ? performance.timeOrigin + performance.now() : new Date().getTime()
  }

  return {
    get,
    set,
    has: (key) => get(key) !== undefined,
    clear: () => store.clear(),
    size: () => store.size,
  }
}

/**
 * A generation-friendly UUID, falling back gracefully in environments
 * without crypto.randomUUID (older WebViews).
 */
export function generateRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * A simple mutual-exclusion lock for "don't let this action run twice
 * concurrently" (AI generation buttons, submit handlers). `begin()` returns
 * a request id if the lock was free (and acquires it), or `null` if
 * something is already in flight. Always pair a successful `begin()` with a
 * `release()` in a `finally` block.
 */
export function createRequestLock() {
  let activeId = null

  function begin() {
    if (activeId) return null
    activeId = generateRequestId()
    return activeId
  }

  function release(id) {
    if (activeId === id) activeId = null
  }

  return {
    begin,
    release,
    isLocked: () => activeId !== null,
    activeId: () => activeId,
  }
}
