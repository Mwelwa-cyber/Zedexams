import { Check } from 'lucide-react'
import { WIZARD_STEPS } from './wizardSteps'

/**
 * WizardProgress — the five-point step indicator.
 *
 * Two shapes, one data model:
 *   - variant="dots" (default): the horizontal ●━━●━━○ track for mobile/tablet.
 *   - variant="rail":           the vertical desktop step list with titles.
 *
 * Completed steps render a check, the active step is highlighted, and steps
 * up to `maxReachable` are clickable. Never colour-only: completed steps get
 * the check glyph and the active step gets aria-current="step" + a label.
 *
 * Props:
 *   currentStep   : number — active 0-based step
 *   completed     : boolean[] — per-step "is valid/complete" flags
 *   maxReachable  : number — highest step index the teacher may jump to
 *   onStepClick   : (index) => void
 *   variant       : 'dots' | 'rail'
 */
export function WizardProgress({ currentStep, completed = [], maxReachable = 0, onStepClick, variant = 'dots' }) {
  const steps = WIZARD_STEPS

  if (variant === 'rail') {
    return (
      <nav aria-label="Lesson plan steps">
        <ol className="space-y-1.5">
          {steps.map((step, i) => {
            const isActive = i === currentStep
            const isDone = Boolean(completed[i]) && !isActive
            const reachable = i <= maxReachable
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => reachable && onStepClick?.(i)}
                  disabled={!reachable}
                  aria-current={isActive ? 'step' : undefined}
                  className={[
                    'flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors',
                    isActive
                      ? 'border-card-border bg-accent-tint shadow-[0_2px_0_var(--zt-card-border)]'
                      : isDone
                        ? 'border-transparent bg-transparent hover:bg-card'
                        : reachable
                          ? 'border-transparent bg-transparent hover:bg-card'
                          : 'border-transparent bg-transparent opacity-45 cursor-not-allowed',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'grid h-7 w-7 flex-shrink-0 place-items-center rounded-full border-2 text-[12px] font-extrabold',
                      isDone
                        ? 'border-card-border bg-[#16a34a] text-white'
                        : isActive
                          // text-on-accent, not text-white: two themes have an
                        // accent light enough that white sits at ~3:1 on it.
                        ? 'border-card-border bg-accent text-on-accent'
                          : 'border-line bg-card text-ink-muted',
                    ].join(' ')}
                    aria-hidden="true"
                  >
                    {isDone ? <Check size={14} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={['block text-[12.5px] font-bold leading-tight', isActive ? 'text-ink' : 'text-ink-muted'].join(' ')}>
                      {step.title}
                    </span>
                    <span className="sr-only">
                      {isDone ? ' — completed' : isActive ? ' — current step' : ''}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
    )
  }

  // ── Dots track (mobile / tablet) ──
  return (
    <div
      className="flex items-center"
      role="group"
      aria-label={`Step ${currentStep + 1} of ${steps.length}: ${steps[currentStep]?.title ?? ''}`}
    >
      {steps.map((step, i) => {
        const isActive = i === currentStep
        const isDone = Boolean(completed[i]) && !isActive
        const reachable = i <= maxReachable
        return (
          <div key={step.id} className={['flex items-center', i > 0 ? 'flex-1' : ''].join(' ')}>
            {i > 0 && (
              <span
                className={[
                  'mx-1 h-[3px] flex-1 rounded-full',
                  i <= currentStep ? 'bg-accent' : 'bg-line',
                ].join(' ')}
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              onClick={() => reachable && onStepClick?.(i)}
              disabled={!reachable}
              aria-current={isActive ? 'step' : undefined}
              aria-label={`Step ${i + 1}: ${step.title}${isDone ? ' (completed)' : ''}`}
              className={[
                // ≥44px touch target via padding around the visual dot
                'grid h-11 w-11 flex-shrink-0 place-items-center rounded-full',
                reachable ? '' : 'cursor-not-allowed',
              ].join(' ')}
            >
              <span
                className={[
                  'grid place-items-center rounded-full border-2 transition-all',
                  isActive
                    ? 'h-[22px] w-[22px] border-card-border bg-accent shadow-[0_0_0_3px_rgba(217,119,87,0.25)]'
                    : isDone
                      ? 'h-[20px] w-[20px] border-card-border bg-[#16a34a] text-white'
                      : 'h-[16px] w-[16px] border-line bg-card',
                ].join(' ')}
                aria-hidden="true"
              >
                {isDone ? <Check size={11} strokeWidth={3.5} className="text-white" /> : null}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
