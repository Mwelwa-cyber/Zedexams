import ControlCentreLayout from './ControlCentreLayout'
import ArtifactGrid from './ArtifactGrid'

// Thin wrapper that mounts ArtifactGrid for the 5 content-type tabs.
// Eliminates page-per-type boilerplate — App.jsx routes pass the
// typeFilter via React.lazy import.
//
// Failed Checks tab uses ArtifactGrid directly with a custom
// extraFilter, NOT this wrapper.

const TITLES = Object.freeze({
  practice_quiz:    { tab: 'Practice quizzes', helmet: 'Practice quizzes — AI Control Centre' },
  exam_quiz:        { tab: 'Exam quiz drafts', helmet: 'Exam drafts — AI Control Centre' },
  notes:            { tab: 'Notes drafts',     helmet: 'Notes — AI Control Centre' },
  study_tips:       { tab: 'Study tips',       helmet: 'Study tips — AI Control Centre' },
  learner_feedback: { tab: 'Learner feedback', helmet: 'Feedback — AI Control Centre' },
})

const HINTS = Object.freeze({
  practice_quiz:    'No practice quizzes have been generated yet. Queue a task with taskType:"practice_quiz".',
  exam_quiz:        'No exam drafts have been generated yet. Queue a task with taskType:"exam_quiz".',
  notes:            'No notes drafts yet. Queue a task with taskType:"notes".',
  study_tips:       'No study tips yet. Run the Weakness Detection agent first to seed weakLearnerId tasks.',
  learner_feedback: 'No learner feedback yet. Each completed quiz attempt triggers one feedback task.',
})

export default function ContentTypePage({ typeFilter }) {
  const meta = TITLES[typeFilter] || { tab: typeFilter, helmet: typeFilter }
  return (
    <ControlCentreLayout
      title={meta.tab}
      helmetTitle={meta.helmet}
    >
      <ArtifactGrid
        typeFilter={typeFilter}
        emptyHint={HINTS[typeFilter] || `No ${typeFilter} artifacts yet.`}
      />
    </ControlCentreLayout>
  )
}
