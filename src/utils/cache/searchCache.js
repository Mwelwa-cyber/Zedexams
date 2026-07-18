/**
 * searchCache — scoped search/query caching on top of MemoryCache +
 * cacheKeys. One MemoryCache instance per `scope` (e.g. `"question-bank"`,
 * `"syllabus-search"`, `"dashboard-summary"`) so eviction size and TTL can be
 * tuned per surface while sharing one implementation.
 *
 * Recommended TTLs mirror CLAUDE.md #13.3/#13.4 — callers can always override
 * per call, but should have a specific reason to go slower than these
 * (dynamic/critical data — payments, entitlements, exam submissions,
 * attendance locking, publishing state — must NOT go through this cache at
 * all; fetch it fresh or use an explicit, short, invalidation-driven cache
 * next to the write path instead).
 */

import { MemoryCache } from './memoryCache.js'
import { createSearchCacheKey, createSearchCacheKeyPrefix, normalizeSearchText } from './cacheKeys.js'

export const CACHE_TTL = {
  STATIC_FRAMEWORK: 12 * 60 * 60 * 1000, // static curriculum framework data: 6–24h
  CATALOGUE: 3 * 60 * 60 * 1000, // grade/subject catalogues, topics/subtopics/competencies: 1–6h
  PAST_PAPER_METADATA: 30 * 60 * 1000, // public past-paper metadata: 15–60min
  USER_SEARCH: 5 * 60 * 1000, // user search results: 2–10min
  TEACHER_DOCUMENTS: 90 * 1000, // teacher documents/assessments: 30–120s
  LEARNER_LIST: 90 * 1000, // learner lists: 30–120s
  DASHBOARD_SUMMARY: 45 * 1000, // dashboard summaries: 30–60s
  AI_STATUS: 10 * 1000, // AI generation status while processing: 5–15s
  LOCAL_CATALOGUE_SEARCH: 20 * 60 * 1000, // local catalogue searches: 10–30min
  FIRESTORE_SEARCH: 3 * 60 * 1000, // Firestore search results: 2–5min
  ADMIN_SEARCH: 60 * 1000, // large admin searches: 30–120s
}

const DEV = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV)

/** @type {Map<string, MemoryCache>} */
const caches = new Map()

/** Get (or lazily create) the shared MemoryCache for a search scope. */
export function getSearchCache(scope, { ttlMs = CACHE_TTL.FIRESTORE_SEARCH, maxSize = 100, debug = DEV } = {}) {
  let cache = caches.get(scope)
  if (!cache) {
    cache = new MemoryCache({ name: `search:${scope}`, ttlMs, maxSize, debug })
    caches.set(scope, cache)
  }
  return cache
}

/**
 * Run a tenant-scoped search/read through the cache, deduping concurrent
 * identical requests and never mixing results across users/schools/
 * curricula/grades — every field that affects the result must be in
 * `keyFields` (see createSearchCacheKey). A rejected `fetcher` propagates and
 * is never cached (CLAUDE.md #13.15).
 *
 * @param {object} keyFields fields for createSearchCacheKey (`scope` required)
 * @param {() => Promise<any>} fetcher performs the real search/read
 * @param {{ ttlMs?: number, staleAfterMs?: number, cache?: MemoryCache, onFresh?: (v:any) => void, onBackgroundError?: (e:any) => void }} [opts]
 * @returns {Promise<any>}
 */
export function cachedSearch(keyFields, fetcher, opts = {}) {
  if (!keyFields?.scope) throw new Error('cachedSearch requires keyFields.scope')
  const cache = opts.cache || getSearchCache(keyFields.scope, { ttlMs: opts.ttlMs })
  const key = createSearchCacheKey(keyFields)
  return cache.getOrSet(key, fetcher, opts)
}

/**
 * Invalidate cached searches for a scope. With no extra fields, clears the
 * whole scope. With `prefixFields` (e.g. `{ userId, schoolId }`), only
 * entries under that tenant prefix are removed — see
 * `createSearchCacheKeyPrefix` for the field-order rule.
 *
 * @example
 *   // After a mutation, per CLAUDE.md #13.7:
 *   invalidateSearchScope('assessment-list', { userId, schoolId })
 */
export function invalidateSearchScope(scope, prefixFields) {
  const cache = caches.get(scope)
  if (!cache) return 0
  if (!prefixFields) return cache.clear()
  return cache.invalidatePrefix(createSearchCacheKeyPrefix({ scope, ...prefixFields }))
}

/** Clear every registered search cache — used on logout (CLAUDE.md #13.1/#13.9). */
export function clearAllSearchCaches() {
  let total = 0
  for (const cache of caches.values()) total += cache.clear()
  return total
}

/** Test-only: drop every registered scope cache entirely (not just its entries). */
export function _resetSearchCachesForTests() {
  caches.clear()
}

export { normalizeSearchText }
