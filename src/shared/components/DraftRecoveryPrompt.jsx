/**
 * DraftRecoveryPrompt — the "unfinished draft found" strip shown on studio
 * load when useDraftManager has a recoverable draft.
 *
 * Spread the hook straight in, plus a human label:
 *   <DraftRecoveryPrompt {...draft} label="worksheet" />
 *
 * One line, two actions (Continue editing / Discard) — the shared notice
 * style across every studio. The copy adapts to where the draft came from
 * (this device vs. another device, from the last-write-wins merge).
 *
 * Old drafts: when the draft is older than ~7 days and the caller provides
 * `onPreview`, the strip leads with the age and offers Preview before
 * Continue/Discard — a teacher shouldn't blind-resume a two-week-old draft.
 *
 * Colours come from the --zt-banner-* / --zt-accent tokens. The Tailwind
 * amber classes this replaces relied on `dark:` variants that never fire in
 * the teacher workspace (the `dark` class tracks the LEARNER reading theme,
 * not `data-theme='night'`), so every studio showed a light cream bar on the
 * Night theme.
 */

import { PenLine } from 'lucide-react'

const OLD_DRAFT_MS = 7 * 24 * 60 * 60 * 1000

function relative(ms) {
  if (!ms) return 'a moment ago'
  const diff = Date.now() - ms
  if (diff < 60_000) return 'less than a minute ago'
  const min = Math.round(diff / 60_000)
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  return `${Math.round(hr / 24)} day${Math.round(hr / 24) === 1 ? '' : 's'} ago`
}

function ageDays(ms) {
  if (!ms) return 0
  return Math.round((Date.now() - ms) / (24 * 60 * 60 * 1000))
}

export default function DraftRecoveryPrompt({
  recovery,
  source,
  acceptRecovery,
  discardRecovery,
  onPreview = null,
  label = 'draft',
}) {
  if (!recovery?.available) return null

  const savedAt = recovery.payload?.savedAt
  const fromOtherDevice = source === 'remote'
  const isOld = Date.now() - (savedAt || Date.now()) > OLD_DRAFT_MS
  const showPreview = isOld && typeof onPreview === 'function'

  return (
    <div
      role="alertdialog"
      aria-label="Unfinished draft found"
      data-print="hide"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 text-sm shadow-sm"
      style={{ background: 'var(--zt-banner-bg)', borderColor: 'var(--zt-banner-border)', color: 'var(--zt-banner-text)' }}
    >
      <PenLine size={16} aria-hidden="true" className="shrink-0" />
      <p className="min-w-[180px] flex-1">
        <span className="font-semibold">We found an unfinished {label}</span>
        {' — '}
        {showPreview
          ? `${ageDays(savedAt)} days old${fromOtherDevice ? ', from another device' : ''}. Preview it before continuing.`
          : fromOtherDevice
            ? `from another device, ${relative(savedAt)}.`
            : `from ${relative(savedAt)}.`}
      </p>
      <div className="flex shrink-0 gap-2">
        {showPreview && (
          <button
            type="button"
            onClick={onPreview}
            className="rounded-lg border px-3 py-1.5 font-semibold transition hover:opacity-80"
            style={{ borderColor: 'var(--zt-banner-border)', background: 'var(--zt-card)', color: 'var(--zt-text)' }}
          >
            Preview
          </button>
        )}
        <button
          type="button"
          onClick={acceptRecovery}
          className="rounded-lg px-3 py-1.5 font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-amber-500"
          style={{ background: 'var(--zt-accent)', color: 'var(--zt-on-accent)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zt-accent-deep)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--zt-accent)' }}
        >
          Continue editing
        </button>
        <button
          type="button"
          onClick={discardRecovery}
          className="rounded-lg px-3 py-1.5 font-medium transition hover:opacity-75"
        >
          Discard
        </button>
      </div>
    </div>
  )
}
