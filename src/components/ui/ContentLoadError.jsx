/**
 * ContentLoadError — the shared "we couldn't load this" panel.
 *
 * Deliberately distinct from EmptyState ("nothing here yet"): a read FAILURE
 * and an EMPTY result are different states and must not look the same to a
 * learner. A Firestore outage or dropped connection should say "try again",
 * not "your teacher hasn't published anything" — that false-negative was the
 * notes/lessons/results bug this component fixes.
 *
 * Palette-agnostic (literal red) so it reads identically on the themed
 * dashboards and the hard-coded cream/neutral notes & lessons surfaces.
 */
import { AlertTriangle, RefreshCw } from './icons'

export default function ContentLoadError({
  title = 'Couldn’t load this',
  message = 'We couldn’t load this right now. Please check your connection and try again.',
  onRetry,
  className = '',
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-red-300 bg-red-50 px-6 py-10 text-center ${className}`}
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <AlertTriangle className="h-6 w-6 text-red-600" />
      </div>
      <h3 className="mb-1 text-lg font-black text-red-900">{title}</h3>
      <p className="max-w-sm text-sm text-red-700">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-red-700 bg-white px-4 py-1.5 text-sm font-bold text-red-700 transition hover:bg-red-100"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      )}
    </div>
  )
}
