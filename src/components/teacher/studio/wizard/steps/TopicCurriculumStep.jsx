import { TopicSubtopicForm } from '../../sections/TopicSubtopicForm.jsx'
import { CurriculumSummaryCard } from '../../sections/CurriculumSummaryCard.jsx'
import { SpecificOutcomeForm } from '../../sections/SpecificOutcomeForm.jsx'

/**
 * Step 2 — Topic & Curriculum.
 *
 * Topic + subtopic pickers (subtopic stays disabled until a topic is chosen —
 * enforced inside TopicSubtopicForm) and the auto-filled, read-only
 * Curriculum Summary (specific competence, learning activities, expected
 * standard). For the Previous curriculum the summary lists the specific
 * outcomes and the teacher picks the one(s) this lesson targets.
 *
 * Props mirror the reused sections; all state lives in useStudioState.
 */
export function TopicCurriculumStep({
  topicData,
  lessonDetails,
  curriculumMode,
  onTopicChange,
  onSubtopicChange,
  onSubtopicRowLoaded,
  selectedOutcomes,
  onToggleOutcome,
}) {
  const subtopicRow = topicData.subtopicRow ?? null

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-card-border bg-card p-4 shadow-[0_2px_0_var(--zt-card-border)]">
        <TopicSubtopicForm
          embedded
          topicData={topicData}
          lessonDetails={lessonDetails}
          curriculumMode={curriculumMode}
          onTopicChange={onTopicChange}
          onSubtopicChange={onSubtopicChange}
          onSubtopicRowLoaded={onSubtopicRowLoaded}
          disabled={!lessonDetails.grade || !lessonDetails.subject}
        />
      </div>

      {/* Auto-filled curriculum summary — read-only, appears once a subtopic
          resolves to a syllabus row. */}
      <CurriculumSummaryCard
        embedded
        subtopicRow={subtopicRow}
        curriculumMode={curriculumMode}
        selectedOutcomes={selectedOutcomes}
      />

      {/* Previous curriculum: pick the specific outcome(s) for this lesson. */}
      {curriculumMode === 'previous' && subtopicRow && (
        <div className="rounded-2xl border-2 border-card-border bg-card p-4 shadow-[0_2px_0_var(--zt-card-border)]">
          <p className="lps-eyebrow mb-2.5">Specific Outcomes</p>
          <SpecificOutcomeForm
            embedded
            subtopicRow={subtopicRow}
            selectedOutcomes={selectedOutcomes}
            onToggleOutcome={onToggleOutcome}
            disabled={!subtopicRow}
          />
        </div>
      )}
    </div>
  )
}
