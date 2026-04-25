/**
 * ExamResultsPage — /exam-results/:attemptId
 *
 * Tabs:
 *   My Results  — score, performance, CBC feedback, topic breakdown, corrections
 *   Leaderboard — real-time daily leaderboard for the same subject + date
 */

import { useState, useEffect, useRef } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getExamAttempt, getExamWithQuestions } from '../../utils/examService'
import { subscribeToDailyLeaderboard, fmtDuration } from '../../utils/examLeaderboardService'
import Navbar from '../layout/Navbar'
import useSoundEffects from '../../hooks/useSoundEffects'
import { Volume2, VolumeX } from '../ui/icons'

// ── helpers ────────────────────────────────────────────────────────────────────

function pctColor(p) {
  if (p >= 80) return 'text-green-600'
  if (p >= 60) return 'text-yellow-600'
  return 'text-red-500'
}
function pctBg(p) {
  if (p >= 80) return 'bg-green-50 border-green-200'
  if (p >= 60) return 'bg-yellow-50 border-yellow-200'
  return 'bg-red-50 border-red-200'
}
function perfEmoji(level) {
  const map = { Excellent: '🌟', 'Very Good': '👍', Good: '✅', Developing: '📘', 'Needs Improvement': '💪' }
  return map[level] ?? '📊'
}
function rankMedal(rank) {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return `#${rank}`
}

// ── sub-components ─────────────────────────────────────────────────────────────

function ScoreCard({ attempt }) {
  const pct = attempt.percentage ?? 0
  return (
    <div className={`rounded-3xl border-2 p-6 text-center ${pctBg(pct)}`}>
      <div className="mb-2 text-4xl">{perfEmoji(attempt.performanceLevel)}</div>
      <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-1">
        {attempt.performanceLevel ?? 'Completed'}
      </p>
      <p className={`text-5xl font-black ${pctColor(pct)}`}>{pct}%</p>
      <p className="theme-text-muted mt-1 text-sm font-bold">
        {attempt.score ?? 0} / {attempt.totalMarks ?? 0} marks
        {attempt.totalQuestions ? ` · ${attempt.totalQuestions} questions` : ''}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="theme-card rounded-2xl border theme-border px-3 py-2.5 text-center">
          <p className="text-lg font-black theme-text">{fmtDuration(attempt.timeTakenSeconds)}</p>
          <p className="theme-text-muted text-xs font-bold">Time taken</p>
        </div>
        <div className={`rounded-2xl border px-3 py-2.5 text-center ${pct >= 50 ? 'bg-green-100 border-green-300' : 'bg-red-100 border-red-300'}`}>
          <p className={`text-lg font-black ${pct >= 50 ? 'text-green-700' : 'text-red-600'}`}>
            {pct >= 50 ? 'Passed ✓' : 'Needs work'}
          </p>
          <p className={`text-xs font-bold ${pct >= 50 ? 'text-green-600' : 'text-red-500'}`}>
            {pct >= 50 ? 'Well done!' : 'Keep practising'}
          </p>
        </div>
      </div>
    </div>
  )
}

