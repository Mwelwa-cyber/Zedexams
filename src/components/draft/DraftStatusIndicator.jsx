/**
 * DraftStatusIndicator — the always-visible "your work is safe" pill for every
 * studio, driven by useDraftManager's return value.
 *
 *   🟡 Saving…    🟢 Saved just now    ☁ Synced    🔴 Offline — saved on device
 *   💾 Saved on this device only (too large to sync)
 *
 * Presentational only: pass `status`, `savedAt`, `online` straight from the hook.
 */

const CONFIG = {
  idle: null, // nothing to show before the first edit
  saving: { dot: '🟡', label: 'Saving…', tone: 'text-amber-600 dark:text-amber-400' },
  saved: { dot: '🟢', label: 'Saved', tone: 'text-emerald-600 dark:text-emerald-400' },
  offline: { dot: '🔴', label: 'Offline — saved on this device', tone: 'text-rose-600 dark:text-rose-400' },
  'local-only': { dot: '💾', label: 'Saved on this device only (too large to sync)', tone: 'text-slate-600 dark:text-slate-300' },
  error: { dot: '⚠️', label: 'Save issue — will retry', tone: 'text-rose-600 dark:text-rose-400' },
}

function relative(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 45_000) return 'just now'
  const min = Math.round(diff / 60_000)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

function clock(ms) {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

export default function DraftStatusIndicator({ status = 'idle', savedAt, online = true }) {
  // When offline but the app thinks the row is "saved", reflect the real state.
  const effective = !online && status === 'saved' ? 'offline' : status
  const cfg = CONFIG[effective]
  if (!cfg) return null

  const showTime = effective === 'saved' && savedAt
  return (
    <div
      role="status"
      aria-live="polite"
      data-print="hide"
      className={`inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ring-black/5 backdrop-blur dark:bg-slate-800/70 dark:ring-white/10 ${cfg.tone}`}
      title={savedAt ? `Last synced ${clock(savedAt)}` : undefined}
    >
      <span aria-hidden="true">{cfg.dot}</span>
      <span>{cfg.label}{showTime ? ` ${relative(savedAt)}` : ''}</span>
    </div>
  )
}
