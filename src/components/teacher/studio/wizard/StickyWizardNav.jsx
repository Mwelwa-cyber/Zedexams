import { ChevronLeft, ChevronRight, Sparkles, LogOut } from 'lucide-react'
import { WIZARD_STEPS, REVIEW_STEP } from './wizardSteps'

/**
 * StickyWizardNav — the fixed bottom action bar of the wizard.
 *
 *   Step 1:        [ Save & exit ]            [ Next: Topic → ]
 *   Steps 2–4:     [ ← Back ]                 [ Next: Context → ]
 *   Edit detour:   [ ← Back ]                 [ Back to Review ]
 *   Final step:    [ ← Back ]                 [ Generate Lesson Plan ]
 *
 * The Generate action exists ONLY here on the final step — earlier steps never
 * show a disabled Generate button. When Next is blocked, the reason renders
 * right above the bar (aria-live so screen readers hear it).
 *
 * Props:
 *   currentStep    : number
 *   stepError      : string|null — why Next/Generate is blocked (after an attempt)
 *   nextDisabledReason : string|null — passive hint under a disabled Next
 *   canProceed     : boolean — active step currently valid
 *   returnToReview : boolean — arrived here via Review's Edit link
 *   isGenerating   : boolean
 *   generateLabel  : string — adaptive Generate label (saved-lesson aware)
 *   onBack, onNext, onGenerate, onSaveExit, onBackToReview : () => void
 */
export function StickyWizardNav({
  currentStep,
  stepError = null,
  nextDisabledReason = null,
  canProceed = false,
  returnToReview = false,
  isGenerating = false,
  generateLabel = 'Generate Lesson Plan',
  onBack,
  onNext,
  onGenerate,
  onSaveExit,
  onBackToReview,
}) {
  const isFirst = currentStep === 0
  const isReview = currentStep === REVIEW_STEP
  const nextTitle = WIZARD_STEPS[currentStep + 1]?.short ?? ''
  const hint = stepError || (!canProceed ? nextDisabledReason : null)

  return (
    <div className="lpw-nav">
      <div className="mx-auto w-full max-w-3xl">
        {hint && (
          <p
            className="mb-1.5 text-center text-[12px] font-semibold leading-snug text-[#b45309]"
            aria-live="polite"
            id="lpw-nav-hint"
          >
            {hint}
          </p>
        )}
        <div className="flex items-center gap-3">
          {isFirst ? (
            <button
              type="button"
              onClick={onSaveExit}
              className="lps-btn-ghost min-h-[48px] flex-1 px-4 text-[13px] sm:flex-none sm:min-w-[150px]"
            >
              <LogOut size={18} aria-hidden="true" className="rotate-180" />
              Save &amp; exit
            </button>
          ) : (
            <button
              type="button"
              onClick={onBack}
              className="lps-btn-ghost min-h-[48px] flex-1 px-4 text-[13px] sm:flex-none sm:min-w-[130px]"
            >
              <ChevronLeft size={18} aria-hidden="true" />
              Back
            </button>
          )}

          {isReview ? (
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              aria-describedby={hint ? 'lpw-nav-hint' : undefined}
              className="lps-btn-primary min-h-[52px] flex-[2] rounded-2xl px-4 text-[14px] lps-btn-ready"
            >
              {isGenerating ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" aria-hidden="true" />
                  Generating lesson plan…
                </span>
              ) : (
                <span className="inline-flex items-center justify-center gap-2">
                  <Sparkles size={18} aria-hidden="true" />
                  {generateLabel}
                </span>
              )}
            </button>
          ) : returnToReview && canProceed ? (
            <button
              type="button"
              onClick={onBackToReview}
              className="lps-btn-primary min-h-[48px] flex-[2] px-4 text-[13px]"
            >
              Back to Review
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onNext}
              disabled={!canProceed}
              aria-describedby={hint ? 'lpw-nav-hint' : undefined}
              className="lps-btn-primary min-h-[48px] flex-[2] px-4 text-[13px]"
            >
              Next{nextTitle ? `: ${nextTitle}` : ''}
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
