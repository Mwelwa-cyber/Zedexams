/**
 * OnboardingTooltip — a small positioned hint bubble
 *
 * Props:
 *   text      — tooltip message
 *   position  — 'top' | 'bottom' | 'left' | 'right' (default 'bottom')
 *   onDismiss — called when user clicks ×
 *   visible   — boolean
 */
export default function OnboardingTooltip({ text, position = 'bottom', onDismiss, visible }) {
  if (!visible) return null

  const arrow = {
    top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left:   'right-full top-1/2 -translate-y-1/2 mr-2',
    right:  'left-full top-1/2 -translate-y-1/2 ml-2',
  }

  return (
    <div
      className={`absolute z-50 animate-scale-in ${arrow[position]}`}
      style={{ width: 'max-content', maxWidth: 220 }}
    >
      <div className="relative bg-indigo-600 text-white text-xs font-bold rounded-xl px-3 py-2 shadow-lg">
        <span>{text}</span>
        <button
          onClick={onDismiss}
          className="ml-2 text-white/70 hover:text-white font-black min-h-0 p-0 bg-transparent shadow-none inline leading-none"
          aria-label="Dismiss tip"
        >
          ×
        </button>
        {/* Arrow pointer */}
        {position === 'bottom' && (
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-indigo-600" />
        )}
        {position === 'top' && (
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-indigo-600" />
        )}
        {position === 'right' && (
          <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-indigo-600" />
        )}
        {position === 'left' && (
          <span className="absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent border-l-indigo-600" />
        )}
      </div>
    </div>
  )
}
