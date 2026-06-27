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
export function StudioSidebar({ studioState, aiState, seriesState, onGenerate, isValid }) {
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
      className="w-[380px] min-w-[320px] max-w-[420px] flex flex-col overflow-y-auto bg-[#faf7f2]"
    >
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

        {/* 6. Learning Environment */}
        <LearningEnvironmentForm
          learningEnvironments={learningEnvironments}
          onToggle={toggleLearningEnvironment}
          disabled={!topicData.subtopicRow}
        />

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
            onContinue={() => {}}
            onViewCompleted={() => {}}
          />
        )}

        {/* 9. Format Options */}
        <FormatOptionsForm
          formatOptions={formatOptions}
          onUpdateFormat={setFormatOption}
          onUpdateAdvanced={setAdvancedOption}
          lessonMedium={lessonDetails.medium}
        />
      </div>

      {/* ── Generate Button — sticky at bottom ── */}
      <div className="sticky bottom-0 bg-[#faf7f2] border-t border-[#e5ddd0] p-4">
        <button
          type="button"
          onClick={onGenerate}
          disabled={!isValid || isGenerating}
          className={[
            'w-full rounded-xl py-3 text-[14px] font-semibold transition-colors',
            !isValid || isGenerating
              ? 'bg-blue-300 text-white cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
          ].join(' ')}
        >
          {isGenerating ? 'Generating…' : 'Generate Lesson Plan'}
        </button>
      </div>
    </div>
  )
}
