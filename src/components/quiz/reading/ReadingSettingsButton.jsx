/**
 * The "Aa" reading-settings trigger. A real <button> (not a clickable div) with
 * an accessible label, sized to a comfortable touch target. Sits in the quiz
 * progress row next to the score.
 */
export default function ReadingSettingsButton({ onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open reading settings"
      title="Reading settings"
      className={`inline-flex h-9 min-w-[44px] items-center justify-center gap-1 rounded-full border-2 border-slate-900 bg-white px-3 text-slate-900 shadow-[0_2px_0_#0F1B2D] transition-transform active:translate-y-0.5 ${className}`}
    >
      <span aria-hidden="true" className="text-sm font-black leading-none">
        A<span className="text-[11px]">a</span>
      </span>
    </button>
  )
}
