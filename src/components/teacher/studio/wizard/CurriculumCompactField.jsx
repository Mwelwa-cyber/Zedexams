import { BookMarked, Check } from 'lucide-react'

const LABELS = {
  cbc: 'CBC — Competency-Based Curriculum',
  previous: 'Previous Curriculum — Outcomes-Based',
}

/**
 * CurriculumCompactField — once a curriculum has been chosen, the two large
 * selection cards collapse into this single editable row so they don't take
 * over every later view. "Change" re-opens the full picker.
 *
 * Props:
 *   curriculumMode : 'cbc' | 'previous'
 *   onChange       : () => void — re-open the full curriculum picker
 */
export function CurriculumCompactField({ curriculumMode, onChange }) {
  if (!curriculumMode) return null
  return (
    <div className="rounded-2xl border-2 border-[#0F1B2D] bg-white p-3.5 shadow-[0_2px_0_#0F1B2D]">
      <span className="lps-eyebrow mb-1.5">Curriculum</span>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl border-2 border-[#0F1B2D] bg-[#FFF4E8] text-[#a3422e]" aria-hidden="true">
          <BookMarked size={18} />
        </span>
        <p className="min-w-0 flex-1 text-[13px] font-bold leading-snug text-[#0F1B2D]">
          {LABELS[curriculumMode] ?? curriculumMode}
        </p>
        <span
          className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border border-[#0F1B2D] bg-[#16a34a] text-white"
          aria-hidden="true"
        >
          <Check size={12} strokeWidth={3} />
        </span>
        <button
          type="button"
          onClick={onChange}
          className="lps-btn-ghost flex-shrink-0 px-3 py-1.5 text-[12px]"
          aria-label="Change curriculum"
        >
          Change
        </button>
      </div>
    </div>
  )
}
