/**
 * The count cache the library's folder views read through.
 *
 * `getCountFromServer` is an aggregate read, not a listener: nothing tells the
 * page a count went stale after a save. This module is the other half of that
 * contract — one cache instance whose keys are the descriptors' keys, so the
 * save path can invalidate exactly the folders a document moved between.
 *
 * Built on `src/utils/cache/memoryCache.js` rather than a new cache: it already
 * has the guarantee that matters here — a fetch in flight when an invalidation
 * lands refuses to write its now-stale result back (the generation counter), so
 * a count read that STARTED before a save can never repopulate the cache after
 * it and serve the pre-save number for the rest of the TTL.
 *
 * Pure JS — no React, no Firebase.
 */

import { createMemoryCache } from '../../utils/cache/memoryCache.js'

/**
 * Short by design. A count is cheap to re-read and a wrong one is a folder that
 * lies, so this leans on invalidation for correctness and on the TTL only as a
 * backstop for changes made in another tab or on another device.
 */
const COUNT_TTL_MS = 2 * 60 * 1000

/** A teacher's library is ~15 cards per level across 12 studios and 2 years. */
const MAX_ENTRIES = 400

export const libraryCountCache = createMemoryCache({
  name: 'library-counts',
  ttlMs: COUNT_TTL_MS,
  maxSize: MAX_ENTRIES,
})

/**
 * Read a count through the cache. `fetcher` is invoked only on a miss, and only
 * a successful result is cached — a failed count leaves the cache untouched
 * rather than pinning a zero to the folder for two minutes.
 *
 * @param {string} key      a descriptor key from queries.js
 * @param {() => Promise<number>} fetcher
 */
export function readCount(key, fetcher) {
  return libraryCountCache.getOrSet(key, fetcher)
}

/** Drop exact keys. Returns how many entries were removed. */
export function invalidateKeys(keys = []) {
  let removed = 0
  for (const key of keys) {
    if (libraryCountCache.delete(key)) removed += 1
  }
  return removed
}

/** Drop every entry beneath a key prefix (see folderCountKeyPrefix). */
export function invalidatePrefixes(prefixes = []) {
  let removed = 0
  for (const prefix of prefixes) {
    removed += libraryCountCache.invalidatePrefix(prefix) || 0
  }
  return removed
}

/** Wipe everything — logout, or a teacher switching account. */
export function clearLibraryCounts() {
  libraryCountCache.clear()
}
