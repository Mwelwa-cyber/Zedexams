/**
 * CurriculumPicker — sticky banner at the top of the studio sidebar.
 *
 * Two premium selection cards for curriculum choice (large icon, title, short
 * description, a "Recommended" badge on CBC, and a checkmark on the selected
 * card). Before a curriculum is chosen, the rest of the sidebar is inert
 * (handled by the parent via the `disabled` prop on downstream sections).
 *
 * The radiogroup / role="radio" / aria-checked semantics are kept intact so the
 * control stays accessible and the existing behaviour tests pass.
 *
 * Props:
 *   curriculumMode: 'cbc' | 'previous' | null
 *   onSelect: (mode: 'cbc' | 'previous') => void
 */

const CHECK = (
  <span
    className="ml-auto grid h-5 w-5 flex-shrink-0 place-items-center self-center rounded-full bg-blue-600 text-white"
    aria-hidden="true"
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  </span>
)

function CurriculumCard({ mode, emoji, title, description, recommended, selected, onSelect }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(mode)}
      className={[
        'lps-lift flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all',
        selected
          ? 'border-blue-500 bg-blue-50 lps-card-glow'
          : 'border-[#e0d7c8] bg-white hover:border-[#cfc3ae] hover:bg-[#fdfbf7] lps-soft-shadow',
      ].join(' ')}
    >
      <span
        className={[
          'grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl text-[20px] leading-none',
          selected ? 'bg-blue-100' : 'bg-[#f5efe1]',
        ].join(' ')}
        aria-hidden="true"
      >
        {emoji}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={[
              'text-[12.5px] font-bold leading-tight',
              selected ? 'text-blue-700' : 'text-[#3d3529]',
            ].join(' ')}
          >
            {title}
          </span>
          {recommended && (
            <span className="inline-flex items-center rounded-full border border-[#0F1B2D] bg-[#FF7A1A] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white">
              Recommended
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-[#8a7d6b]">
          {description}
        </span>
      </span>

      {selected && CHECK}
    </button>
  )
}

export function CurriculumPicker({ curriculumMode, onSelect }) {
  return (
    <div className="sticky top-0 z-10 border-b border-[#e5ddd0] bg-[#f5efe1]/95 px-4 pb-3.5 pt-3.5 backdrop-blur">
      <p className="mb-2.5">
        <span className="lps-eyebrow">Curriculum</span>
      </p>

      <div role="radiogroup" aria-label="Curriculum" className="flex flex-col gap-2.5">
        <CurriculumCard
          mode="cbc"
          emoji="📘"
          title="Competency-Based Curriculum (CBC)"
          description="Learner-centred • Competency-based"
          recommended
          selected={curriculumMode === 'cbc'}
          onSelect={onSelect}
        />
        <CurriculumCard
          mode="previous"
          emoji="📗"
          title="Previous Curriculum"
          description="Traditional syllabus • Outcome-based"
          selected={curriculumMode === 'previous'}
          onSelect={onSelect}
        />
      </div>
    </div>
  )
}
