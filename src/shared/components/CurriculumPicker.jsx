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
 * Colours all come from the workspace theme tokens (--zt-*) via the
 * `.lps-curriculum-*` classes in lessonStudio.css — this component mounts in
 * three different hosts (lesson wizard, StudioCurriculumSelector, assessment
 * slide-over) and hard-coded light values here used to leave it cream-on-dark
 * under the Night theme.
 *
 * Props:
 *   curriculumMode: 'cbc' | 'previous' | null
 *   onSelect: (mode: 'cbc' | 'previous') => void
 */

const CHECK = (
  <span
    className="lps-curriculum-card__check ml-auto grid h-5 w-5 flex-shrink-0 place-items-center self-center rounded-full"
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
        'lps-lift lps-curriculum-card flex w-full items-start gap-3 rounded-2xl px-3.5 py-3 text-left transition-all',
        selected ? 'is-selected' : '',
      ].join(' ').trim()}
    >
      <span
        className="lps-curriculum-card__tile grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl text-[20px] leading-none"
        aria-hidden="true"
      >
        {emoji}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="lps-curriculum-card__title text-[12.5px] font-bold leading-tight">
            {title}
          </span>
          {recommended && (
            <span className="lps-curriculum-card__badge inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide">
              Recommended
            </span>
          )}
        </span>
        <span className="lps-curriculum-card__desc mt-0.5 block text-[11px] leading-snug">
          {description}
        </span>
      </span>

      {selected && CHECK}
    </button>
  )
}

export function CurriculumPicker({ curriculumMode, onSelect, embedded = false }) {
  return (
    <div className={embedded ? '' : 'lps-curriculum-banner sticky top-0 z-10 border-b px-4 pb-3.5 pt-3.5 backdrop-blur'}>
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
