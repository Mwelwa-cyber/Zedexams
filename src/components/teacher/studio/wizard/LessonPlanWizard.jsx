import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChartNoAxesColumnIncreasing } from 'lucide-react'
import { WIZARD_STEPS, REVIEW_STEP, clampStep, validateStep, firstInvalidStep, maxReachableStep } from './wizardSteps'
import StudioStepper from '../../StudioStepper.jsx'
import SetupForYouCard from '../../SetupForYouCard.jsx'
import { cleanSubjectName } from '../utils/subjectName.js'
import { StickyWizardNav } from './StickyWizardNav.jsx'
import { ProgressPanel } from './ProgressPanel.jsx'
import { LessonSetupStep } from './steps/LessonSetupStep.jsx'
import { TopicCurriculumStep } from './steps/TopicCurriculumStep.jsx'
import { LessonContextStep } from './steps/LessonContextStep.jsx'
import { FormatOptionsStep } from './steps/FormatOptionsStep.jsx'
import { ReviewGenerateStep } from './steps/ReviewGenerateStep.jsx'

/**
 * LessonPlanWizard — the guided five-step creation flow of the Lesson Plan
 * Studio (replaces the old single long-scroll StudioSidebar).
 *
 * One step renders at a time on EVERY breakpoint, with ONE horizontal
 * StudioStepper above the step header as the single step indicator (the old
 * desktop rail + mobile dots pair is gone). All form state lives in
 * useStudioState (single source of truth) — the wizard only decides WHICH
 * slice is visible and paces the teacher with per-step validation.
 *
 * Prop contract matches what LessonPlanStudio used to hand StudioSidebar,
 * plus wizard-specific additions (draftStatus, onSaveExit, hasPlan/onViewPlan,
 * and the "Set up for you" context flags appliedContext/appliedWeekNumber —
 * the card's CHIPS are always derived from the live studioState here, never
 * from the raw suggestion that seeded it).
 */
