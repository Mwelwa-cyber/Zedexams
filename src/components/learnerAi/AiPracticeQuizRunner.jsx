import { useEffect, useState } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext'
import SeoHelmet from '../seo/SeoHelmet'
import {
  loadPracticeQuiz,
  submitAiPracticeQuizAttempt,
  estimatedMinutesForQuiz,
} from '../../utils/aiPracticeQuizService'

// /ai-practice/:contentId — learner runs an AI-generated practice
// quiz. On submit: writes a results doc + queues weakness + feedback
// agent tasks (study_tips is queued downstream by the Weakness
// agent when it finds signals).
//
// Same feature-flag gate as the list page.

function QuestionView({ q, index, answer, onAnswerChange }) {
  const prompt = q.prompt || q.questionText || ''
  return (
    <article className="rounded-2xl border theme-border theme-card p-4 space-y-3">
      <header className="flex items-baseline gap-2">
        <span className="text-xs font-bold theme-text-muted tabular-nums">
          Q{index + 1}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
          {q.questionType}
        </span>
        {Number.isInteger(q.marks) && (
          <span className="text-[10px] theme-text-muted tabular-nums ml-auto">
            {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
          </span>
        )}
      </header>
      <p className="text-sm theme-text whitespace-pre-wrap">{prompt}</p>

      {q.questionType === 'mcq' && Array.isArray(q.options) && (
        <ul className="space-y-2">
          {q.options.map((opt, i) => (
            <li key={i}>
              <label className="flex items-start gap-2 cursor-pointer rounded-lg border theme-border px-3 py-2 hover:theme-bg-subtle">
                <input
                  type="radio"
                  name={`q-${index}`}
                  className="mt-1"
                  checked={answer === opt}
                  onChange={() => onAnswerChange(opt)}
                />
                <span className="text-sm theme-text flex-1">{opt}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {q.questionType === 'true_false' && (
        <div className="flex gap-2">
          {['True', 'False'].map(v => (
            <button
              key={v}
              type="button"
              onClick={() => onAnswerChange(v)}
              className={`flex-1 text-sm font-bold px-3 py-2 rounded-xl border ${
                answer === v ?
                  'bg-blue-600 text-white border-blue-600' :
                  'theme-card theme-border theme-text hover:theme-bg-subtle'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {q.questionType === 'short_answer' && (
        <input
          type="text"
          value={answer || ''}
          onChange={e => onAnswerChange(e.target.value)}
          placeholder="Type your answer…"
          className="w-full text-sm theme-input rounded-xl px-3 py-2"
          maxLength={300}
        />
      )}

      {q.questionType === 'matching' && (
        <div className="text-xs theme-text-muted italic">
          Matching questions launch in the next update. For now, this question
          will be skipped on submission.
        </div>
      )}
    </article>
  )
}

function ResultsView({ result }) {
  const { scored, resultId, weaknessTaskId, feedbackTaskId } = result
  const passed = scored.percentage >= 70
  return (
    <div className="space-y-4">
      <div className={`rounded-2xl p-5 ${
        passed ?
          'bg-emerald-50 border-2 border-emerald-300' :
          'bg-amber-50 border-2 border-amber-300'
      }`}>
        <div className="text-center">
          <div className="text-[10px] font-bold uppercase tracking-wider theme-text-muted">
            Your score
          </div>
          <div className="text-5xl font-bold mt-1 tabular-nums">
            {scored.percentage}%
          </div>
          <div className="text-sm theme-text-muted mt-1 tabular-nums">
            {scored.totalScore} / {scored.totalMarks} marks
          </div>
        </div>
      </div>

      <div className="rounded-2xl border theme-border theme-card p-4">
        <div className="text-xs font-bold theme-text mb-2">What happens next</div>
        <ul className="space-y-1.5 text-xs theme-text-muted">
          <li>
            <span className="theme-text">✓</span> Your attempt is saved (
            <span className="font-mono">{resultId.slice(0, 8)}…</span>
            ).
          </li>
          {weaknessTaskId && (
            <li>
              <span className="theme-text">✓</span> The Weakness Detection agent is
              scanning your topic scores. Study tips refresh when it's done.
            </li>
          )}
          {feedbackTaskId && (
            <li>
              <span className="theme-text">✓</span> Personalised feedback is being
              prepared for your dashboard.
            </li>
          )}
          {!weaknessTaskId && !feedbackTaskId && (
            <li className="text-amber-700">
              Could not queue follow-up agents (network issue). Your result is
              saved; refresh later to see updated tips.
            </li>
          )}
        </ul>
      </div>

      {scored.perQuestion && scored.perQuestion.length > 0 && (
        <div className="rounded-2xl border theme-border theme-card p-4">
          <div className="text-xs font-bold theme-text mb-2">
            Per-question marking
          </div>
          <ul className="space-y-2 text-xs">
            {scored.perQuestion.map((pq, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={pq.correct ? 'text-emerald-600' : 'text-rose-600'}>
                  {pq.correct ? '✓' : '✗'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="theme-text line-clamp-1">
                    Q{i + 1}: {pq.prompt}
                  </div>
                  {!pq.correct && (
                    <div className="theme-text-muted mt-0.5">
                      Your answer: <em>{pq.learnerAnswer || '(blank)'}</em> ·
                      Correct: <strong>{pq.correctAnswer}</strong>
                    </div>
                  )}
                </div>
                <span className="tabular-nums theme-text-muted">
                  {pq.awardedMarks}/{pq.maxMarks}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <Link
          to="/ai-practice"
          className="flex-1 text-center text-sm font-bold px-4 py-2 rounded-xl theme-card border theme-border theme-text hover:theme-bg-subtle"
        >
          Back to quizzes
        </Link>
        <Link
          to="/dashboard"
          className="flex-1 text-center text-sm font-bold px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}

export default function AiPracticeQuizRunner() {
  const { contentId } = useParams()
  const { currentUser, userProfile, loading: authLoading } = useAuth()
  const { settings: platform, loaded: platformLoaded } = usePlatformSettings()
  const [artifact, setArtifact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  const flagOn = !!(platform && platform.learnerAi && platform.learnerAi.showAiPracticeQuizzesToLearners)
  const learnerGrade = userProfile && userProfile.grade

  useEffect(() => {
    if (!contentId) return
    if (!flagOn || !learnerGrade) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    loadPracticeQuiz({ contentId, learnerGrade })
        .then(a => {
          if (cancelled) return
          setArtifact(a)
          setLoading(false)
        })
        .catch(e => {
          if (cancelled) return
          setErr(e.message)
          setLoading(false)
        })
    return () => { cancelled = true }
  }, [contentId, flagOn, learnerGrade])

  if (authLoading || !platformLoaded) {
    return <div className="max-w-2xl mx-auto p-6 text-center theme-text-muted">Loading…</div>
  }
  if (!currentUser) return <Navigate to="/login" replace />
  if (!flagOn) return <Navigate to="/dashboard" replace />
  if (!learnerGrade) return <Navigate to="/profile" replace />

  if (loading) {
    return <div className="max-w-2xl mx-auto p-6 text-center theme-text-muted">Loading quiz…</div>
  }

  if (err) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-3 text-center">
        <SeoHelmet title="Quiz unavailable" />
        <p className="theme-text">{err}</p>
        <Link to="/ai-practice" className="theme-btn">Back to quizzes</Link>
      </div>
    )
  }
  if (!artifact) return null

  const content = artifact.content || {}
  const questions = Array.isArray(content.questions) ? content.questions : []
  const allAnswered = questions.every((_q, i) => answers[i] != null && answers[i] !== '')

  if (result) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-5">
        <SeoHelmet title={`Results — ${content.title || 'AI practice'}`} />
        <ResultsView result={result} />
      </div>
    )
  }

  async function handleSubmit() {
    setSubmitting(true)
    setErr(null)
    try {
      const out = await submitAiPracticeQuizAttempt({
        artifact, answers, learnerId: currentUser.uid, learnerGrade,
      })
      setResult(out)
    } catch (e) {
      setErr(e.message || 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
      <SeoHelmet title={content.title || 'AI practice quiz'} />
      <header>
        <Link to="/ai-practice" className="text-xs theme-text-muted hover:underline">
          ← All AI practice quizzes
        </Link>
        <h1 className="text-xl font-bold theme-text mt-1">
          {content.title || `${artifact.subject || 'Subject'} — ${artifact.topic || 'Topic'}`}
        </h1>
        <p className="text-xs theme-text-muted mt-1">
          {questions.length} question{questions.length === 1 ? '' : 's'} · ~{estimatedMinutesForQuiz(artifact)} min · Grade {artifact.grade}
        </p>
      </header>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <QuestionView
            key={i}
            q={q}
            index={i}
            answer={answers[i]}
            onAnswerChange={v => setAnswers(a => ({ ...a, [i]: v }))}
          />
        ))}
      </div>

      <div className="sticky bottom-3 z-10 rounded-2xl border theme-border theme-card p-3 flex items-center justify-between gap-3">
        <div className="text-xs theme-text-muted">
          {Object.values(answers).filter(v => v != null && v !== '').length} of {questions.length} answered
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !allAnswered}
          className="text-sm font-bold px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Submitting…' : 'Submit answers'}
        </button>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm p-3">
          {err}
        </div>
      )}
    </div>
  )
}
