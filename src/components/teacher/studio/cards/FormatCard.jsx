/**
 * FormatCard — a clickable card for selecting a lesson plan format.
 *
 * Props:
 *   formatId: 'modern' | 'classic' | 'official'
 *   label: string
 *   selected: boolean
 *   onSelect: () => void
 *   previewSrc: string — path to the preview image
 */
export function FormatCard({ formatId, label, selected, onSelect, previewSrc }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-format-id={formatId}
      className={[
        'flex flex-col items-center rounded-lg border p-1.5 text-center transition-colors w-full',
        selected
          ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50'
          : 'border-[#d9cfbe] bg-white hover:bg-[#f9f5ef]',
      ].join(' ')}
    >
      <img
        src={previewSrc}
        alt={`${label} format preview`}
        className="w-full rounded object-cover mb-1.5"
        style={{ aspectRatio: '3/4', maxHeight: 80 }}
      />
      <span
        className={[
          'text-[11px] font-semibold leading-tight',
          selected ? 'text-blue-700' : 'text-[#3d3529]',
        ].join(' ')}
      >
        {label}
      </span>
    </button>
  )
}
