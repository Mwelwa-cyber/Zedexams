/**
 * QuizValidationChecklist — modal showing the pre-publish checklist.
 *
 * Replaces the "first error → toast → bail" UX. Now the teacher sees
 * EVERY issue at once and can fix them in batch instead of clicking
 * Save four times to find four problems.
 *
 * The checks themselves are pure functions in `quizValidation.js`;
 * this component is presentation-only.
 *
 * Props
 *   open      — boolean
 *   onClose   — () => void
 *   issues    — Array<{ id, label, severity, fixable? }>
 *               severity: 'error' (must fix to publish) | 'warn' (ok to publish)
 *   summary   — Array<{ label, ok }> for the "ready" overview list
 */

export default function QuizValidationChecklist({
  open,
  onClose,
  issues = [],
  summary = [],
}) {
  if (!open) return null

  const errors = issues.filter((i) => i.severity !== 'warn')
  const warnings = issues.filter((i) => i.severity === 'warn')
  const allGreen = errors.length === 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Pre-publish checklist"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-base font-black text-slate-900">Pre-publish checklist</h3>
            <p className="text-xs text-slate-500">
              {allGreen
                ? 'All required fields look good — you can publish.'
                : `${errors.length} item${errors.length === 1 ? '' : 's'} to fix before publishing.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {/* High-level checklist: everything that's required is shown,
              with green ticks for satisfied items and red dots for
              missing ones. */}
          {summary.length > 0 && (
            <ul className="space-y-1.5">
              {summary.map((item) => (
                <li key={item.label} className="flex items-start gap-2">
                  {item.ok ? (
                    <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12 5 5L20 7" />
                    </svg>
                  ) : (
                    <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M15 9l-6 6M9 9l6 6" />
                    </svg>
                  )}
                  <span className={item.ok ? 'text-slate-600' : 'font-semibold text-slate-900'}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {errors.length > 0 && (
            <div className="rounded-xl border-2 border-rose-200 bg-rose-50 px-3 py-2">
              <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-rose-700">
                Must fix before publishing
              </p>
              <ul className="space-y-1.5 text-sm text-rose-900">
                {errors.map((issue) => (
                  <li key={issue.id} className="flex items-start gap-1.5">
                    <span aria-hidden="true">•</span>
                    <span>{issue.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2">
              <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-amber-700">
                Worth checking (ok to publish)
              </p>
              <ul className="space-y-1.5 text-sm text-amber-900">
                {warnings.map((issue) => (
                  <li key={issue.id} className="flex items-start gap-1.5">
                    <span aria-hidden="true">•</span>
                    <span>{issue.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {allGreen && warnings.length === 0 && (
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Everything checks out. The quiz is ready to publish.
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary min-h-0 px-3 py-2 text-xs font-bold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
