/**
 * BulkPublishQuizzesButton — generate + save a learner-facing quiz for
 * each topic in the current CBC KB filter. Unlike BulkGenerateButton
 * (which queues agent briefs producing teacher artifacts), this one
 * writes directly to the public quizzes collection so learners see the
 * quizzes immediately.
 *
 * Why this exists: the project owner asked for "agents that produce
 * quizzes I review and approve". The agent pipeline doesn't drive the
 * quiz path (quizzes go through the synchronous generateQuizQuestions
 * callable + Vex verifier), so a separate bulk action is needed to
 * close that gap.
 *
 * Workflow:
 *   1. For each topic (capped at MAX_BATCH to limit cost):
 *      a. generateAIQuizQuestions → returns MCQs grounded on the KB
 *      b. createQuiz → writes a quiz doc with isPublished:false (draft)
 *      c. saveQuestions → batched write of normalized questions
 *   2. Reports per-topic progress, surfaces partial failures, and
 *      navigates to /admin/content on completion so the admin can
 *      review and publish.
 *
 * Quizzes are saved as drafts by default. The admin reviews, then
 * publishes via the standard Manage Content flow. No content reaches
 * learners until the human flips isPublished.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { generateAIQuizQuestions } from '../../utils/aiAssistant'

const MAX_BATCH = 10
const QUESTIONS_PER_QUIZ = 5

function gradeForLearnerCollection(grade) {
  // The CBC KB uses 'G6' / 'G7' / 'ECE'. The learner-facing /quizzes
  // page filters by plain '4'/'5'/'6'/'7'. Strip the leading 'G' so
  // saved quizzes appear in the right grade chip.
  const v = String(grade || '').toUpperCase()
  if (v.startsWith('G')) return v.slice(1)
  return v
}

function subjectForLearnerCollection(subject) {
  // The KB stores subject as a lowercase key ('mathematics'); the
  // learner-facing list expects the display label ('Mathematics').
  // We do the simplest mapping here — title-case the first letter, swap
  // underscores for spaces — so 'integrated_science' → 'Integrated Science'.
  return String(subject || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function BulkPublishQuizzesButton({ topics }) {
  const { currentUser } = useAuth()
  const { createQuiz, saveQuestions } = useFirestore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' })
  const [results, setResults] = useState({ saved: 0, failed: [] })

  const eligible = Array.isArray(topics) ?
    topics.filter((t) => t && t.grade && t.subject && t.topic) : []
  const count = Math.min(eligible.length, MAX_BATCH)

  if (eligible.length === 0) return null

  async function handleRun() {
    if (!currentUser?.uid || count === 0) return
    setBusy(true)
    setResults({ saved: 0, failed: [] })
    setProgress({ done: 0, total: count, label: 'Starting…' })
    const slice = eligible.slice(0, count)
    const failed = []
    let saved = 0

    for (let i = 0; i < slice.length; i++) {
      const t = slice[i]
      setProgress({ done: i, total: count, label: `Generating "${t.topic}"…` })
      try {
        const { questions } = await generateAIQuizQuestions({
          subject: subjectForLearnerCollection(t.subject),
          grade: gradeForLearnerCollection(t.grade),
          topic: t.topic,
          count: QUESTIONS_PER_QUIZ,
          type: 'mcq',
        })
        const usable = Array.isArray(questions) ? questions.filter((q) => {
          if (!q || typeof q !== 'object') return false
          if (!String(q.text || '').trim()) return false
          const opts = Array.isArray(q.options) ?
            q.options.filter((o) => String(o ?? '').trim()) : []
          return opts.length >= 2
        }) : []
        if (usable.length === 0) {
          failed.push({ topic: t.topic, error: 'No usable questions returned.' })
          continue
        }

        setProgress({ done: i, total: count, label: `Saving "${t.topic}"…` })
        const quizId = await createQuiz({
          title: `Grade ${gradeForLearnerCollection(t.grade)} ${subjectForLearnerCollection(t.subject)} — ${t.topic}`,
          subject: subjectForLearnerCollection(t.subject),
          grade: gradeForLearnerCollection(t.grade),
          term: t.term ? String(t.term) : '',
          description: `Auto-drafted quiz on ${t.topic} (review before publishing).`,
          passages: [],
          parts: [],
          passageCount: 0,
          totalMarks: usable.length,
          questionCount: usable.length,
          isPublished: false,
          status: 'draft',
          createdBy: currentUser.uid,
          durationMinutes: 15,
          quizType: 'practice',
        })
        await saveQuestions(quizId, usable)
        saved += 1
      } catch (err) {
        failed.push({
          topic: t.topic,
          error: err?.message || 'Unknown error',
        })
      }
    }

    setResults({ saved, failed })
    setProgress({ done: count, total: count, label: 'Done.' })
    setBusy(false)
    if (saved > 0 && failed.length === 0) {
      setTimeout(() => navigate('/admin/content'), 1500)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-sky-600 to-cyan-500 disabled:opacity-50"
        title={`Generate + save ${count} learner-facing quiz draft${count === 1 ? '' : 's'} from the current filter`}
      >
        ✏️ Bulk publish quizzes ({count})
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="font-black text-lg text-slate-900">Bulk publish quizzes</h3>
            <p className="text-xs text-slate-600 mt-1">
              Generates a {QUESTIONS_PER_QUIZ}-question MCQ quiz for each filtered topic and saves it as a draft to <code>quizzes/</code>. Capped at {MAX_BATCH} per click.
            </p>

            <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">
              <p className="font-black">{count} quiz draft{count === 1 ? '' : 's'} will be created</p>
              <p className="mt-0.5 text-sky-700">
                Saved as <code>isPublished: false</code> — review in /admin/content and click Publish when you're ready.
              </p>
            </div>

            {busy && (
              <div className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
                <p className="font-black">{progress.done} / {progress.total}</p>
                <p className="mt-0.5 truncate text-slate-600">{progress.label}</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-sky-500 transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {!busy && results.saved > 0 && (
              <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800 font-black">
                ✓ Saved {results.saved} quiz{results.saved === 1 ? '' : 'zes'} as draft{results.saved === 1 ? '' : 's'}.
                {results.failed.length === 0 && ' Redirecting to /admin/content…'}
              </p>
            )}
            {!busy && results.failed.length > 0 && (
              <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">
                <p className="font-black">{results.failed.length} failed</p>
                <ul className="mt-1 list-disc list-inside text-rose-700">
                  {results.failed.slice(0, 5).map((f, i) => (
                    <li key={i}><strong>{f.topic}</strong>: {f.error}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { if (!busy) setOpen(false) }}
                disabled={busy}
                className="px-3 py-2 rounded-xl text-xs font-black text-slate-600 hover:text-slate-800 disabled:opacity-50"
              >
                {results.saved > 0 ? 'Close' : 'Cancel'}
              </button>
              {results.saved === 0 && (
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={busy || count === 0}
                  className="px-4 py-2 rounded-xl text-xs font-black text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50"
                >
                  {busy ? 'Running…' : `Generate + save ${count}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
