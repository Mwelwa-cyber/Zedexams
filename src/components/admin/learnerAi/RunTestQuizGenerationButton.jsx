import { useState } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'

// Manual test trigger for the Live AI Agent Monitor. Creates an
// aiAgentTasks doc with a fixed Grade 4 / Integrated Science /
// Blood Circulatory System practice-quiz brief and lets the existing
// dispatcher pipeline run the chain:
//
//   AI Supervisor Agent (plan)
//     → Curriculum Reader Agent
//     → Practice Quiz Generator Agent
//     → Zambian Curriculum & Exam Standards Agent (standardsCheck)
//     → Quality Check Agent
//     → AI Supervisor Agent (review)
//
// Each runner writes to aiLiveAgentStates + aiTaskSteps + aiAgentLogs
// so the rest of the monitor surfaces (status cards, activity timeline,
// task drawer) reflect progress in real time. The dispatcher's
// auto-publish gate refuses practice_quiz publishing unless
// settings.global.learnerAi.autoPublishPracticeQuizzes === true, so by
// default the test task lands at status='needs_review' and the
// generated artifact stays at status='needs_review' / 'draft' (i.e.
// NOT visible to learners).
//
// Topic choice: the resolver requires a curriculum match against
// either the seed cbcTopics.js OR an admin-curated entry in
// cbcKnowledgeBase (via /admin/cbc-kb). The default below points at
// "States of Matter" — a topic the seed ships for Grade 4
// Integrated Science Term 2 (cbcTopics.js id 'g4-sci-states-of-matter'
// with subtopics ['Solids', 'Liquids', 'Gases', ...]). To test other
// topics, either add them via /admin/cbc-kb or change this payload
// to a (grade, subject, term, topic, subtopic) tuple that's in the
// merged KB. The previous default ('Blood Circulatory System' / 'The
// Heart') always errored with curriculumReader:no_curriculum_match
// because that topic lives in Grade 6 IS Term 1 in the seed, not
// Grade 4.
const TEST_TASK_PAYLOAD = Object.freeze({
  taskType: 'practice_quiz',
  agentName: 'AI Supervisor Agent',
  status: 'queued',
  grade: '4',
  subject: 'Integrated Science',
  term: '2',
  topic: 'States of Matter',
  subtopic: 'Solids',
  lessonNumber: null,
  assessmentType: 'practice_quiz',
  parameters: {
    numQuestions: 10,
    difficulty: 'mixed',
    mode: 'topic',
    weakLearnerId: null,
    lessonNumber: null,
    allowedQuestionTypes: ['mcq', 'true_false', 'short_answer', 'matching'],
  },
  startedAt: null,
  completedAt: null,
  resultContentId: null,
  errorMessage: null,
})

export default function RunTestQuizGenerationButton({ onTaskCreated }) {
  const { currentUser } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [lastTaskId, setLastTaskId] = useState(null)
  const [error, setError] = useState(null)

  async function handleClick() {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const ref = await addDoc(collection(db, 'aiAgentTasks'), {
        ...TEST_TASK_PAYLOAD,
        createdBy: (currentUser && currentUser.uid) || 'admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setLastTaskId(ref.id)
      if (typeof onTaskCreated === 'function') onTaskCreated(ref.id)
    } catch (err) {
      setError(err && err.message ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">
            Manual pipeline test
          </h2>
          <p className="text-xs text-slate-600 leading-snug mt-0.5">
            Queues a fixed Grade 4 Integrated Science / Blood Circulatory
            System / The Heart practice quiz (10 questions) and runs it
            through the 5-agent chain. The artifact is saved as a draft —
            it is never auto-published.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleClick}
            disabled={submitting}
            className="inline-flex items-center justify-center text-xs font-semibold px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Queuing…' : 'Run Test Quiz Generation'}
          </button>
        </div>
      </div>
      {lastTaskId && !error && (
        <div className="mt-3 text-[11px] text-emerald-700 font-mono break-all">
          Queued task <span className="font-semibold">{lastTaskId}</span> —
          watch the agent cards + activity timeline below for live progress.
        </div>
      )}
      {error && (
        <div className="mt-3 text-[11px] text-rose-700">
          Failed to queue test task: {error}
        </div>
      )}
    </div>
  )
}
