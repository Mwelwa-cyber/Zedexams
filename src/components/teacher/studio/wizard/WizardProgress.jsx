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
                      ? 'border-[#0F1B2D] bg-[#FFF4E8] shadow-[0_2px_0_#0F1B2D]'
                      : isDone
                        ? 'border-transparent bg-transparent hover:bg-white/70'
                        : reachable
                          ? 'border-transparent bg-transparent hover:bg-white/70'
                          : 'border-transparent bg-transparent opacity-45 cursor-not-allowed',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'grid h-7 w-7 flex-shrink-0 place-items-center rounded-full border-2 text-[12px] font-extrabold',
                      isDone
                        ? 'border-[#0F1B2D] bg-[#16a34a] text-white'
                        : isActive
                          ? 'border-[#0F1B2D] bg-[#FF7A1A] text-white'
                          : 'border-[#c9c0b0] bg-white text-[#7a6d5d]',
                    ].join(' ')}
                    aria-hidden="true"
                  >
                    {isDone ? <Check size={14} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={['block text-[12.5px] font-bold leading-tight', isActive ? 'text-[#0F1B2D]' : 'text-[#4A5A6E]'].join(' ')}>
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
                  i <= currentStep ? 'bg-[#FF7A1A]' : 'bg-[#ddd3be]',
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
                    ? 'h-[22px] w-[22px] border-[#0F1B2D] bg-[#FF7A1A] shadow-[0_0_0_3px_rgba(255,122,26,0.25)]'
                    : isDone
                      ? 'h-[20px] w-[20px] border-[#0F1B2D] bg-[#16a34a] text-white'
                      : 'h-[16px] w-[16px] border-[#c9c0b0] bg-white',
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
