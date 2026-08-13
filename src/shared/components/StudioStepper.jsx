/**
 * StudioStepper — the compact horizontal wizard stepper shared by the
 * Lesson Plan Studio and the Class Timetable Studio setup wizard.
 *
 * Numbered dots + short labels with connectors; the current step is
 * terracotta; completed steps show a ✓. Horizontally scrollable on narrow
 * screens (no wrapping — the row keeps its single-line shape).
 *
 *   <StudioStepper
 *     steps={[{ id: 'setup', short: 'Setup' }, …]}
 *     currentIndex={0}
 *     completed={[true, false, …]}        // optional
 *     maxReachable={2}                    // optional — steps beyond are disabled
 *     onStepClick={(i) => …}              // optional — omit for display-only
 *   />
 */

import { Check } from 'lucide-react'

export default function StudioStepper({
  steps = [],
  currentIndex = 0,
  completed = [],
  maxReachable = Infinity,
  onStepClick = null,
  ariaLabel = 'Steps',
}) {
  if (!steps.length) return null

  return (
    <nav aria-label={ariaLabel} className="no-scrollbar overflow-x-auto pb-1">
      <ol className="flex min-w-max items-center">
        {steps.map((step, i) => {
          const isCurrent = i === currentIndex
          const isDone = Boolean(completed[i]) && !isCurrent
          const clickable = Boolean(onStepClick) && i <= maxReachable
          const dotCls = isCurrent
            ? 'bg-accent text-on-accent'
            : isDone
              ? 'bg-accent-tint text-accent-text'
              : 'bg-black/[.07] text-ink-muted dark:bg-white/10'
          return (
            <li key={step.id || step.short || i} className="flex items-center">
              {i > 0 && (
                <span aria-hidden="true" className="mx-2 h-0.5 w-6 shrink-0 rounded bg-black/10 dark:bg-white/15" />
              )}
              <button
                type="button"
                disabled={!clickable}
                onClick={clickable ? () => onStepClick(i) : undefined}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-1 py-0.5 text-[12.5px] font-bold ${
                  isCurrent ? 'text-ink' : 'text-ink-muted'
                } ${clickable ? 'cursor-pointer hover:text-ink' : 'cursor-default'}`}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11.5px] font-extrabold ${dotCls}`}
                >
                  {isDone ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                {step.short || step.title}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
