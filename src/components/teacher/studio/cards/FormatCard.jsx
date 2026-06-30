/**
 * FormatCard — a clickable card for selecting a lesson plan format.
 *
 * Props:
 *   formatId: 'modern' | 'classic' | 'official'
 *   label: string
 *   selected: boolean
 *   onSelect: () => void
 *   onPreview: () => void — opens a full sample preview of this format (optional)
 *   previewSrc: string — path to the preview thumbnail image
 */
export function FormatCard({ formatId, label, selected, onSelect, onPreview, previewSrc }) {
  return (
    <div
      data-format-id={formatId}
      className={[
        'lps-lift relative flex w-full flex-col items-center rounded-xl border p-1.5 text-center transition-all',
        selected
          ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50 lps-card-glow'
          : 'border-[#d9cfbe] bg-white hover:bg-[#f9f5ef]',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex w-full flex-col items-center text-center"
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

      {typeof onPreview === 'function' && (
        <button
          type="button"
          data-action="preview-format"
          // Stop the click from bubbling to the card's select handler — previewing
          // a format should not change the chosen format.
          onClick={(e) => { e.stopPropagation(); onPreview() }}
          aria-label={`Preview ${label} format`}
          className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-[#d9cfbe] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#5c4a3a] hover:bg-[#f5f0ea]"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Preview
        </button>
      )}
    </div>
  )
}
