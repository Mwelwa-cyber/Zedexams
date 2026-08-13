import { BookMarked } from 'lucide-react'

const LABELS = {
  cbc: 'CBC — Competency-Based Curriculum',
  previous: 'Previous Curriculum — Outcomes-Based',
}

/**
 * CurriculumCompactField — once a curriculum has been chosen, the two large
 * selection cards collapse into this single line so they don't take over every
 * later view. "Change" re-opens the full picker.
 *
 * Deliberately NOT a card: no border, no eyebrow, no confirmation tick. It sat
 * between the "Set up for you" context card and the form as a full-width panel
 * repeating a chip and a Change action that card already carried, which is why
 * the wizard now renders it only when that card is absent. Repeating the same
 * fact in two shapes is what made the step look busier than it is — a settled
 * choice states itself in one line.
 *
 * Props:
 *   curriculumMode : 'cbc' | 'previous'
 *   onChange       : () => void — re-open the full curriculum picker
 */
export function CurriculumCompactField({ curriculumMode, onChange }) {
  if (!curriculumMode) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[12.5px] leading-snug">
      <BookMarked size={15} aria-hidden="true" className="flex-none text-ink-muted" />
      <span className="font-semibold text-ink-muted">Curriculum:</span>
      <span className="min-w-0 font-bold text-ink">{LABELS[curriculumMode] ?? curriculumMode}</span>
      <span aria-hidden="true" className="text-ink-muted">·</span>
      <button
        type="button"
        onClick={onChange}
        className="font-bold text-accent-text underline underline-offset-2 hover:no-underline"
        aria-label="Change curriculum"
      >
        Change
      </button>
    </div>
  )
}
