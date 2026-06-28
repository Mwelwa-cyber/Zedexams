/**
 * CurriculumPicker — sticky banner at the top of the studio sidebar.
 *
 * Displays two large pill buttons for curriculum selection. Before a
 * curriculum is chosen, the rest of the sidebar is inert (handled by the
 * parent via the `disabled` prop on downstream sections).
 *
 * Props:
 *   curriculumMode: 'cbc' | 'previous' | null
 *   onSelect: (mode: 'cbc' | 'previous') => void
 */
export function CurriculumPicker({ curriculumMode, onSelect }) {
  return (
    <div className="sticky top-0 z-10 bg-[#f5efe1] border-b border-[#e5ddd0] px-4 pt-4 pb-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#a39d8e] mb-2">
        Curriculum
      </p>

      <div role="radiogroup" aria-label="Curriculum" className="flex gap-2">
        {/* CBC button */}
        <button
          type="button"
          role="radio"
          aria-checked={curriculumMode === 'cbc'}
          onClick={() => onSelect('cbc')}
          className={[
            'flex-1 flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors',
            curriculumMode === 'cbc'
              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
              : 'border-[#d9cfbe] bg-white hover:bg-[#f9f5ef]',
          ].join(' ')}
        >
          <span className="text-base leading-none" aria-hidden="true">📘</span>
          <span
            className={[
              'text-[11px] font-semibold leading-tight',
              curriculumMode === 'cbc' ? 'text-blue-700' : 'text-[#3d3529]',
            ].join(' ')}
          >
            Competency-Based Curriculum (CBC)
          </span>
        </button>

        {/* Previous Curriculum button */}
        <button
          type="button"
          role="radio"
          aria-checked={curriculumMode === 'previous'}
          onClick={() => onSelect('previous')}
          className={[
            'flex-1 flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors',
            curriculumMode === 'previous'
              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
              : 'border-[#d9cfbe] bg-white hover:bg-[#f9f5ef]',
          ].join(' ')}
        >
          <span className="text-base leading-none" aria-hidden="true">📗</span>
          <span
            className={[
              'text-[11px] font-semibold leading-tight',
              curriculumMode === 'previous' ? 'text-blue-700' : 'text-[#3d3529]',
            ].join(' ')}
          >
            Previous Curriculum
          </span>
        </button>
      </div>
    </div>
  )
}
