/**
 * DraftRecoveryPrompt — the "we found an unfinished draft" banner shown on
 * studio load when useDraftManager has a recoverable draft.
 *
 * Spread the hook straight in, plus a human label:
 *   <DraftRecoveryPrompt {...draft} label="worksheet" />
 *
 * The copy adapts to where the draft came from — this device vs. another device
 * (cross-device recovery, from the last-write-wins merge).
 */

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

export default function DraftRecoveryPrompt({
  recovery,
  source,
  acceptRecovery,
  discardRecovery,
  label = 'draft',
}) {
  if (!recovery?.available) return null

  const savedAt = recovery.payload?.savedAt
  const fromOtherDevice = source === 'remote'

  return (
    <div
      role="alertdialog"
      aria-label="Unfinished draft found"
      data-print="hide"
      className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm shadow-sm dark:border-amber-700/60 dark:bg-amber-900/20 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="text-lg">📝</span>
        <div>
          <p className="font-semibold text-amber-900 dark:text-amber-200">
            We found an unfinished {label}.
          </p>
          <p className="text-amber-800/90 dark:text-amber-300/80">
            {fromOtherDevice
              ? `Recovered from another device — last edited ${relative(savedAt)}.`
              : `Recovered from ${relative(savedAt)}.`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={acceptRecovery}
          className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white shadow-sm transition hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          Continue editing
        </button>
        <button
          type="button"
          onClick={discardRecovery}
          className="rounded-lg border border-amber-300 bg-white/70 px-3 py-1.5 font-medium text-amber-900 transition hover:bg-white dark:border-amber-700/60 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-900/30"
        >
          Discard
        </button>
      </div>
    </div>
  )
}
