/**
 * ActivityChip — a small pill badge for a single learning activity label.
 *
 * Props:
 *   label: string — text to display inside the chip
 */
export function ActivityChip({ label }) {
  return (
    <span className="inline-block rounded-full border border-indigo-200/60 bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800">
      {label}
    </span>
  )
}
