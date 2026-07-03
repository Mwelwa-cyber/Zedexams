/**
 * storageStatsCore — pure helpers for the Settings → Storage panel (Objective
 * 7). Turns a flat list of cache entries into the breakdown the UI shows, and
 * formats byte counts for humans. No browser APIs — unit-tested under `node`.
 */

/**
 * Human-readable byte size. Uses binary units (KiB/MiB) since that's what the
 * device actually reports; keeps one decimal for MB+ so "12.4 MB" reads well.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[i]}`
}

/**
 * Roll a list of cache entries up into the Storage-panel summary. Splits the
 * footprint into the three buckets the UI shows — cached (auto), downloaded
 * (user-pinned), and temporary — plus totals and the newest access time as a
 * cheap "last activity" proxy.
 * @param {object[]} entries contentCacheCore entries
 * @param {{ lastSyncAt?: number|null }} extra
 * @returns {object}
 */
export function summarizeStorage(entries = [], { lastSyncAt = null } = {}) {
  let cacheBytes = 0
  let downloadedBytes = 0
  let tmpBytes = 0
  let totalBytes = 0
  let lastActivityAt = 0

  for (const e of entries) {
    const size = Number(e.size) || 0
    totalBytes += size
    if (e.tmp) tmpBytes += size
    else if (e.pinned) downloadedBytes += size
    else cacheBytes += size
    lastActivityAt = Math.max(lastActivityAt, e.lastAccessed || e.createdAt || 0)
  }

  const byType = {}
  for (const e of entries) {
    byType[e.type] = (byType[e.type] || 0) + (Number(e.size) || 0)
  }

  return {
    count: entries.length,
    downloadedCount: entries.filter((e) => e.pinned).length,
    tmpCount: entries.filter((e) => e.tmp).length,
    cacheBytes,
    downloadedBytes,
    tmpBytes,
    totalBytes,
    byType,
    lastActivityAt: lastActivityAt || null,
    lastSyncAt: lastSyncAt || null,
  }
}

/**
 * Format a "last synchronised N ago" string from a timestamp. Returns 'Never'
 * for a null/absent time. Coarse buckets — the Storage panel doesn't need
 * second precision.
 * @param {number|null} ts
 * @param {number} now
 * @returns {string}
 */
export function formatRelativeTime(ts, now = Date.now()) {
  if (!ts) return 'Never'
  const diff = Math.max(0, now - ts)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
