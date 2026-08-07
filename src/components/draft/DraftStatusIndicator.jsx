/**
 * DraftStatusIndicator — the always-visible "your work is safe" pill for every
 * studio, driven by useDraftManager's return value.
 *
 *   ● Saving…    ● Saved just now    ⚠ Save issue
 *   ⚡ Offline — saved on this device    ▤ Saved on this device only
 *
 * Presentational only: pass `status`, `savedAt`, `online` straight from the hook.
 *
 * The two ordinary states (saving / saved) draw a plain dot in the row's own
 * tone rather than a 🟡/🟢 emoji; the three exceptional ones draw a Lucide
 * glyph. Emoji render at the platform's size and colour, not the row's, so a
 * "green dot" was a different green on every device — and the teacher surfaces
 * are Lucide-only by convention.
 */

import { AlertTriangle, HardDrive, WifiOff } from 'lucide-react'

const CONFIG = {
  idle: null, // nothing to show before the first edit
  saving: { icon: null, label: 'Saving…', tone: 'text-amber-600 dark:text-amber-400' },
  saved: { icon: null, label: 'Saved', tone: 'text-emerald-600 dark:text-emerald-400' },
  offline: { icon: WifiOff, label: 'Offline — saved on this device', tone: 'text-rose-600 dark:text-rose-400' },
  'local-only': { icon: HardDrive, label: 'Saved on this device only (too large to sync)', tone: 'text-slate-600 dark:text-slate-300' },
  error: { icon: AlertTriangle, label: 'Save issue — will retry', tone: 'text-rose-600 dark:text-rose-400' },
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

  const Icon = cfg.icon
  const showTime = effective === 'saved' && savedAt
  return (
    <div
      role="status"
      aria-live="polite"
      data-print="hide"
      className={`inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ring-black/5 backdrop-blur dark:bg-slate-800/70 dark:ring-white/10 ${cfg.tone}`}
      title={savedAt ? `Last synced ${clock(savedAt)}` : undefined}
    >
      {Icon ? (
        <Icon size={13} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
      ) : (
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-current" />
      )}
      <span>{cfg.label}{showTime ? ` ${relative(savedAt)}` : ''}</span>
    </div>
  )
}
