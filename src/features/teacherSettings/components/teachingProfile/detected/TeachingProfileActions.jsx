/**
 * Footer action area of the detected-assignments card. Primary button saves
 * ONLY the selected assignments and continues; secondary skips to the manual
 * setup. Sticky at the bottom of the viewport on mobile (CSS). Double
 * submission is prevented by the `applying` flag; a failed save keeps the
 * teacher's selections (the parent never clears them on error).
 */
export default function TeachingProfileActions({
  selectedCount,
  applying = false,
  error = '',
  onApply,
  onSkip,
}) {
  return (
    <div className="tset-dta-actions">
      {error && (
        <p className="tset-dta-actions__error" role="alert">{error}</p>
      )}
      <div className="tset-dta-actions__buttons">
        <button
          type="button"
          className="tset-btn tset-dta-actions__primary"
          onClick={onApply}
          disabled={applying || selectedCount === 0}
        >
          {applying ? 'Adding…' : `Add ${selectedCount} & continue`}
        </button>
        <button
          type="button"
          className="tset-btn tset-btn--ghost"
          onClick={onSkip}
          disabled={applying}
        >
          Start from scratch
        </button>
      </div>
    </div>
  )
}
