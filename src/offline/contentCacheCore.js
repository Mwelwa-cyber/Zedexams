/**
 * contentCacheCore — the pure decision layer for the intelligent offline cache.
 *
 * No browser APIs, no IndexedDB, no React — just the metadata model and the
 * eviction / freshness / dedup maths, so it unit-tests under plain `node` (see
 * contentCacheCore.test.js). offlineStore.js owns the IndexedDB I/O and calls
 * these helpers to decide *what* to keep, drop, or refresh.
 *
 * An entry's metadata:
 *   {
 *     key,          // stable dedup id: `${type}:${id}` (see cacheKey)
 *     type,         // one of CACHEABLE_TYPES
 *     id,           // domain id (quizId, paperId, …)
 *     version,      // server version/etag/updatedAt for change detection
 *     size,         // approx bytes on device
 *     createdAt,    // first cached (ms)
 *     lastAccessed, // last read (ms) — drives LRU
 *     accessCount,  // frequency — protects hot content from eviction
 *     pinned,       // user tapped "Download for offline" → never auto-evict
 *     tmp,          // scratch/derived file → first to go, swept aggressively
 *   }
 */

/** Default ceiling for auto-managed (non-pinned) cache bytes: 80 MB. */
export const DEFAULT_CACHE_BUDGET = 80 * 1024 * 1024
/** Idle time after which an unused, non-pinned entry is a stale-sweep candidate: 30 days. */
export const STALE_TTL = 30 * 24 * 60 * 60 * 1000
/** Temp files are swept far sooner: 24 hours. */
export const TMP_TTL = 24 * 60 * 60 * 1000

/**
 * Stable, collision-free cache key for a piece of content. Same content →
 * same key on every device, which is how duplicate downloads are prevented
 * (Objective 5) — a second request for the same {type,id} hits the existing
 * entry instead of creating a new one.
 * @param {string} type
 * @param {string} id
 * @returns {string}
 */
export function cacheKey(type, id) {
  return `${String(type).toLowerCase()}:${String(id)}`
}

/**
 * Build a fresh metadata record for a newly-cached entry.
 * @param {object} spec
 * @returns {object}
 */
export function newEntry({ type, id, version = null, size = 0, pinned = false, tmp = false, now = Date.now() }) {
  return {
    key: cacheKey(type, id),
    type: String(type).toLowerCase(),
    id: String(id),
    version: version == null ? null : String(version),
    size: Number(size) || 0,
    createdAt: now,
    lastAccessed: now,
    accessCount: 1,
    pinned: Boolean(pinned),
    tmp: Boolean(tmp),
  }
}

/**
 * Return a copy of `entry` marked as freshly accessed (LRU + frequency bump).
 * Pure — never mutates the input.
 * @param {object} entry
 * @param {number} now
 * @returns {object}
 */
export function touchEntry(entry, now = Date.now()) {
  return { ...entry, lastAccessed: now, accessCount: (entry.accessCount || 0) + 1 }
}

/**
 * Decide whether a cached entry needs re-downloading given the server's current
 * version marker. `null`/missing server version means "can't tell" → treat as
 * fresh (don't waste data re-fetching on a flaky signal). A changed version
 * means only THIS file needs updating — the caller fetches just the delta
 * (Objective 2: download only changed files).
 * @param {object|null} entry cached metadata (or null if not cached)
 * @param {string|number|null} serverVersion
 * @returns {boolean}
 */
export function needsRefresh(entry, serverVersion) {
  if (!entry) return true // not cached at all → must fetch
  if (serverVersion == null) return false // no signal → keep what we have
  return String(entry.version) !== String(serverVersion)
}

/**
 * Merge a list of freshly-seen entries with the existing set, deduping by key.
 * The newest metadata wins for size/version, but access stats are preserved
 * (a re-download of a hot item shouldn't reset its LRU standing). Prevents the
 * duplicate-download / duplicate-record class of bug.
 * @param {object[]} existing
 * @param {object[]} incoming
 * @returns {object[]}
 */
