import { useState } from 'react'
import ControlCentreLayout from './ControlCentreLayout'
import ArtifactGrid from './ArtifactGrid'

// Failed Checks tab — same ArtifactGrid component but with a
// client-side extraFilter that surfaces only artifacts where
// qualityCheck.status === 'failed' OR zambianStandardsCheck.status
// === 'failed'. Type select lets the admin narrow further by
// content type.

function failedFilter(artifact) {
  const qc = (artifact && artifact.qualityCheck) || {}
  const sc = (artifact && artifact.zambianStandardsCheck) || {}
  return qc.status === 'failed' || sc.status === 'failed' ||
    (typeof artifact.errorMessage === 'string' && artifact.errorMessage.length > 0)
}

const TYPE_OPTIONS = [
  { value: 'practice_quiz',    label: 'Practice quizzes' },
  { value: 'exam_quiz',        label: 'Exam drafts' },
  { value: 'notes',            label: 'Notes' },
  { value: 'study_tips',       label: 'Study tips' },
  { value: 'learner_feedback', label: 'Feedback' },
]

export default function FailedChecksPage() {
  const [typeFilter, setTypeFilter] = useState('practice_quiz')

  return (
    <ControlCentreLayout
      title="Failed checks"
      helmetTitle="Failed checks — AI Control Centre"
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-slate-700">Content type</span>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_OPTIONS.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTypeFilter(t.value)}
              className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                typeFilter === t.value ?
                  'bg-blue-600 text-white' :
                  'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-600 mb-3 leading-snug">
        Artifacts whose Quality Check OR Standards Check returned <code>failed</code>,
        or that carry a non-empty <code>errorMessage</code>. Use the Regenerate action
        to re-run the chain with corrective notes.
      </p>

      <ArtifactGrid
        typeFilter={typeFilter}
        extraFilter={failedFilter}
        emptyHint={`No failed-check ${typeFilter} artifacts. ✓`}
      />
    </ControlCentreLayout>
  )
}
