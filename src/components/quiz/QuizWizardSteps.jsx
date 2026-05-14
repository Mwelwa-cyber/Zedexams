/**
 * Four-step workflow indicator that sits above the quiz editor.
 * Renders as horizontal pill steps on tablet/desktop and a compact
 * "Step 2 of 4" header with progress bar on phones.
 *
 * The component is purely presentational — the parent owns the
 * current step and decides when a step is reachable (e.g., the
 * Publish step is gated on having questions + assignments).
 */

const STEPS = [
  { id: 'create',  label: 'Create',  short: '1', icon: '✏️', description: 'Build your questions.' },
  { id: 'preview', label: 'Preview', short: '2', icon: '👁️', description: 'See it as a learner will.' },
  { id: 'assign',  label: 'Assign',  short: '3', icon: '🎯', description: 'Pick who gets the quiz.' },
  { id: 'publish', label: 'Publish', short: '4', icon: '🚀', description: 'Release it to learners.' },
]

export default function QuizWizardSteps({ activeStep = 'create', completedSteps = [], onStepChange, disabledSteps = [] }) {
  const activeIndex = Math.max(0, STEPS.findIndex((s) => s.id === activeStep))

  return (
    <nav aria-label="Quiz workflow" className="theme-card theme-border rounded-2xl border p-2 sm:p-3">
      {/* Phone layout: compact header + progress bar */}
      <div className="flex items-center justify-between gap-3 sm:hidden">
        <div className="min-w-0">
          <p className="text-eyebrow theme-text-muted">Step {activeIndex + 1} of {STEPS.length}</p>
          <p className="theme-text font-black text-base mt-0.5 truncate">
            {STEPS[activeIndex]?.icon} {STEPS[activeIndex]?.label}
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={STEPS.length}
          aria-valuenow={activeIndex + 1}
          className="theme-bg-subtle h-2 w-24 rounded-full overflow-hidden flex-shrink-0"
        >
          <div
            className="theme-accent-fill h-full rounded-full transition-all duration-300"
            style={{ width: `${((activeIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Tablet/desktop: horizontal pill steps */}
      <ol className="hidden sm:flex items-center gap-1 overflow-x-auto" role="list">
        {STEPS.map((step, index) => {
          const completed = completedSteps.includes(step.id)
          const active = step.id === activeStep
          const disabled = disabledSteps.includes(step.id)
          return (
            <li key={step.id} className="flex items-center min-w-0">
              <button
                type="button"
                onClick={() => !disabled && onStepChange?.(step.id)}
                disabled={disabled}
                aria-current={active ? 'step' : undefined}
                title={step.description}
                className={[
                  'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black transition-all min-h-[44px]',
                  active
                    ? 'theme-accent-fill theme-on-accent shadow-elev-sm'
                    : completed
                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                    : disabled
                    ? 'theme-text-muted opacity-50 cursor-not-allowed'
                    : 'theme-text-muted hover:theme-bg-subtle hover:theme-text',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-black',
                    active
                      ? 'bg-white/30 text-white'
                      : completed
                      ? 'bg-emerald-600 text-white'
                      : 'theme-bg-subtle',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {completed ? '✓' : step.short}
                </span>
                <span className="truncate">{step.label}</span>
              </button>
              {index < STEPS.length - 1 && (
                <span aria-hidden="true" className="theme-text-muted mx-1 select-none text-xs">
                  →
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export const QUIZ_WIZARD_STEPS = STEPS