export function mergeEntries(existing = [], incoming = []) {
  const byKey = new Map()
  for (const e of existing) byKey.set(e.key, e)
  for (const inc of incoming) {
    const prev = byKey.get(inc.key)
    if (prev) {
      byKey.set(inc.key, {
        ...prev,
        ...inc,
        createdAt: prev.createdAt,
        accessCount: Math.max(prev.accessCount || 0, inc.accessCount || 0),
        lastAccessed: Math.max(prev.lastAccessed || 0, inc.lastAccessed || 0),
        pinned: prev.pinned || inc.pinned,
      })
    } else {
      byKey.set(inc.key, inc)
    }
  }
  return Array.from(byKey.values())
}

/**
 * Entries whose idle time exceeds their TTL and are NOT pinned — the "remove
 * old cached files that haven't been used for a long time" rule (Objective 5).
 * Temp files use the short TMP_TTL; everything else uses STALE_TTL.
 * @param {object[]} entries
 * @param {number} now
 * @returns {object[]} entries to delete
 */
export function selectStale(entries = [], now = Date.now()) {
  return entries.filter((e) => {
    if (e.pinned) return false // never delete user-marked downloads
    const idle = now - (e.lastAccessed || e.createdAt || now)
    const ttl = e.tmp ? TMP_TTL : STALE_TTL
    return idle > ttl
  })
}

/**
 * A score for eviction priority — LOWER means evict-sooner. Combines recency
 * (primary) with frequency (a tie-breaker that protects hot content). Temp
 * files are pushed to the front of the queue; pinned files are effectively
 * immune (returned as Infinity so they never sort into the evict set).
 * @param {object} entry
 * @param {number} now
 * @returns {number}
 */
export function keepScore(entry, now = Date.now()) {
  if (entry.pinned) return Infinity
  const ageMs = now - (entry.lastAccessed || 0)
  const recency = -ageMs // newer (smaller age) → higher score
  const frequency = (entry.accessCount || 0) * 60 * 1000 // each access ≈ 1 min of "freshness"
  const tmpPenalty = entry.tmp ? -STALE_TTL : 0 // temp files sort out first
  return recency + frequency + tmpPenalty
}

/**
 * Choose which entries to evict so the total non-pinned size fits under
 * `budget`. LRU-with-frequency: sort by keepScore ascending and drop from the
 * bottom until we're under budget. Pinned entries still count toward the total
 * device footprint but are never selected for eviction (the user asked to keep
 * them). Returns the entries to delete.
 * @param {object[]} entries
 * @param {number} budget bytes
 * @param {number} now
 * @returns {object[]}
 */
export function selectEvictions(entries = [], budget = DEFAULT_CACHE_BUDGET, now = Date.now()) {
  const total = entries.reduce((sum, e) => sum + (e.size || 0), 0)
  if (total <= budget) return []

  // Only non-pinned entries are eligible; sort evict-soonest first.
  const evictable = entries
    .filter((e) => !e.pinned)
    .sort((a, b) => keepScore(a, now) - keepScore(b, now))

  const toDelete = []
  let running = total
  for (const e of evictable) {
    if (running <= budget) break
    toDelete.push(e)
    running -= e.size || 0
  }
  return toDelete
}

/**
 * Combined cleanup plan: stale entries + budget evictions, deduped by key.
 * This is what the background maintenance pass runs.
 * @param {object[]} entries
 * @param {{ budget?: number, now?: number }} opts
 * @returns {{ remove: object[], keep: object[] }}
 */
export function planCleanup(entries = [], { budget = DEFAULT_CACHE_BUDGET, now = Date.now() } = {}) {
  const staleKeys = new Set(selectStale(entries, now).map((e) => e.key))
  const survivors = entries.filter((e) => !staleKeys.has(e.key))
  const evictKeys = new Set(selectEvictions(survivors, budget, now).map((e) => e.key))
  const removeKeys = new Set([...staleKeys, ...evictKeys])
  return {
    remove: entries.filter((e) => removeKeys.has(e.key)),
    keep: entries.filter((e) => !removeKeys.has(e.key)),
  }
}
