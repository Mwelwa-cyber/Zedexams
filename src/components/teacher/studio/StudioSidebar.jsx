import { useEffect, useMemo, useState } from 'react'
import { Link }                      from 'react-router-dom'
import { Sparkles }                  from '../../ui/icons'
import { CurriculumPicker }         from './sections/CurriculumPicker.jsx'
import { LessonDetailsForm }         from './sections/LessonDetailsForm.jsx'
import { TopicSubtopicForm }         from './sections/TopicSubtopicForm.jsx'
import { CurriculumSummaryCard }     from './sections/CurriculumSummaryCard.jsx'
import { SubtopicLessonsPanel }      from './sections/SubtopicLessonsPanel.jsx'
import { CoveragePanel }             from './sections/CoveragePanel.jsx'
import { SpecificOutcomeForm }       from './sections/SpecificOutcomeForm.jsx'
import { LearningEnvironmentForm }   from './sections/LearningEnvironmentForm.jsx'
import { LessonProgressionForm }     from './sections/LessonProgressionForm.jsx'
import { TeachingProgressPanel }     from './sections/TeachingProgressPanel.jsx'
import { FormatOptionsForm }         from './sections/FormatOptionsForm.jsx'

// The step the teacher was on survives navigating away and back (and a
// reload) — required so returning to the studio never resets progress.
const STEP_STORAGE_KEY = 'zedexams:lesson-plan-studio-step'

/**
 * Progressive step list for the studio form panel. The outcomes step is the
 * mode-dependent section (Learning Environment for CBC, Specific Outcomes
 * for the Previous curriculum); Lesson Progression only exists for CBC.
 * Exported for the step-navigation spec.
 */
export function studioSteps(curriculumMode) {
  return [
    { id: 'curriculum',  label: 'Curriculum' },
    { id: 'details',     label: 'Lesson Details' },
    { id: 'topic',       label: 'Topic & Subtopic' },
    {
      id: 'outcomes',
      label: curriculumMode === 'previous' ? 'Learning Outcomes' : 'Learning Environment',
    },
    ...(curriculumMode === 'previous' ? [] : [{ id: 'progression', label: 'Lesson Progression' }]),
    { id: 'format',      label: 'Format & Options' },
    { id: 'review',      label: 'Review & Generate' },
  ]
}

/** One row of the Review step's summary list. */
function ReviewRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="flex-none text-[11px] font-bold uppercase tracking-wide text-[#4A5A6E]">{label}</span>
      <span className={`min-w-0 truncate text-right text-[13px] font-semibold ${value ? 'text-[#0F1B2D]' : 'text-[#a39d8e]'}`}>
        {value || 'Not set'}
      </span>
    </div>
  )
}

/**
 * StudioSidebar — the Lesson Plan Studio's form panel.
 *
 * Progressive-steps redesign: instead of one extremely long form column, the
 * panel shows ONE step at a time (Curriculum → Lesson Details → Topic →
 * Outcomes/Environment → Progression → Format → Review) with Previous/Next
 * controls and clickable step chips. Every section stays MOUNTED across step
 * changes (hidden, not unmounted) so section effects, cascade resets, draft
 * restores and typed values are never lost by navigating between steps.
 *
 * Props (unchanged contract):
 *   studioState  ← full state object from useStudioState()
 *   aiState      ← { recommendation, loading: aiLoading, error: aiError, fetchRecommendation }
 *   seriesState  ← { completedCount, completedLessons, seriesLoading } from useLessonSeries()
 *   onGenerate   ← called when the Generate button is clicked
 *   isValid      ← boolean — whether all required fields are filled (enables Generate)
 *   onSaveDraft  ← optional; flushes the input draft immediately ("Save draft")
 */
