import { summarizeImportReview } from '../../utils/importReviewSummary.js'

/**
 * Inline pill that surfaces a quiz/assessment's import-review state on
 * list views (admin ManageContent, teacher AssessmentList).
 *
 * Three states:
 *   - not imported   → render nothing (caller doesn't need to branch)
 *   - clean import   → green "Imported" pill with the source filename
 *   - needs review   → amber "Needs review" pill with a native tooltip
 *                      listing the first few warning messages, plus the
 *                      total count so the teacher knows how much to read
 *
 * Variant prop ("light" / "dark") switches the colour scheme to match
 * the surrounding palette without forcing two separate components.
 */
export default function ImportReviewBadge({ record, variant = 'light', className = '' }) {
  const summary = summarizeImportReview(record)
  if (!summary.isImported) return null

  const fileLabel = summary.sourceFileName ? ` · ${summary.sourceFileName}` : ''
  const baseClasses = `inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${className}`

  if (!summary.needsReview) {
    return (
      <span
        className={`${baseClasses} ${variant === 'dark'
          ? 'bg-emerald-900/30 text-emerald-200'
          : 'bg-emerald-100 text-emerald-700'}`}
        title={`Imported document: ${summary.sourceFileName || 'unnamed source'}`}
      >
        <span aria-hidden="true">📥</span>
        Imported{fileLabel}
      </span>
    )
  }

  // Build a single tooltip string that the host's native title attribute
  // can render. Better tooltips (rich popover) are a follow-up; this
  // already gets the warnings in front of the teacher with zero new deps.
  const tooltipLines = [
    `Imported from ${summary.sourceFileName || 'unnamed source'}`,
    summary.warningCount > 0
      ? `${summary.warningCount} import warning${summary.warningCount === 1 ? '' : 's'}:`
      : 'Marked as needs review.',
    ...summary.sampleWarnings.map(line => `• ${line}`),
    summary.warningCount > summary.sampleWarnings.length
      ? `(and ${summary.warningCount - summary.sampleWarnings.length} more)`
      : '',
  ].filter(Boolean).join('\n')

  const countSuffix = summary.warningCount > 0
    ? ` · ${summary.warningCount} warning${summary.warningCount === 1 ? '' : 's'}`
    : ''

  return (
    <span
      className={`${baseClasses} ${variant === 'dark'
        ? 'bg-amber-900/30 text-amber-200'
        : 'bg-amber-100 text-amber-700'}`}
      title={tooltipLines}
    >
      <span aria-hidden="true">⚠️</span>
      Needs review{countSuffix}
    </span>
  )
}
