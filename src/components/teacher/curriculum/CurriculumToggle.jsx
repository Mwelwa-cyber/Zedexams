/**
 * CurriculumToggle — the compact segmented control for the CBC vs Previous
 * curriculum choice.
 *
 * Replaces the two large CurriculumPicker cards on generator studios
 * (Worksheet, Rubric, Homework, Mark Schedule, Class Timetable) where the
 * cards cost ~180px per page and gated every field below them behind a
 * "Choose a curriculum first…" chain. CBC arrives pre-selected on those
 * surfaces (it is the recommended default), so the cascade is live
 * immediately.
 *
 * The Lesson Plan Studio keeps its card picker — this is an alternative
 * RENDERING of the same choice, never a fourth source of truth: the value
 * vocabulary is the existing 'cbc' | 'previous'.
 *
 * Accessibility contract matches CurriculumPicker: role="radiogroup" with
 * two role="radio" buttons, selection never conveyed by colour alone (the
 * selected segment carries a ✓).
 */

import { Check } from 'lucide-react'

const OPTIONS = [
  { mode: 'cbc', label: 'CBC', hint: 'Recommended' },
  { mode: 'previous', label: 'Previous curriculum', hint: null },
]

export default function CurriculumToggle({ value, onSelect, disabled = false, label = 'Curriculum' }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="studio-label !mb-0">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex overflow-hidden rounded-xl border-2 border-card-border bg-card"
      >
        {OPTIONS.map(({ mode, label: optLabel, hint }) => {
          const selected = value === mode
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onSelect?.(mode)}
              className={`inline-flex min-h-[38px] items-center gap-1.5 px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${
                selected ? 'bg-accent text-on-accent' : 'bg-transparent text-ink-muted hover:text-ink'
              }`}
            >
              {selected && <Check size={13} aria-hidden="true" />}
              {optLabel}
              {hint && !selected && (
                <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">· {hint}</span>
              )}
              {hint && selected && (
                <span className="text-[10px] font-bold uppercase tracking-wide opacity-85">· {hint}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
