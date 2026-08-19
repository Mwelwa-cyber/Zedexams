/**
 * The "are you sure" step before the answer sheet is revealed.
 */

function AnswersConfirmDialog({ onCancel, onConfirm }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="answers-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className="theme-card rounded-radius-md max-w-md w-full p-5 shadow-elev-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="answers-confirm-title" className="theme-text font-black text-lg">
          Reveal the answers?
        </h2>
        <p className="theme-text-muted text-sm mt-2 leading-relaxed">
          You'll learn the most if you try the questions yourself first. Are
          you sure you want to see the answers now?
        </p>
        <div className="mt-5 flex flex-col sm:flex-row-reverse gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black hover:opacity-90 min-h-[44px]"
          >
            Yes, show answers
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="theme-card border theme-border rounded-full px-5 py-2.5 text-sm font-black hover:theme-bg-subtle min-h-[44px]"
          >
            Keep trying first
          </button>
        </div>
      </div>
    </div>
  )
}

export default AnswersConfirmDialog
