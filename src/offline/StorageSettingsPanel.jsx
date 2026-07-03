/**
 * StorageSettingsPanel — Settings → Storage (Objective 7). Shows how much space
 * ZedExams uses on the device, split into cached / downloaded / temporary, with
 * the last-sync time, and the four management actions:
 *   • Clear Cache            — drops auto-managed files, KEEPS user downloads
 *   • Delete Downloaded Files — drops only user-pinned downloads
 *   • Download All for Current Grade — (delegated to the caller via onDownloadGrade)
 *   • Re-sync Everything      — flush the outbox + refresh
 *
 * All numbers come from the pure storageStatsCore so the display logic is
 * tested. Self-contained + theme-aware; drop it anywhere in the settings tree.
 */
import { useCallback, useEffect, useState } from 'react'
import { summarizeStorage, formatBytes, formatRelativeTime } from './storageStatsCore.js'
import { listEntries, clearUnpinned, clearPinned, getMeta } from './offlineStore.js'
import { runMaintenance } from './contentCache.js'
import { useOffline } from './OfflineContext.jsx'

function StatRow({ label, value, hint }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</div>
        {hint ? <div className="text-xs text-slate-400">{hint}</div> : null}
      </div>
      <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{value}</div>
    </div>
  )
}

export default function StorageSettingsPanel({ onDownloadGrade, currentGrade }) {
  const { refresh, pending, online } = useOffline()
  const [summary, setSummary] = useState(() => summarizeStorage([]))
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [entries, lastSyncAt] = await Promise.all([listEntries(), getMeta('lastSyncAt')])
    setSummary(summarizeStorage(entries, { lastSyncAt }))
  }, [])

  useEffect(() => { load() }, [load])

  const withBusy = useCallback(async (fn) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false); await load() }
  }, [load])

  const handleClearCache = () => withBusy(clearUnpinned)
  const handleDeleteDownloads = () => withBusy(clearPinned)
  const handleReSync = () => withBusy(async () => { await runMaintenance(); await refresh() })
  const handleDownloadGrade = () => {
    if (typeof onDownloadGrade === 'function') return withBusy(() => onDownloadGrade(currentGrade))
    return undefined
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Storage &amp; Offline</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Content you view is saved on this device so it opens instantly and works offline.
        </p>
      </header>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        <StatRow label="Total used by ZedExams" value={formatBytes(summary.totalBytes)} hint={`${summary.count} item${summary.count === 1 ? '' : 's'}`} />
        <StatRow label="Cached files" value={formatBytes(summary.cacheBytes)} hint="Auto-managed" />
        <StatRow label="Downloaded content" value={formatBytes(summary.downloadedBytes)} hint={`${summary.downloadedCount} saved for offline`} />
        <StatRow label="Temporary files" value={formatBytes(summary.tmpBytes)} hint={`${summary.tmpCount} temp`} />
        <StatRow label="Last synchronised" value={formatRelativeTime(summary.lastSyncAt)} hint={online ? (pending ? `${pending} waiting to sync` : 'Up to date') : 'Offline'} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={handleClearCache}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Clear Cache
        </button>
        <button
          type="button"
          onClick={handleDeleteDownloads}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Delete Downloaded Files
        </button>
        {typeof onDownloadGrade === 'function' ? (
          <button
            type="button"
            onClick={handleDownloadGrade}
            disabled={busy || !online}
            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {currentGrade ? `Download All for ${currentGrade}` : 'Download All for Current Grade'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleReSync}
          disabled={busy || !online}
          className="rounded-lg border border-sky-300 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950"
        >
          Re-sync Everything
        </button>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        Cached learning content is stored securely on this device and cleared automatically when space is
        low. Account, payment, and subscription details are never stored offline.
      </p>
    </section>
  )
}
