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

/**
 * StudioSidebar — left panel of the Lesson Plan Studio.
 *
 * Composes all sidebar section components in order, wires them to the shared
 * state, and exposes the Generate button.
 *
 * Props:
 *   studioState  ← full state object from useStudioState()
 *   aiState      ← { recommendation, loading: aiLoading, error: aiError, fetchRecommendation }
 *                   from useAILessonCount()
 *   seriesState  ← { completedCount, completedLessons, seriesLoading } from useLessonSeries()
 *   onGenerate   ← called when the Generate button is clicked
 *   isValid      ← boolean — whether all required fields are filled (enables Generate)
 */
export function StudioSidebar({ studioState, aiState, seriesState, onGenerate, onContinue, onViewCompleted, isValid, generateLabel = 'Generate Lesson Plan', planContext = null, onDismissPlanContext, coverageState = {}, lessonMemory = {}, activeAssignmentLabel = '', mappingNotice = '', dateHint = '', dateWarning = '' }) {
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

  return (
    <div
      className="w-full md:w-[400px] md:min-w-[340px] md:max-w-[440px] flex flex-col md:overflow-y-auto bg-[#F5EFE1] border-b border-[#e5ddd0] md:border-b-0"
    >
      {/* ── Compact studio header ── */}
      <div className="px-4 pt-4 pb-3">
        <span className="lps-eyebrow mb-1.5">Teacher Studio</span>
        <div className="flex items-center gap-2.5">
          <span
            className="lps-tile h-10 w-10 flex-shrink-0 rounded-[12px] text-white lps-brand-gradient"
            aria-hidden="true"
          >
            <Sparkles size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-[17px] font-extrabold leading-tight tracking-tight text-[#0F1B2D]">Lesson Plan Studio</h1>
            <p className="text-[11.5px] font-semibold leading-tight text-[#4A5A6E]">
              Create smart lesson plans in minutes.
            </p>
          </div>
        </div>
      </div>

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

      {/* ── Sections ── */}
      <div className="flex-1">

        {/* 1. Curriculum Picker */}
        <CurriculumPicker
          curriculumMode={curriculumMode}
          onSelect={setCurriculumMode}
        />

        {/* 2. Lesson Details */}
        <LessonDetailsForm
          lessonDetails={lessonDetails}
          curriculumMode={curriculumMode}
          onChange={setLessonDetail}
          disabled={!curriculumMode}
          dateHint={dateHint}
          dateWarning={dateWarning}
        />

        {/* 3. Topic / Subtopic */}
        <TopicSubtopicForm
          topicData={topicData}
          lessonDetails={lessonDetails}
          curriculumMode={curriculumMode}
          onTopicChange={(value) => setTopicField('topic', value)}
          onSubtopicChange={(value) => setTopicField('subtopic', value)}
          onSubtopicRowLoaded={(row) => setTopicField('subtopicRow', row)}
          disabled={!lessonDetails.grade || !lessonDetails.subject}
        />

        {/* 4. Curriculum Summary Card */}
        <CurriculumSummaryCard
          subtopicRow={subtopicRow}
          curriculumMode={curriculumMode}
          selectedOutcomes={selectedOutcomes}
        />

        {/* 4a. Saved Lessons — persistent memory of lessons already created for
            the selected subtopic: progress, teaching status, recommendations,
            and per-lesson Continue / Edit / Create actions. Hidden until a
            subtopic is chosen. */}
        <SubtopicLessonsPanel {...lessonMemory} />

        {/* 4b. Curriculum Coverage — how much of the syllabus is already planned */}
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

        {/* 5. Specific Outcome Form — previous curriculum only */}
        {curriculumMode === 'previous' && (
          <SpecificOutcomeForm
            subtopicRow={subtopicRow}
            selectedOutcomes={selectedOutcomes}
            onToggleOutcome={toggleSelectedOutcome}
            disabled={!topicData.subtopicRow}
          />
        )}

        {/* 6. Learning Environment — CBC only. The Previous (Outcomes-Based)
            curriculum has no Learning Environment section, so it is hidden for
            that mode and no environments are generated. */}
        {curriculumMode === 'cbc' && (
          <LearningEnvironmentForm
            learningEnvironments={learningEnvironments}
            onToggle={toggleLearningEnvironment}
            disabled={!topicData.subtopicRow}
          />
        )}

        {/* 7. Lesson Progression Form — CBC only */}
        {curriculumMode === 'cbc' && (
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
        )}

        {/* 8. Teaching Progress Panel — CBC only */}
        {curriculumMode === 'cbc' && (
          <TeachingProgressPanel
            lessonBreakdown={lessonBreakdown}
            completedCount={completedCount}
            completedLessons={completedLessons}
            seriesLoading={seriesLoading}
            onContinue={onContinue}
            onViewCompleted={onViewCompleted}
          />
        )}

        {/* 9. Format Options */}
        <FormatOptionsForm
          formatOptions={formatOptions}
          onUpdateFormat={setFormatOption}
          onUpdateAdvanced={setAdvancedOption}
          onUpdateMedium={(value) => setLessonDetail('medium', value)}
          lessonMedium={lessonDetails.medium}
          curriculumMode={curriculumMode}
        />
      </div>

      {/* ── Generate Button — sticky at bottom ── */}
      <div className="sticky bottom-0 z-20 border-t border-[#e5ddd0] bg-[#F5EFE1]/95 p-4 backdrop-blur">
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
