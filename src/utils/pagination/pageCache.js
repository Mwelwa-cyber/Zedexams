/**
 * pageCache.js — short-lived cache of completed pagination pages (Prompt 16 §15).
 *
 * A completed page is deterministic for a given (queryKey, startCursor): the
 * same query starting after the same document returns the same rows until the
 * underlying data changes. Caching it briefly means re-opening a list, or
 * paging back and forth, doesn't re-bill Firestore for rows already read.
 *
 * Layered on the existing MemoryCache (TTL + LRU + in-flight dedup) so the
 * request-deduplication guarantee (§13 — two identical page reads share one
 * promise) and the "never cache a rejection" guarantee come for free. One
 * MemoryCache instance per scope, so a scope can be invalidated wholesale
 * (`invalidatePageScope`) when a record in it is created/updated/deleted
 * (Prompt 16 §15/§16), without touching other scopes.
 *
 * TTLs are deliberately short — this is a read-amplification guard, not a
 * source of truth. Never route money / entitlement / attendance-lock /
 * publishing-state reads through here (mirror the CLAUDE.md #13 rule).
 */

import { MemoryCache } from '../cache/memoryCache.js'
import { pageRequestKey } from './cursors.js'

const DEV = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV)

// Recommended per-surface TTLs (Prompt 16 §15).
export const PAGE_CACHE_TTL = Object.freeze({
  PUBLIC_CATALOGUE: 15 * 60 * 1000, // public past-paper / catalogue pages: 10–30min
  TEACHER_DOCUMENTS: 90 * 1000, // teacher document libraries: 30–120s
  QUESTION_BANK: 3 * 60 * 1000, // question-bank searches: 2–5min
  NOTIFICATIONS: 45 * 1000, // notifications: 30–60s
  DEFAULT: 60 * 1000,
})

/** @type {Map<string, MemoryCache>} */
const caches = new Map()

/** Get (or lazily create) the shared page cache for a pagination scope. */
export function getPageCache(scope, { ttlMs = PAGE_CACHE_TTL.DEFAULT, maxSize = 120 } = {}) {
  let cache = caches.get(scope)
  if (!cache) {
    cache = new MemoryCache({ name: `page:${scope}`, ttlMs, maxSize, debug: DEV })
    caches.set(scope, cache)
  }
  return cache
}

/**
 * Cache key for a single page: the pagination query key plus the cursor the
 * page starts after (`queryKey::<cursorId|start>`). The first page keys off
 * the `start` sentinel; later pages off the previous page's last document id.
 */
export function pageCacheKey(queryKey, startCursor) {
  return pageRequestKey(queryKey, startCursor)
}

/**
 * Fetch one page through the cache: a fresh cached copy is returned without a
 * read; concurrent identical requests share one in-flight promise (§13); a
 * rejected fetch is never cached. Pass `{ bypass: true }` (e.g. during an
 * explicit refresh) to force a live read that still repopulates the cache.
 *
 * @param {string} scope
 * @param {string} queryKey
 * @param {{ id?: string }|null} startCursor
 * @param {() => Promise<any>} fetcher
 * @param {{ ttlMs?: number, bypass?: boolean, cache?: MemoryCache }} [opts]
 * @returns {Promise<any>}
 */
export function fetchPageCached(scope, queryKey, startCursor, fetcher, opts = {}) {
  const cache = opts.cache || getPageCache(scope, { ttlMs: opts.ttlMs })
  const key = pageCacheKey(queryKey, startCursor)
  if (opts.bypass) cache.delete(key)
  return cache.getOrSet(key, fetcher, { ttlMs: opts.ttlMs })
}

/**
 * Invalidate cached pages. With no `queryKey`, clears the whole scope (use
 * after a create/delete that could shift any page). With a `queryKey`, clears
 * only that session's pages (`queryKey::*`).
 */
export function invalidatePageScope(scope, queryKey) {
  const cache = caches.get(scope)
  if (!cache) return 0
  if (!queryKey) return cache.clear()
  return cache.invalidatePrefix(`${queryKey}::`)
}

/** Clear every registered page cache — logout / hard reset. */
export function clearAllPageCaches() {
  let total = 0
  for (const cache of caches.values()) total += cache.clear()
  return total
}

/** Test-only: drop every registered scope cache entirely. */
export function _resetPageCachesForTests() {
  caches.clear()
}
