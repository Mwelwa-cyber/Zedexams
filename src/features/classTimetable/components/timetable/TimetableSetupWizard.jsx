/**
 * TimetableSetupWizard — the 3-step setup chrome for the Class Timetable
 * Studio (Phase 1). Purely presentational: the studio owns the step state,
 * the entry mode, and every field; this renders the shared StudioStepper on
 * top, the current step's content in the middle, and the sticky footer
 * (Back · "Step n of 3" caption + progress bar · single primary CTA).
 *
 * The single CTA replaces the old separate "Generate curriculum timetable"
 * and "Auto-fill timetable" buttons: on the last step it hands off to
 * `onFinish`, whose label depends on the entry mode (generate / upload /
 * blank) via `wizardPrimaryLabel`.
 */

import StudioStepper from '../../../../components/teacher/StudioStepper'

export const WIZARD_STEPS = [
  { id: 'class', short: 'Class', title: 'Class' },
  { id: 'school-day', short: 'School day', title: 'School day' },
  { id: 'subjects', short: 'Subjects', title: 'Subjects' },
]

/** The one primary-CTA label: steps 1–2 advance; step 3 opens the week. */
export function wizardPrimaryLabel(step, entryMode) {
  if (step === 0) return 'Next: School day →'
  if (step === 1) return 'Next: Subjects →'
  return entryMode === 'generate' ? 'Auto-fill & open the week →' : 'Open the week →'
}

export default function TimetableSetupWizard({
  step = 0,
  onStepChange,
  entryMode = 'generate',
  onFinish,
  primaryDisabled = false,
  primaryDisabledReason = '',
  footerNote = null,
  children,
}) {
  const isLast = step >= WIZARD_STEPS.length - 1
  const progress = Math.round(((step + 1) / WIZARD_STEPS.length) * 100)

  function onPrimary() {
    if (isLast) onFinish?.()
    else onStepChange?.(step + 1)
  }

  return (
    <div>
      <StudioStepper
        steps={WIZARD_STEPS}
        currentIndex={step}
        completed={WIZARD_STEPS.map((_, i) => i < step)}
        maxReachable={step}
        onStepClick={(i) => {
          if (i <= step) onStepChange?.(i)
        }}
        ariaLabel="Timetable setup steps"
      />

      <div className="mt-4 space-y-5">{children}</div>

      <div className="studio-sticky-bar mt-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onStepChange?.(Math.max(0, step - 1))}
            disabled={step === 0}
            className="studio-btn-ghost text-sm disabled:opacity-40"
          >
            ← Back
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-[11px] font-bold" style={{ color: 'var(--zt-text-muted)' }}>
              Step {step + 1} of {WIZARD_STEPS.length} — {WIZARD_STEPS[Math.min(step, WIZARD_STEPS.length - 1)].title}
            </div>
            <div className="studio-sticky-bar__progress-track mx-auto" style={{ maxWidth: 220 }}>
              <span className="studio-sticky-bar__progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <button
            type="button"
            onClick={onPrimary}
            disabled={primaryDisabled}
            title={primaryDisabled && primaryDisabledReason ? primaryDisabledReason : undefined}
            className="studio-btn-primary whitespace-nowrap text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {wizardPrimaryLabel(step, entryMode)}
          </button>
        </div>
        {footerNote}
      </div>
    </div>
  )
}
