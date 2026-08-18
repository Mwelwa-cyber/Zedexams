/**
 * One tab in the dashboard's segmented control.
 */
import { Lock } from '../../../../shared/components/icons'
import Icon from '../../../../shared/components/Icon'

// Tab nav matching the screenshot: filled accent pill on the active tab,
// flat muted text on the others. Whole row sits inside a soft track so
// it reads as a segmented control. `accentClass` is unused for now — the
// active pill picks up the user's chosen theme via theme-accent-bg /
// theme-accent-text — but kept in the signature for future grade-tinted
// tabs.
function TabButton({ active, onClick, icon, label, subtitle, accentClass: _accentClass, locked = false, disabled = false }) {
  const tabSurface = active
    ? 'theme-accent-fill theme-on-accent shadow-sm'
    : disabled
      ? 'bg-transparent theme-text-muted'
      : 'bg-transparent theme-text-muted hover:theme-text hover:theme-bg-subtle'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-0 min-w-0 flex-1 flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-full transition-colors ${tabSurface} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <span className="inline-flex max-w-full items-center gap-1.5 text-xs sm:text-sm font-black">
        {locked ? <Icon as={Lock} size="xs" strokeWidth={2.4} /> : <Icon as={icon} size="xs" strokeWidth={2.4} />}
        <span className="truncate">{label}</span>
      </span>
      {subtitle && (
        <span className={`text-[10px] font-bold leading-tight truncate max-w-full ${active ? 'opacity-80' : ''}`}>
          {subtitle}
        </span>
      )}
    </button>
  )
}

export default TabButton
