/**
 * MemoryCache — a generic, tab-local TTL + LRU cache with in-flight request
 * dedup and optional stale-while-revalidate. This is the safe caching layer's
 * primitive: it sits in front of Firestore reads / callable functions /
 * expensive client computations to avoid repeating a request that already
 * completed recently (CLAUDE.md #13).
 *
 * This is deliberately NOT the same thing as src/offline/contentCache.js —
 * that module is the IndexedDB-backed *offline downloads* cache (persists
 * across restarts, budget-managed, pin-for-offline). MemoryCache is pure
 * in-memory: it clears itself when the tab closes and is cheap to clear
 * explicitly (e.g. on logout, on curriculum change). Static, non-sensitive
 * data that should survive a reload belongs in the offline cache, not here —
 * see CLAUDE.md #13.9.
 *
 * A cache problem (a thrown fetcher, a corrupted entry) must never break the
 * feature it backs — getOrSet only ever caches a *successful* result; a
 * rejected fetcher propagates to the caller and leaves the cache untouched
 * (CLAUDE.md #13.15).
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_MAX_SIZE = 200

export class MemoryCache {
  /**
   * @param {object} [opts]
   * @param {string} [opts.name] label used in dev diagnostics
   * @param {number} [opts.ttlMs] default time-to-live for entries written without an explicit ttlMs
   * @param {number} [opts.maxSize] max live entries before least-recently-used eviction
   * @param {boolean} [opts.debug] emit console diagnostics — callers should gate this on
   *   `import.meta.env.DEV`; MemoryCache itself never checks the environment.
   * @param {() => number} [opts.now] clock injection for deterministic tests; defaults to Date.now.
   */
  constructor({ name = 'cache', ttlMs = DEFAULT_TTL_MS, maxSize = DEFAULT_MAX_SIZE, debug = false, now = Date.now } = {}) {
    this.name = name
    this.ttlMs = ttlMs
    this.maxSize = maxSize
    this.debug = debug
    this._now = now
    /** @type {Map<string, { value: any, storedAt: number, expiresAt: number, staleAt: number|null }>} */
    this.store = new Map()
    /** @type {Map<string, Promise<any>>} */
    this.pending = new Map()
    // Monotonic counter bumped by every explicit invalidation (delete /
    // invalidatePrefix / clear). A fetch in flight captures the generation it
    // started under and refuses to write its (now potentially stale) result
    // once the generation has advanced — otherwise a read that began before an
    // invalidation would repopulate the cache after it, and the pre-mutation
    // value would be served for the full TTL (CLAUDE.md #13 / Prompt 16 §16).
    this.generation = 0
    this.stats = {
      hits: 0, misses: 0, expired: 0, evictions: 0,
      dedup: 0, staleServed: 0, backgroundRefreshes: 0, invalidations: 0,
    }
  }

  _log(event, key, extra) {
    if (!this.debug) return
    console.debug(`[cache:${this.name}] ${event}`, key, extra || '')
  }

  /** Move `key` to the most-recently-used end of the Map (insertion order = LRU order). */
  _touch(key) {
    const entry = this.store.get(key)
    if (entry) { this.store.delete(key); this.store.set(key, entry) }
    return entry
  }

  get size() { return this.store.size }

  /** Raw cache-only read. Returns `undefined` on miss or expiry (never throws, never fetches). */
  get(key) {
    const entry = this.store.get(key)
    if (!entry) { this.stats.misses++; this._log('miss', key); return undefined }
    if (this._now() >= entry.expiresAt) {
      this.store.delete(key)
      this.stats.expired++
      this._log('expired', key)
      return undefined
    }
    this._touch(key)
    this.stats.hits++
    this._log('hit', key)
    return entry.value
  }

  /** Whether a live (non-expired) entry exists — does not affect hit/miss stats. */
  has(key) {
    const entry = this.store.get(key)
    if (!entry) return false
    if (this._now() >= entry.expiresAt) { this.store.delete(key); return false }
    return true
  }

  /** True once a live entry is past its `staleAfterMs` marker — still usable, due for a refresh. */
  isStale(key) {
    const entry = this.store.get(key)
    if (!entry || entry.staleAt == null) return false
    if (this._now() >= entry.expiresAt) return false
    return this._now() >= entry.staleAt
  }

  /**
   * @param {string} key
   * @param {any} value
   * @param {{ ttlMs?: number, staleAfterMs?: number }} [opts]
   */
  set(key, value, { ttlMs, staleAfterMs } = {}) {
    const now = this._now()
    const ttl = ttlMs == null ? this.ttlMs : ttlMs
    this.store.set(key, {
      value,
      storedAt: now,
      expiresAt: now + ttl,
      staleAt: staleAfterMs != null ? now + staleAfterMs : null,
    })
    this._touch(key)
    this._evictIfNeeded()
    this._log('set', key)
    return value
  }

  /** Manual invalidation of a single key. Also cancels any in-flight request for it. */
  delete(key) {
    const existed = this.store.delete(key)
    this.pending.delete(key)
    // Always advance the generation, even on a store miss: a fetch for `key`
    // may be in flight (its store entry doesn't exist yet), and it must not be
    // allowed to write a stale value once this invalidation has run.
    this.generation++
    if (existed) { this.stats.invalidations++; this._log('invalidate', key) }
    return existed
  }

  /** Invalidate every entry whose key starts with `prefix`. Returns the number removed. */
  invalidatePrefix(prefix) {
    let removed = 0
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) { this.store.delete(key); removed++ }
    }
    for (const key of Array.from(this.pending.keys())) {
      if (key.startsWith(prefix)) this.pending.delete(key)
    }
    this.generation++
    if (removed) { this.stats.invalidations += removed; this._log('invalidatePrefix', prefix, { removed }) }
    return removed
  }

  /** Drop every entry (logout / hard reset). Returns the number removed. */
  clear() {
    const removed = this.store.size
    this.store.clear()
    this.pending.clear()
    this.generation++
    if (removed) { this.stats.invalidations += removed; this._log('clear', '*', { removed }) }
    return removed
  }

  _evictIfNeeded() {
    while (this.store.size > this.maxSize) {
      const oldestKey = this.store.keys().next().value
      if (oldestKey === undefined) break
      this.store.delete(oldestKey)
      this.stats.evictions++
      this._log('evict', oldestKey)
    }
  }

  /**
   * Cache-first fetch with in-flight request dedup and optional
   * stale-while-revalidate.
   *
   *  - Fresh hit           → returns the cached value; no fetcher call.
   *  - Stale-but-live hit  → returns the cached value immediately AND starts
   *                          exactly one background refresh (further callers
   *                          share it, they don't each start their own).
   *  - Miss                → if a request for this exact key is already in
   *                          flight, awaits and shares that promise. Otherwise
   *                          runs `fetcher`, caches the result **only on
   *                          success**, and lets a rejection propagate
   *                          untouched (never cached as a valid empty result).
   *
   * @param {string} key
   * @param {() => Promise<any>} fetcher
   * @param {{ ttlMs?: number, staleAfterMs?: number, onFresh?: (value:any) => void, onBackgroundError?: (err:any) => void }} [opts]
   * @returns {Promise<any>}
   */
  async getOrSet(key, fetcher, opts = {}) {
    const { ttlMs, staleAfterMs, onFresh, onBackgroundError } = opts
    const entry = this.store.get(key)
    const now = this._now()

    if (entry && now < entry.expiresAt) {
      this._touch(key)
      this.stats.hits++
      if (entry.staleAt != null && now >= entry.staleAt) {
        this.stats.staleServed++
        this._log('stale-hit', key)
        this._backgroundRefresh(key, fetcher, { ttlMs, staleAfterMs, onFresh, onBackgroundError })
      } else {
        this._log('hit', key)
      }
      return entry.value
    }

    if (entry) { this.store.delete(key); this.stats.expired++; this._log('expired', key) }
    else { this.stats.misses++; this._log('miss', key) }

    if (this.pending.has(key)) {
      this.stats.dedup++
      this._log('dedup', key)
      return this.pending.get(key)
    }

    const startGen = this.generation
    const request = Promise.resolve()
      .then(() => fetcher())
      .then((value) => {
        // Drop the write if an invalidation ran while this read was in flight —
        // the value predates the mutation and would otherwise be served stale
        // for the full TTL. The caller still receives it; it just isn't cached.
        if (this.generation === startGen) this.set(key, value, { ttlMs, staleAfterMs })
        return value
      })
      .finally(() => { if (this.pending.get(key) === request) this.pending.delete(key) })

    this.pending.set(key, request)
    return request
  }

  _backgroundRefresh(key, fetcher, { ttlMs, staleAfterMs, onFresh, onBackgroundError }) {
    if (this.pending.has(key)) return // a refresh (or the original fetch) is already in flight
    this.stats.backgroundRefreshes++
    this._log('background-refresh', key)
    const startGen = this.generation
    const request = Promise.resolve()
      .then(() => fetcher())
      .then((value) => {
        // Same in-flight-invalidation guard as getOrSet: a refresh that started
        // before an invalidation must not repopulate the cache after it.
        if (this.generation === startGen) {
          this.set(key, value, { ttlMs, staleAfterMs })
          if (typeof onFresh === 'function') onFresh(value)
        }
        return value
      })
      .catch((err) => {
        // A failed background refresh must not evict the still-valid stale
        // entry — the caller keeps serving what it already has.
        if (typeof onBackgroundError === 'function') onBackgroundError(err)
      })
      .finally(() => { if (this.pending.get(key) === request) this.pending.delete(key) })
    this.pending.set(key, request)
  }
}

export function createMemoryCache(opts) {
  return new MemoryCache(opts)
}
