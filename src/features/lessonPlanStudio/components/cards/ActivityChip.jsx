/**
 * ActivityChip — a small pill badge for a single learning activity label.
 *
 * With `onToggle` it becomes a toggle button the teacher taps to make the
 * activity a focus of this lesson; without it, it is a plain read-only pill.
 *
 * Props:
 *   label: string — text to display inside the chip
 *   selected?: boolean — whether the activity is a chosen focus
 *   onToggle?: () => void — makes the chip selectable
 */
export function ActivityChip({ label, selected = false, onToggle }) {
  if (typeof onToggle !== 'function') {
    return (
      <span className="inline-block rounded-full border border-indigo-200/60 bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800">
        {label}
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={[
        'inline-flex min-h-[32px] items-center gap-1 rounded-full border px-2.5 py-1 text-left text-xs font-medium transition-colors',
        selected
          ? 'border-[#D97757] bg-[#D97757] text-white'
          : 'border-indigo-200/60 bg-indigo-100 text-indigo-800 hover:bg-indigo-200',
      ].join(' ')}
    >
      {selected && <span aria-hidden="true">✓</span>}
      {label}
    </button>
  )
}
