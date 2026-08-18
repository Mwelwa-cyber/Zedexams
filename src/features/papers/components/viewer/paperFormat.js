/**
 * The viewer's small formatters: a file extension from a storage path, a byte
 * count, a duration and an "updated" timestamp.
 *
 * Pure and string-in/string-out. They were spread through PastPaperViewer at
 * three different depths — two above the page, two below it — which is the
 * usual sign that nobody could find the existing one.
 */

/** Best-effort file extension from a Storage path (drops any query string). */
export function extFromPath(path) {
  const match = /\.([a-z0-9]+)(?:\?|$)/i.exec(String(path || ''))
  return match ? match[1].toLowerCase() : null
}

export function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m ? `${m}m ${s}s` : `${s}s`
}

export function formatUpdated(ts) {
  try {
    const date = ts?.toDate ? ts.toDate() : (ts?.seconds ? new Date(ts.seconds * 1000) : null)
    if (!date) return '—'
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}
