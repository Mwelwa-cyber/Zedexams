import { Sparkles }                  from '../../ui/icons'
import { CurriculumPicker }         from './sections/CurriculumPicker.jsx'
import { LessonDetailsForm }         from './sections/LessonDetailsForm.jsx'
import { TopicSubtopicForm }         from './sections/TopicSubtopicForm.jsx'
import { CurriculumSummaryCard }     from './sections/CurriculumSummaryCard.jsx'
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
export function StudioSidebar({ studioState, aiState, seriesState, onGenerate, onContinue, onViewCompleted, isValid }) {
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
      className="w-full md:w-[400px] md:min-w-[340px] md:max-w-[440px] flex flex-col md:overflow-y-auto bg-[#faf7f2] border-b border-[#e5ddd0] md:border-b-0"
    >
      {/* ── Compact studio header ── */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-2xl text-white lps-brand-gradient lps-soft-shadow"
            aria-hidden="true"
          >
            <Sparkles size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold leading-tight text-[#2d2519]">Lesson Plan Studio</h1>
            <p className="text-[11.5px] leading-tight text-[#8a7d6b]">
              Create smart lesson plans in minutes.
            </p>
          </div>
        </div>
      </div>

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
      <div className="sticky bottom-0 z-20 border-t border-[#e5ddd0] bg-[#faf7f2]/95 p-4 backdrop-blur">
        <button
          type="button"
          onClick={onGenerate}
          disabled={!isValid || isGenerating}
          className={[
            'lps-lift w-full rounded-2xl py-3.5 text-[14px] font-semibold text-white transition-all',
            !isValid || isGenerating
              ? 'cursor-not-allowed bg-[#b9c2e8]'
              : 'lps-brand-gradient lps-btn-ready hover:brightness-105 active:brightness-95',
          ].join(' ')}
        >
          {isGenerating ? (
            <span className="inline-flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Generating…
            </span>
          ) : (
            <span className="inline-flex items-center justify-center gap-2">
              <Sparkles size={16} aria-hidden="true" />
              Generate Lesson Plan
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