export function LessonPlanWizard({
  studioState,
  aiState,
  seriesState,
  onGenerate,
  onContinue,
  onViewCompleted,
  isValid,
  generateLabel = 'Generate Lesson Plan',
  appliedContext = false,
  appliedWeekNumber = null,
  onDismissPlanContext,
  mappingNotice = '',
  dateHint = '',
  dateWarning = '',
  coverageState = {},
  lessonMemory = {},
  onSaveExit,
  hasPlan = false,
  onViewPlan,
}) {
  const {
    curriculumMode, setCurriculumMode,
    lessonDetails, setLessonDetail,
    resetTopicData,
    topicData, setTopicField,
    selectedOutcomes, toggleSelectedOutcome,
    learningEnvironments, toggleLearningEnvironment,
    lessonSeries, setLessonSeriesField,
    lessonBreakdown, setLessonBreakdown,
    formatOptions, setFormatOption, setAdvancedOption, setSectionOption,
    generationStatus,
    wizardStep, setWizardStep,
  } = studioState

  const currentStep = clampStep(wizardStep)
  const isGenerating = generationStatus === 'loading'

  // ── Local wizard chrome state ──
  const [stepError, setStepError] = useState(null) // set on a failed Next/Generate attempt
  const [returnToReview, setReturnToReview] = useState(false) // arrived via Review's Edit
  const [progressOpen, setProgressOpen] = useState(false)
  const [direction, setDirection] = useState('forward') // step-transition slide direction
  const headingRef = useRef(null)
  const mountedRef = useRef(false)

  // Live validity of the active step (also hides a stale attempt error the
  // moment the teacher fixes the field it complained about).
  const currentCheck = validateStep(currentStep, studioState)
  const shownError = !currentCheck.valid ? stepError : null
  // A step only shows as COMPLETED once the teacher has actually been there —
  // steps that merely default to valid (Format & Options) must not tick green
  // before they've been seen.
  const [maxVisited, setMaxVisited] = useState(currentStep)
  useEffect(() => {
    setMaxVisited((prev) => Math.max(prev, currentStep))
  }, [currentStep])
  const completed = WIZARD_STEPS.map(
    (_, i) => i <= maxVisited && validateStep(i, studioState).valid,
  )
  const maxReachable = maxReachableStep(studioState)

  // Move focus to the step heading after navigation (not on first mount) and
  // return the scroll position to the top of the new step.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    window.scrollTo({ top: 0 })
    headingRef.current?.focus({ preventScroll: true })
  }, [currentStep])

  const goToStep = useCallback((index, opts = {}) => {
    const next = clampStep(index)
    setDirection(next >= clampStep(wizardStep) ? 'forward' : 'back')
    setStepError(null)
    if (opts.fromReview) setReturnToReview(true)
    else if (next === REVIEW_STEP) setReturnToReview(false)
    setWizardStep(next)
  }, [wizardStep, setWizardStep])

  // Focus the first invalid control (best effort — falls back to the heading).
  const focusInvalidField = useCallback((fieldId) => {
    const el = fieldId ? document.getElementById(fieldId) : null
    if (el && typeof el.focus === 'function') {
      el.focus()
      if (el.tagName === 'DIV') el.querySelector('button, select, input')?.focus()
    } else {
      headingRef.current?.focus()
    }
  }, [])

  const handleNext = useCallback(() => {
    const check = validateStep(currentStep, studioState)
    if (!check.valid) {
      setStepError(check.reason)
      focusInvalidField(check.fieldId)
      return
    }
    goToStep(currentStep + 1)
  }, [currentStep, studioState, goToStep, focusInvalidField])

  const handleBack = useCallback(() => {
    goToStep(currentStep - 1)
  }, [currentStep, goToStep])

  const handleGenerateClick = useCallback(() => {
    if (isGenerating) return
    // Full-form validation: jump to the first incomplete step instead of
    // firing a generation that the studio's own gate would refuse.
    const firstBad = firstInvalidStep(studioState)
    if (firstBad !== -1) {
      const check = validateStep(firstBad, studioState)
      goToStep(firstBad)
      setStepError(check.reason)
      return
    }
    if (!isValid) return // final backstop — same rule the studio always enforced
    onGenerate()
  }, [isGenerating, studioState, goToStep, isValid, onGenerate])

  const handleEditStep = useCallback((index) => {
    goToStep(index, { fromReview: true })
  }, [goToStep])

  // Setup-field changes clear dependent topic state SYNCHRONOUSLY. The
  // TopicSubtopicForm's own stale-selection guard only runs while step 2 is
  // mounted — without this, editing the class/subject/curriculum from Review
  // and shortcutting back would keep the old (now incompatible) topic and
  // validateStep would happily pass it to generation.
  const handleSelectCurriculum = useCallback((mode) => {
    if (mode !== curriculumMode && (topicData.topic || topicData.subtopic)) {
      resetTopicData()
    }
    setCurriculumMode(mode)
  }, [curriculumMode, topicData.topic, topicData.subtopic, resetTopicData, setCurriculumMode])

  const handleChangeDetail = useCallback((field, value) => {
    if (
      (field === 'grade' || field === 'subject') &&
      lessonDetails[field] !== value &&
      (topicData.topic || topicData.subtopic)
    ) {
      resetTopicData()
    }
    setLessonDetail(field, value)
  }, [lessonDetails, topicData.topic, topicData.subtopic, resetTopicData, setLessonDetail])

  const step = WIZARD_STEPS[currentStep]

  // Series teaching progress belongs in the Progress overlay (CBC only).
  const seriesProgress = curriculumMode === 'cbc'
    ? {
        lessonBreakdown,
        completedCount: seriesState.completedCount,
        completedLessons: seriesState.completedLessons,
        seriesLoading: seriesState.seriesLoading,
        onContinue,
        onViewCompleted,
      }
    : null

  // ── "Set up for you" chips (single-source rule) ──
  // Derived from the LIVE studioState — the same state the form's selects
  // render — never from the raw planContext suggestion. Changing Class or
  // Subject in the form therefore updates the card automatically, so it can
  // never describe a different lesson than the form holds (the pre-rework
  // bug). The Week chip is the one suggestion-owned datum, passed in only
  // when the weekly forecast was actually applied.
  const setupChips = appliedContext
    ? [
        appliedWeekNumber ? { label: `Week ${appliedWeekNumber}`, variant: 'blue' } : null,
        lessonDetails.grade ? { label: lessonDetails.grade } : null,
        lessonDetails.subject ? { label: cleanSubjectName(lessonDetails.subject) } : null,
        curriculumMode === 'cbc'
          ? { label: '✓ CBC curriculum', variant: 'green' }
          : curriculumMode === 'previous'
            ? { label: '✓ Previous curriculum', variant: 'green' }
            : null,
      ].filter(Boolean)
    : []

  // Layout contract (see .lpw-nav in lessonStudio.css): `.lpw-body` spans the
  // full width of TeacherLayout's content column and holds exactly two things —
  // the scrolling step content, capped to a reading width by `.lpw-steps`, and
  // the sticky action bar as its LAST child. The cap lives on the inner wrapper
  // rather than on `.lpw-body` so the bar reaches the column's edges instead of
  // stopping at the form's reading width; it must not move back out here.
  return (
    <div className="lpw-body w-full pt-1">
      <div className="lpw-steps mx-auto w-full max-w-3xl">
        {/* ── The ONE step indicator: horizontal stepper, every breakpoint ── */}
        <div className="mb-3">
          <StudioStepper
            steps={WIZARD_STEPS}
            currentIndex={currentStep}
            completed={completed}
            maxReachable={maxReachable}
            onStepClick={(i) => goToStep(i)}
            ariaLabel="Lesson plan steps"
          />
        </div>

        {/* ── Active step ── */}
        <div className="min-w-0">
          {/* Compact step header. "My lessons" opens the saved-lessons +
              coverage overlay (ProgressPanel) — it is NOT a step indicator. */}
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-accent-text">
                Step {currentStep + 1} of {WIZARD_STEPS.length}
              </p>
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="font-display mt-0.5 text-[19px] font-extrabold leading-tight text-ink outline-none"
              >
                {step.title}
              </h2>
              <p className="mt-0.5 text-[12.5px] font-semibold text-ink-muted">{step.description}</p>
            </div>
            <div className="flex flex-none flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              {hasPlan && (
                <button type="button" onClick={onViewPlan} className="lps-btn-ghost min-h-[44px] px-3 py-2 text-[12px]">
                  {isGenerating ? 'View generation progress' : 'View generated plan'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setProgressOpen(true)}
                className="lps-btn-ghost min-h-[44px] flex-shrink-0 px-3 py-2 text-[12px]"
              >
                <ChartNoAxesColumnIncreasing size={16} aria-hidden="true" />
                My lessons
              </button>
            </div>
          </div>

          {/* ── Notice stack (setup step only) — at most two rows: the studio's
              DraftRecoveryPrompt strip above the shell, then this ONE card
              merging the old prefill banner + "Teaching:" chip block. ── */}
          {currentStep === 0 && setupChips.length > 0 && (
            <div className="mb-3">
              <SetupForYouCard
                chips={setupChips}
                onChange={() => document.getElementById('ldf-grade')?.focus()}
                onDismiss={typeof onDismissPlanContext === 'function' ? onDismissPlanContext : null}
              />
            </div>
          )}

          {/* Teaching Profile mapping warning — a warning, not marketing, so it
              stays its own small amber line below the card. */}
          {currentStep === 0 && mappingNotice && (
            <div className="mb-3 px-1">
              <p className="text-[11px] leading-snug text-[#b45309]">
                Some Teaching Profile details could not be selected automatically. {mappingNotice} Choose the correct class and subject below before creating the Lesson Plan.
              </p>
              <Link to="/settings/teaching-profile" className="text-[11px] font-semibold text-[#b45309] underline">Review Teaching Profile</Link>
            </div>
          )}

            {/* ── Active step content (one step at a time, subtle slide) ── */}
            <div
              key={currentStep}
              className={direction === 'back' ? 'lpw-step-enter lpw-step-enter-back' : 'lpw-step-enter'}
            >
              {currentStep === 0 && (
                <LessonSetupStep
                  curriculumMode={curriculumMode}
                  onSelectCurriculum={handleSelectCurriculum}
                  lessonDetails={lessonDetails}
                  onChangeDetail={handleChangeDetail}
                  dateHint={dateHint}
                  dateWarning={dateWarning}
                />
              )}
              {currentStep === 1 && (
                <TopicCurriculumStep
                  topicData={topicData}
                  lessonDetails={lessonDetails}
                  curriculumMode={curriculumMode}
                  onTopicChange={(value) => setTopicField('topic', value)}
                  onSubtopicChange={(value) => setTopicField('subtopic', value)}
                  onSubtopicRowLoaded={(row) => setTopicField('subtopicRow', row)}
                  selectedOutcomes={selectedOutcomes}
                  onToggleOutcome={toggleSelectedOutcome}
                />
              )}
              {currentStep === 2 && (
                <LessonContextStep
                  curriculumMode={curriculumMode}
                  learningEnvironments={learningEnvironments}
                  onToggleEnvironment={toggleLearningEnvironment}
                  lessonSeries={lessonSeries}
                  lessonBreakdown={lessonBreakdown}
                  subtopicRow={topicData.subtopicRow ?? null}
                  onUpdateSeries={setLessonSeriesField}
                  onUpdateBreakdown={setLessonBreakdown}
                  aiState={aiState}
                />
              )}
              {currentStep === 3 && (
                <FormatOptionsStep
                  formatOptions={formatOptions}
                  onUpdateFormat={setFormatOption}
                  onUpdateAdvanced={setAdvancedOption}
                  onUpdateSection={setSectionOption}
                  onUpdateMedium={(value) => setLessonDetail('medium', value)}
                  lessonMedium={lessonDetails.medium}
                  curriculumMode={curriculumMode ?? 'cbc'}
                />
              )}
              {currentStep === REVIEW_STEP && (
                <ReviewGenerateStep
                  studioState={studioState}
                  onEditStep={handleEditStep}
                  hasPlan={hasPlan}
                  onViewPlan={onViewPlan}
                />
              )}
          </div>
        </div>
      </div>

      {/* ── Sticky bottom navigation ── */}
      <StickyWizardNav
        currentStep={currentStep}
        stepError={shownError}
        nextDisabledReason={currentCheck.valid ? null : currentCheck.reason}
        canProceed={currentCheck.valid}
        // The fast path back to Review is only offered while EVERY step is
        // still valid — an edit that invalidated a later step (e.g. changing
        // the class cleared the topic) sends the teacher forward through the
        // normal Next flow instead of skipping over the now-broken steps.
        returnToReview={returnToReview && currentStep < REVIEW_STEP && maxReachable === REVIEW_STEP}
        isGenerating={isGenerating}
        generateLabel={generateLabel}
        onBack={handleBack}
        onNext={handleNext}
        onGenerate={handleGenerateClick}
        onSaveExit={onSaveExit}
        onBackToReview={() => goToStep(REVIEW_STEP)}
      />

      {/* ── Progress overlay (Saved Lessons + Coverage + series progress) ── */}
      <ProgressPanel
        open={progressOpen}
        onClose={() => setProgressOpen(false)}
        lessonMemory={lessonMemory}
        coverageState={coverageState}
        grade={lessonDetails.grade}
        subject={lessonDetails.subject}
        onSelectGap={(topic, subtopic) => {
          setTopicField('topic', topic)
          setTopicField('subtopic', subtopic)
          goToStep(1)
        }}
        seriesProgress={seriesProgress}
      />
    </div>
  )
}