export function StudioSidebar({ studioState, aiState, seriesState, onGenerate, onContinue, onViewCompleted, isValid, generateLabel = 'Generate Lesson Plan', planContext = null, onDismissPlanContext, coverageState = {}, lessonMemory = {}, activeAssignmentLabel = '', mappingNotice = '', dateHint = '', dateWarning = '', onSaveDraft = null }) {
  const {
    curriculumMode,   setCurriculumMode,
    lessonDetails,    setLessonDetail,
    topicData,        setTopicField,
    selectedOutcomes, toggleSelectedOutcome,
    learningEnvironments, toggleLearningEnvironment,
    lessonSeries,     setLessonSeriesField,
    lessonBreakdown,  setLessonBreakdown,
    formatOptions,    setFormatOption, setAdvancedOption,
    generationStatus,
  } = studioState

  const { recommendation, loading: aiLoading, error: aiError, fetchRecommendation } = aiState
  const { completedCount, completedLessons, seriesLoading } = seriesState

  const subtopicRow = topicData.subtopicRow ?? null
  const isGenerating = generationStatus === 'loading'

  // ── Step state ────────────────────────────────────────────────────────────
  const steps = useMemo(() => studioSteps(curriculumMode), [curriculumMode])
  const [currentStep, setCurrentStep] = useState(() => {
    try {
      return sessionStorage.getItem(STEP_STORAGE_KEY) || 'curriculum'
    } catch {
      return 'curriculum'
    }
  })
  // Clamp to a real step when the list changes (switching to the Previous
  // curriculum removes the Progression step).
  const stepIds = steps.map((s) => s.id)
  const safeStep = stepIds.includes(currentStep) ? currentStep : 'curriculum'
  const stepIndex = stepIds.indexOf(safeStep)
  useEffect(() => {
    try {
      sessionStorage.setItem(STEP_STORAGE_KEY, safeStep)
    } catch { /* private mode — step is session-only */ }
  }, [safeStep])

  // Per-step "complete" marks — derivations only, no gating: teachers can move
  // freely between steps; the Generate button is the single validity gate.
  const stepDone = {
    curriculum:  !!curriculumMode,
    details:     !!(lessonDetails.grade && lessonDetails.subject),
    topic:       !!(topicData.topic && topicData.subtopic),
    outcomes:    curriculumMode === 'previous'
      ? (selectedOutcomes?.length ?? 0) > 0
      : (learningEnvironments?.length ?? 0) > 0,
    progression: true,
    format:      true,
    review:      isValid,
  }

  const goTo = (id) => setCurrentStep(id)
  const goPrev = () => { if (stepIndex > 0) setCurrentStep(stepIds[stepIndex - 1]) }
  const goNext = () => { if (stepIndex < stepIds.length - 1) setCurrentStep(stepIds[stepIndex + 1]) }
  const nextStep = stepIndex < steps.length - 1 ? steps[stepIndex + 1] : null

  const summarySubtopic = topicData.subtopic || ''

  return (
    <div
      className="w-full md:w-[42%] md:min-w-[360px] md:max-w-[560px] xl:w-[44%] flex flex-col md:overflow-y-auto bg-[#F5EFE1] border-b border-[#e5ddd0] md:border-b-0 md:border-r"
    >
      {/* ── Step navigation ── */}
      <nav aria-label="Lesson plan steps" className="px-4 pt-4 pb-2">
        <ol className="flex flex-wrap gap-1.5">
          {steps.map(({ id, label }, i) => {
            const isCurrent = id === safeStep
            const done = stepDone[id] && !isCurrent
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => goTo(id)}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Step ${i + 1}: ${label}${done ? ' (complete)' : ''}`}
                  className={[
                    'min-h-[32px] rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors',
                    isCurrent
                      ? 'border-[#0F1B2D] bg-[#0F1B2D] text-white'
                      : done
                        ? 'border-[#c8e6c9] bg-[#e9f6ea] text-[#1d6b32] hover:border-[#1d6b32]'
                        : 'border-[#d9cfc3] bg-white text-[#4A5A6E] hover:border-[#0F1B2D]',
                  ].join(' ')}
                >
                  <span aria-hidden="true">{done ? '✓' : i + 1}</span>
                  <span className="ml-1">{label}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* ── "This week's lesson" auto-fill banner ── */}
      {planContext && (planContext.topic || planContext.subjectLabel) && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-[14px] bg-[#FFF4E8] px-3 py-2 lps-soft-shadow lps-section-enter">
          <span className="mt-0.5 text-[14px] leading-none" aria-hidden="true">📅</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-semibold text-[#3d3529]">This week&rsquo;s lesson — filled in for you</p>
            <p className="truncate text-[11px] text-[#6b6452]">
              {[planContext.subjectLabel, planContext.topic, planContext.subtopic].filter(Boolean).join(' · ')}
              {planContext.weekNumber ? ` · Week ${planContext.weekNumber}` : ''}
            </p>
          </div>
          {typeof onDismissPlanContext === 'function' && (
            <button
              type="button"
              onClick={onDismissPlanContext}
              aria-label="Dismiss this week's lesson suggestion"
              className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-[#a39d8e] hover:bg-white/60 hover:text-[#6b6452]"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* ── Active Teaching Profile assignment + mapping notice ── */}
      {(activeAssignmentLabel || mappingNotice) && (
        <div className="mx-4 mb-2 rounded-[14px] bg-[#EEF4FF] px-3 py-2 lps-soft-shadow">
          {activeAssignmentLabel && (
            <p className="text-[11.5px] font-semibold text-[#1d3b53]">Teaching: {activeAssignmentLabel}</p>
          )}
          {mappingNotice && (
            <div className={activeAssignmentLabel ? 'mt-1' : ''}>
              <p className="text-[11px] leading-snug text-[#b45309]">
                Some Teaching Profile details could not be selected automatically. {mappingNotice} Choose the correct grade and subject below before creating the Lesson Plan.
              </p>
              <Link to="/settings/teaching-profile" className="text-[11px] font-semibold text-[#b45309] underline">Review Teaching Profile</Link>
            </div>
          )}
        </div>
      )}

      {/* ── Steps ──
          Every section stays MOUNTED; the inactive steps are hidden with the
          `hidden` attribute so section effects (subtopic loading, cascades,
          draft restores) and typed values survive step navigation. */}
      <div className="flex-1">

        {/* Step 1 — Curriculum */}
        <div hidden={safeStep !== 'curriculum'}>
          <CurriculumPicker
            curriculumMode={curriculumMode}
            onSelect={setCurriculumMode}
          />
        </div>

        {/* Step 2 — Lesson Details */}
        <div hidden={safeStep !== 'details'}>
          <LessonDetailsForm
            lessonDetails={lessonDetails}
            curriculumMode={curriculumMode}
            onChange={setLessonDetail}
            disabled={!curriculumMode}
            dateHint={dateHint}
            dateWarning={dateWarning}
          />
        </div>

        {/* Step 3 — Topic & Subtopic (+ syllabus context, saved lessons,
            curriculum coverage for the chosen coordinates) */}
        <div hidden={safeStep !== 'topic'}>
          <TopicSubtopicForm
            topicData={topicData}
            lessonDetails={lessonDetails}
            curriculumMode={curriculumMode}
            onTopicChange={(value) => setTopicField('topic', value)}
            onSubtopicChange={(value) => setTopicField('subtopic', value)}
            onSubtopicRowLoaded={(row) => setTopicField('subtopicRow', row)}
            disabled={!lessonDetails.grade || !lessonDetails.subject}
          />
          <CurriculumSummaryCard
            subtopicRow={subtopicRow}
            curriculumMode={curriculumMode}
            selectedOutcomes={selectedOutcomes}
          />
          <SubtopicLessonsPanel {...lessonMemory} />
          <CoveragePanel
            grade={lessonDetails.grade}
            subject={lessonDetails.subject}
            loading={coverageState.loading}
            coverage={coverageState.coverage}
            onSelectGap={(topic, subtopic) => {
              setTopicField('topic', topic)
              setTopicField('subtopic', subtopic)
            }}
          />
        </div>

        {/* Step 4 — Learning Outcomes (Previous) / Learning Environment (CBC) */}
        <div hidden={safeStep !== 'outcomes'}>
          {curriculumMode === 'previous' && (
            <SpecificOutcomeForm
              subtopicRow={subtopicRow}
              selectedOutcomes={selectedOutcomes}
              onToggleOutcome={toggleSelectedOutcome}
              disabled={!topicData.subtopicRow}
            />
          )}
          {curriculumMode === 'cbc' && (
            <LearningEnvironmentForm
              learningEnvironments={learningEnvironments}
              onToggle={toggleLearningEnvironment}
              disabled={!topicData.subtopicRow}
            />
          )}
          {!curriculumMode && (
            <p className="px-4 py-3 text-[12.5px] font-semibold text-[#4A5A6E]">
              Choose a curriculum in step 1 to unlock this step.
            </p>
          )}
        </div>

        {/* Step 5 — Lesson Progression (CBC only) */}
        {curriculumMode !== 'previous' && (
          <div hidden={safeStep !== 'progression'}>
            {curriculumMode === 'cbc' ? (
              <>
                <LessonProgressionForm
                  lessonSeries={lessonSeries}
                  lessonBreakdown={lessonBreakdown}
                  subtopicRow={subtopicRow}
                  onUpdateSeries={setLessonSeriesField}
                  onUpdateBreakdown={setLessonBreakdown}
                  recommendation={recommendation}
                  loading={aiLoading}
                  error={aiError}
                  onFetchRecommendation={fetchRecommendation}
                />
                <TeachingProgressPanel
                  lessonBreakdown={lessonBreakdown}
                  completedCount={completedCount}
                  completedLessons={completedLessons}
                  seriesLoading={seriesLoading}
                  onContinue={onContinue}
                  onViewCompleted={onViewCompleted}
                />
              </>
            ) : (
              <p className="px-4 py-3 text-[12.5px] font-semibold text-[#4A5A6E]">
                Choose a curriculum in step 1 to unlock this step.
              </p>
            )}
          </div>
        )}

        {/* Step 6 — Format & Options */}
        <div hidden={safeStep !== 'format'}>
          <FormatOptionsForm
            formatOptions={formatOptions}
            onUpdateFormat={setFormatOption}
            onUpdateAdvanced={setAdvancedOption}
            onUpdateMedium={(value) => setLessonDetail('medium', value)}
            lessonMedium={lessonDetails.medium}
            curriculumMode={curriculumMode}
          />
        </div>

        {/* Step 7 — Review & Generate */}
        <div hidden={safeStep !== 'review'}>
          <section className="mx-4 my-3 rounded-[16px] bg-white px-4 py-3 lps-soft-shadow" aria-label="Review your lesson plan setup">
            <h2 className="text-[13px] font-extrabold text-[#0F1B2D]">Review your lesson</h2>
            <div className="mt-1 divide-y divide-[#f0eadd]">
              <ReviewRow label="Curriculum" value={curriculumMode === 'previous' ? 'Previous (Outcomes-Based)' : curriculumMode === 'cbc' ? 'CBC (2023)' : ''} />
              <ReviewRow label="Grade" value={lessonDetails.grade} />
              <ReviewRow label="Subject" value={lessonDetails.subject} />
              <ReviewRow label="Topic" value={topicData.topic} />
              <ReviewRow label="Subtopic" value={summarySubtopic} />
              <ReviewRow label="Date" value={lessonDetails.date} />
              <ReviewRow label="Duration" value={lessonDetails.duration ? `${lessonDetails.duration} minutes` : ''} />
              {curriculumMode === 'previous' ? (
                <ReviewRow label="Outcomes" value={selectedOutcomes?.length ? `${selectedOutcomes.length} selected` : ''} />
              ) : (
                <ReviewRow label="Environment" value={learningEnvironments?.length ? learningEnvironments.join(', ') : ''} />
              )}
            </div>
            {!isValid && (
              <p className="mt-2 text-[12px] font-semibold leading-snug text-[#b45309]">
                Something&rsquo;s missing — visit the steps marked without a ✓ above, then generate from here.
              </p>
            )}
          </section>
        </div>
      </div>

      {/* ── Step controls + Generate — sticky at bottom ── */}
      <div className="sticky bottom-0 z-20 space-y-2 border-t border-[#e5ddd0] bg-[#F5EFE1]/95 p-3 backdrop-blur sm:p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={stepIndex === 0}
            className="lps-btn-ghost min-h-[44px] flex-none px-3 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Previous
          </button>
          {typeof onSaveDraft === 'function' && (
            <button
              type="button"
              onClick={onSaveDraft}
              className="lps-btn-ghost min-h-[44px] flex-none px-3 text-[12.5px]"
            >
              Save draft
            </button>
          )}
          {nextStep ? (
            <button
              type="button"
              onClick={goNext}
              className="lps-btn-ghost min-h-[44px] min-w-0 flex-1 truncate border-[#0F1B2D] px-3 text-[12.5px]"
            >
              Next: {nextStep.label} →
            </button>
          ) : (
            <span className="min-w-0 flex-1" aria-hidden="true" />
          )}
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!isValid || isGenerating}
          className={[
            'lps-btn-primary w-full rounded-2xl py-3.5 text-[14px]',
            !isValid || isGenerating ? '' : 'lps-btn-ready',
          ].join(' ')}
        >
          {isGenerating ? (
            <span className="inline-flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" />
              Generating…
            </span>
          ) : (
            <span className="inline-flex items-center justify-center gap-2">
              <Sparkles size={16} aria-hidden="true" />
              {generateLabel}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
