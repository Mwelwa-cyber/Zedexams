import { useState } from 'react'
import { summarizeImportReview } from '../../utils/importReviewSummary.js'

/**
 * In-editor banner that surfaces a record's import-review state when a
 * teacher reopens an imported quiz/assessment. The Phase 7 badge tells
 * teachers from the LIST that something needs review; this banner pulls
 * the warning detail in front of them once they're inside the editor,
 * where the per-question fix actually happens.
 *
 * Renders nothing unless the record is an import flagged as needs_review.
 *
 * Props:
 *   record       — the loaded quiz/assessment doc (or the form mirror of it)
 *   onMarkReviewed — async () => void
 *                   Called when the teacher clicks "Mark as reviewed". The
 *                   parent is expected to write importStatus='success' +
 *                   importWarnings=[] back to Firestore and update local state.
 *   busy         — boolean: caller-controlled disabled state on the button
 *                  for paths that want to gate behind their own save lock.
 */
export default function ImportReviewBanner({ record, onMarkReviewed, busy = false }) {
  const summary = summarizeImportReview(record)
  const [acting, setActing] = useState(false)
  const [showAll, setShowAll] = useState(false)

  if (!summary.isImported || !summary.needsReview) return null

  async function handleClick() {
    if (!onMarkReviewed || acting) return
    setActing(true)
    try {
      await onMarkReviewed()
    } finally {
      setActing(false)
    }
  }

  // Decide which warnings to render — the summarizer already clamped the
  // sample list to keep tooltips terse, but the banner has room for more.
  // showAll flips between the clamped preview and the full list (capped at
  // 20 to stop a runaway importer from producing a wall of text).
  const totalWarnings = Array.isArray(record?.importWarnings) ? record.importWarnings : []
  const visible = showAll ? totalWarnings.slice(0, 20) : summary.sampleWarnings

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 shadow-sm sm:px-5 sm:py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-amber-900 sm:text-base">
            <span aria-hidden="true">⚠️</span> Imported draft — needs review
          </p>
          <p className="mt-1 text-xs font-bold text-amber-800 sm:text-sm">
            {summary.sourceFileName
              ? <>Parsed from <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono">{summary.sourceFileName}</code>.</>
              : 'Parsed from an uploaded document.'}
            {/* Phase 10: lead with the live question-level count when we
                have it — it's what the teacher actually needs to act on.
                Warning count comes second; for pre-Phase-10 docs it's the
                only number we have. */}
            {summary.reviewCount !== null && summary.reviewCount > 0 && (
              <>{' '}<strong>{summary.reviewCount} question{summary.reviewCount === 1 ? '' : 's'}</strong> still flagged for review.</>
            )}
            {summary.warningCount > 0 && (
              <>{' '}The importer raised {summary.warningCount} warning{summary.warningCount === 1 ? '' : 's'} — fix anything that looks wrong, then mark as reviewed.</>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={acting || busy}
          className="shrink-0 rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {acting ? 'Saving…' : '✓ Mark as reviewed'}
        </button>
      </div>

      {visible.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs font-bold text-amber-900 sm:text-sm">
          {visible.map((warning, index) => (
            <li key={index} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 text-amber-600">•</span>
              <span className="leading-snug">{warning}</span>
            </li>
          ))}
        </ul>
      )}

      {!showAll && totalWarnings.length > summary.sampleWarnings.length && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs font-bold text-amber-800 underline hover:text-amber-950"
        >
          Show all {totalWarnings.length} warnings
        </button>
      )}
    </div>
  )
}