function StrengthsWeaknesses({ strengths = [], weaknesses = [] }) {
  if (!strengths.length && !weaknesses.length) return null
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {strengths.length > 0 && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-green-700 mb-2">
            ✅ Your Strengths
          </p>
          <ul className="space-y-1">
            {strengths.map(t => (
              <li key={t} className="text-sm font-bold text-green-800 flex items-start gap-2">
                <span className="mt-0.5 text-green-500">•</span>{t}
              </li>
            ))}
          </ul>
        </div>
      )}
      {weaknesses.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-amber-700 mb-2">
            📚 Needs More Practice
          </p>
          <ul className="space-y-1">
            {weaknesses.map(t => (
              <li key={t} className="text-sm font-bold text-amber-800 flex items-start gap-2">
                <span className="mt-0.5 text-amber-500">•</span>{t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function FeedbackBlock({ feedback }) {
  if (!feedback) return null
  const bullets = [feedback.can, feedback.developing, feedback.practice].filter(Boolean)
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <p className="text-xs font-black uppercase tracking-wide text-blue-700 mb-3">
        📋 CBC Learning Feedback
      </p>
      <ul className="space-y-2">
        {bullets.map((b, i) => (
          <li key={i} className="text-sm font-bold text-blue-900 flex items-start gap-2">
            <span className="mt-0.5 text-blue-400 flex-shrink-0">•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TopicBreakdown({ topicBreakdown }) {
  if (!topicBreakdown || !Object.keys(topicBreakdown).length) return null
  const entries = Object.entries(topicBreakdown).sort(([, a], [, b]) => b.percentage - a.percentage)

  return (
    <section>
      <h2 className="text-base font-black theme-text mb-3 flex items-center gap-2">
        📊 Topic Breakdown
      </h2>
      <div className="space-y-2">
        {entries.map(([topic, data]) => (
          <div key={topic} className="theme-card rounded-2xl border theme-border p-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-sm font-black theme-text truncate">{topic}</p>
              <span className={`text-sm font-black flex-shrink-0 ${pctColor(data.percentage)}`}>
                {data.percentage}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-slate-100">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    data.percentage >= 70 ? 'bg-green-500' :
                    data.percentage >= 50 ? 'bg-yellow-500' : 'bg-red-400'
                  }`}
                  style={{ width: `${data.percentage}%` }}
                />
              </div>
              <span className="text-xs font-bold theme-text-muted flex-shrink-0">
                {data.correct}/{data.total}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function CorrectionsView({ attempt, questions }) {
  if (!questions?.length) {
    return (
      <div className="theme-card rounded-2xl border theme-border p-6 text-center">
        <p className="theme-text-muted text-sm">Questions not available for review.</p>
      </div>
    )
  }

  return (
    <section>
      <h2 className="text-base font-black theme-text mb-3">📝 Question Review</h2>
      <div className="space-y-3">
        {questions.map((q, idx) => {
          const given      = attempt.answers?.[q.id]
          const isText     = q.type === 'short_answer' || q.type === 'diagram'
          const isCorrect  = isText ? given?.correct === true : given === q.correctAnswer
          const skipped    = given === undefined || given === null || given === ''

          return (
            <div
              key={q.id}
              className={`rounded-2xl border-2 p-4 ${
                isCorrect ? 'border-green-200 bg-green-50'
                : skipped  ? 'border-slate-200 bg-slate-50'
                : 'border-red-200 bg-red-50'
              }`}
            >
              <div className="flex items-start gap-2 mb-2">
                <span className={`text-sm flex-shrink-0 font-black ${
                  isCorrect ? 'text-green-600' : skipped ? 'text-slate-400' : 'text-red-600'
                }`}>
                  Q{idx + 1}. {isCorrect ? '✓' : skipped ? '—' : '✗'}
                </span>
                <p className="text-sm font-bold theme-text">{q.text || q.question || '(question text)'}</p>
              </div>

              {q.topic && (
                <p className="text-xs theme-text-muted font-bold mb-2">Topic: {q.topic}</p>
              )}

              {!isText && (
                <div className="space-y-1 text-xs font-bold">
                  {!isCorrect && !skipped && (
                    <p className="text-red-700">Your answer: {given ?? '—'}</p>
                  )}
                  {skipped && <p className="text-slate-500">Not answered</p>}
                  <p className="text-green-700">Correct answer: {q.correctAnswer ?? '—'}</p>
                </div>
              )}
              {isText && (
                <p className="text-xs font-bold text-blue-700">
                  {isCorrect ? 'Marked correct by teacher' : 'Awaiting teacher marking'}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function LeaderboardSection({ attempt, currentUserId }) {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const unsubRef = useRef(null)

  useEffect(() => {
    if (!attempt) return
    if (unsubRef.current) unsubRef.current()
    unsubRef.current = subscribeToDailyLeaderboard(
      { subject: attempt.subject, date: attempt.attemptDate },
      (newRows) => { setRows(newRows); setLoading(false) },
    )
    return () => { if (unsubRef.current) unsubRef.current() }
  }, [attempt?.subject, attempt?.attemptDate])

  const myEntry = rows.find(r => r.userId === currentUserId)

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-black theme-text flex items-center gap-2">
          🏆 Today's Leaderboard
          <span className="theme-text-muted text-sm font-bold">{attempt?.subject}</span>
        </h2>
        <Link to="/exams/leaderboard" className="text-xs font-bold theme-accent-text hover:opacity-80">
          Full →
        </Link>
      </div>

      {myEntry && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <span className="text-xl">{rankMedal(myEntry.rank)}</span>
          <div>
            <p className="font-black text-amber-800 text-sm">
              You ranked #{myEntry.rank} · {myEntry.percentage}%
            </p>
            <p className="text-amber-700 text-xs font-bold mt-0.5">
              Out of {rows.length} students
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="theme-card rounded-2xl border theme-border p-4 animate-pulse h-14" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="theme-card rounded-2xl border theme-border p-6 text-center">
          <p className="text-2xl mb-1">🔭</p>
          <p className="font-black theme-text text-sm">No results yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(entry => (
            <div
              key={entry.attemptId}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${
                entry.userId === currentUserId
                  ? 'bg-amber-50 border-2 border-amber-300'
                  : 'theme-card border theme-border'
              }`}
            >
              <div className="w-9 text-center flex-shrink-0 text-lg font-black">{rankMedal(entry.rank)}</div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm theme-text truncate">
                  {entry.displayName}{entry.userId === currentUserId ? ' (You)' : ''}
                </p>
                <p className="theme-text-muted text-xs font-bold">{fmtDuration(entry.timeTakenSeconds)}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`font-black text-lg ${pctColor(entry.percentage)}`}>{entry.percentage}%</p>
                <p className="theme-text-muted text-xs font-bold">{entry.score}/{entry.totalMarks}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── main page ──────────────────────────────────────────────────────────────────

const TABS = ['My Results', 'Leaderboard']

export default function ExamResultsPage() {
  const { attemptId } = useParams()
  const { currentUser } = useAuth()
  const navigate = useNavigate()

  const [attempt,   setAttempt]   = useState(null)
  const [questions, setQuestions] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [tab,       setTab]       = useState('My Results')
  const [showCorrections, setShowCorrections] = useState(false)
  const [loadingQs, setLoadingQs] = useState(false)
  const { isMuted, toggleMute, playSuccess, playClick, playWarning, primeSounds } = useSoundEffects()

  useEffect(() => {
    if (!attemptId) return
    let cancelled = false
    getExamAttempt(attemptId)
      .then(data => {
        if (cancelled) return
        if (!data) { setError('Result not found.'); setLoading(false); return }
        setAttempt(data)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        console.error('ExamResultsPage load failed', err)
        setError('Could not load result. Please try again.')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [attemptId])

  // Soft success / warning chime once the result is on screen.
  useEffect(() => {
    if (!attempt) return
    const pct = attempt.percentage ?? 0
    if (pct < 50) playWarning()
    else playSuccess()
  }, [attempt, playSuccess, playWarning])

  async function handleViewCorrections() {
    playClick()
    if (questions.length) { setShowCorrections(true); return }
    setLoadingQs(true)
    try {
      const result = await getExamWithQuestions(attempt.examId)
      setQuestions(result?.questions ?? [])
    } finally {
      setLoadingQs(false)
      setShowCorrections(true)
    }
  }

  if (loading) return (
    <div className="theme-bg flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-3 text-5xl animate-bounce">📊</div>
        <p className="theme-accent-text text-lg font-bold">Loading results…</p>
      </div>
    </div>
  )

  if (error || !attempt) return (
    <div className="theme-bg flex min-h-screen items-center justify-center px-4">
      <div className="theme-card theme-border w-full max-w-sm rounded-3xl border p-8 text-center">
        <p className="text-4xl mb-3">😕</p>
        <p className="font-bold text-red-600">{error || 'Result not found.'}</p>
        <Link to="/exams" className="theme-accent-fill theme-on-accent mt-4 inline-block rounded-2xl px-5 py-2.5 font-bold text-sm">
          ← Back to Exams
        </Link>
      </div>
    </div>
  )

  const weakSubjectLink = attempt.weaknesses?.length
    ? `/quizzes?subject=${encodeURIComponent(attempt.subject)}&grade=${attempt.grade}`
    : `/quizzes`

  return (
    <div className="min-h-screen theme-bg theme-text">
      <Navbar />

      <div className="mx-auto max-w-2xl px-4 py-6 pb-28 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black theme-text">Exam Complete</h1>
            <p className="theme-text-muted text-sm mt-0.5">
              {attempt.subject} · Grade {attempt.grade}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { primeSounds(); toggleMute() }}
              aria-label={isMuted ? 'Unmute sound effects' : 'Mute sound effects'}
              aria-pressed={isMuted}
              title={isMuted ? 'Unmute sound effects' : 'Mute sound effects'}
              className="theme-text-muted hover:theme-text inline-flex h-8 w-8 items-center justify-center rounded-full border theme-border transition-colors"
            >
              {isMuted
                ? <VolumeX className="h-4 w-4" aria-hidden="true" />
                : <Volume2 className="h-4 w-4" aria-hidden="true" />}
            </button>
            <Link to="/exams" onClick={() => playClick()} className="text-xs font-bold theme-accent-text hover:opacity-80">
              ← All Exams
            </Link>
          </div>
        </div>

        {/* Score card (always visible) */}
        <ScoreCard attempt={attempt} />

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl border theme-border p-1 theme-card">
          {TABS.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => { playClick(); setTab(t) }}
              className={`flex-1 rounded-xl py-2 text-xs font-black transition-all ${
                tab === t
                  ? 'theme-accent-fill theme-on-accent shadow-sm'
                  : 'theme-text-muted hover:theme-text'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── My Results tab ────────────────────────────────────── */}
        {tab === 'My Results' && (
          <>
            <StrengthsWeaknesses
              strengths={attempt.strengths}
              weaknesses={attempt.weaknesses}
            />

            <FeedbackBlock feedback={attempt.feedback} />

            <TopicBreakdown topicBreakdown={attempt.topicBreakdown} />

            {/* Corrections */}
            {!showCorrections ? (
              <button
                type="button"
                onClick={handleViewCorrections}
                disabled={loadingQs}
                className="w-full rounded-2xl border-2 theme-border py-3 text-sm font-black theme-text hover:theme-bg-subtle transition-colors disabled:opacity-50"
              >
                {loadingQs ? 'Loading…' : '🔍 View Corrections'}
              </button>
            ) : (
              <CorrectionsView attempt={attempt} questions={questions} />
            )}

            {/* Recommended actions */}
            <section>
              <p className="text-xs font-black uppercase tracking-wide theme-text-muted mb-3">
                Recommended Next Step
              </p>
              <div className="flex flex-col gap-2">
                {attempt.weaknesses?.length > 0 && (
                  <Link
                    to={weakSubjectLink}
                    onClick={() => playClick()}
                    className="theme-accent-fill theme-on-accent w-full rounded-2xl py-3 text-center text-sm font-black hover:opacity-90 transition-opacity"
                  >
                    📚 Practice Weak Areas
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handleViewCorrections}
                  className="w-full rounded-2xl border-2 theme-border py-3 text-sm font-black theme-text hover:theme-bg-subtle transition-colors"
                >
                  🔍 View Corrections
                </button>
                <Link
                  to="/exams"
                  onClick={() => playClick()}
                  className="w-full rounded-2xl border-2 theme-border py-3 text-center text-sm font-black theme-text hover:theme-bg-subtle transition-colors"
                >
                  🏆 Back to Exams
                </Link>
              </div>
            </section>
          </>
        )}

        {/* ── Leaderboard tab ───────────────────────────────────── */}
        {tab === 'Leaderboard' && (
          <LeaderboardSection attempt={attempt} currentUserId={currentUser?.uid} />
        )}

      </div>
    </div>
  )
}
