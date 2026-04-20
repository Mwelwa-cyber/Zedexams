/**
 * ExamResultsPage — /exam-results/:attemptId
 *
 * Shows:
 *   - Score card (percentage, score/marks, time taken)
 *   - Daily leaderboard for the same subject + date (top 10)
 *   - Current user's rank highlighted
 */

import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getExamAttempt } from '../../utils/examService'
import { getDailyLeaderboard, fmtDuration } from '../../utils/examLeaderboardService'
import Navbar from '../layout/Navbar'

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

function rankMedal(rank) {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return `#${rank}`
}

function ScoreCard({ attempt }) {
  const pct = attempt.percentage ?? 0
  const passed = pct >= 50

  return (
    <div className={`rounded-3xl border-2 p-6 text-center ${pctBg(pct)}`}>
      <div className="mb-2 text-5xl">{pct >= 80 ? '🌟' : pct >= 60 ? '👍' : '📘'}</div>
      <p className={`text-5xl font-black ${pctColor(pct)}`}>{pct}%</p>
      <p className="theme-text-muted mt-1 text-sm font-bold">
        {attempt.score ?? 0} / {attempt.totalMarks ?? 0} marks
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="theme-card rounded-2xl border theme-border px-3 py-3 text-center">
          <p className="text-lg font-black theme-text">
            {fmtDuration(attempt.timeTakenSeconds)}
          </p>
          <p className="theme-text-muted text-xs font-bold">Time taken</p>
        </div>
        <div className={`rounded-2xl border px-3 py-3 text-center ${passed ? 'bg-green-100 border-green-300' : 'bg-red-100 border-red-300'}`}>
          <p className={`text-lg font-black ${passed ? 'text-green-700' : 'text-red-600'}`}>
            {passed ? 'Passed ✓' : 'Needs work'}
          </p>
          <p className={`text-xs font-bold ${passed ? 'text-green-600' : 'text-red-500'}`}>
            {passed ? 'Well done!' : 'Keep practising'}
          </p>
        </div>
      </div>
    </div>
  )
}

function LeaderboardRow({ entry, isMe }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors ${
      isMe ? 'bg-amber-50 border-2 border-amber-300' : 'theme-card border theme-border'
    }`}>
      {/* Rank */}
      <div className="w-10 flex-shrink-0 text-center">
        <span className={`text-lg font-black ${isMe ? 'text-amber-700' : 'theme-text-muted'}`}>
          {rankMedal(entry.rank)}
        </span>
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className={`font-black text-sm truncate ${isMe ? 'text-amber-800' : 'theme-text'}`}>
          {entry.displayName}{isMe ? ' (You)' : ''}
        </p>
        <p className="theme-text-muted text-xs font-bold">{fmtDuration(entry.timeTakenSeconds)}</p>
      </div>

      {/* Score */}
      <div className="text-right flex-shrink-0">
        <p className={`font-black text-lg ${pctColor(entry.percentage)}`}>{entry.percentage}%</p>
        <p className="theme-text-muted text-xs font-bold">{entry.score}/{entry.totalMarks}</p>
      </div>
    </div>
  )
}

export default function ExamResultsPage() {
  const { attemptId } = useParams()
  const { currentUser } = useAuth()

  const [attempt,     setAttempt]     = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [lbLoading,   setLbLoading]   = useState(true)
  const [error,       setError]       = useState('')

  // Load attempt
  useEffect(() => {
    if (!attemptId) return
    getExamAttempt(attemptId).then(data => {
      if (!data) { setError('Result not found.'); setLoading(false); return }
      setAttempt(data)
      setLoading(false)

      // Load leaderboard once we know the subject + date
      getDailyLeaderboard(data.subject, data.attemptDate).then(rows => {
        setLeaderboard(rows)
        setLbLoading(false)
      })
    })
  }, [attemptId])

  // Find current user's rank on the leaderboard
  const myEntry = leaderboard.find(e => e.userId === currentUser?.uid)

  if (loading) {
    return (
      <div className="theme-bg flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-3 text-5xl animate-bounce">📊</div>
          <p className="theme-accent-text text-lg font-bold">Loading results…</p>
        </div>
      </div>
    )
  }

  if (error || !attempt) {
    return (
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
  }

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="min-h-screen theme-bg theme-text">
      <Navbar />

      <div className="mx-auto max-w-2xl px-4 py-6 pb-24 space-y-6">

        {/* Page header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black theme-text">Exam Results</h1>
            <p className="theme-text-muted text-sm mt-0.5">
              {attempt.subject} · Grade {attempt.grade} · {today}
            </p>
          </div>
          <Link to="/exams" className="text-xs font-bold theme-accent-text hover:opacity-80">
            ← All Exams
          </Link>
        </div>

        {/* Score card */}
        <ScoreCard attempt={attempt} />

        {/* My rank callout (if on leaderboard) */}
        {myEntry && (
          <div className="flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
            <span className="text-2xl">{rankMedal(myEntry.rank)}</span>
            <div>
              <p className="font-black text-amber-800 text-sm">
                You ranked #{myEntry.rank} on today&apos;s leaderboard
              </p>
              <p className="text-amber-700 text-xs font-bold mt-0.5">
                Out of {leaderboard.length} students · {attempt.subject}
              </p>
            </div>
          </div>
        )}

        {/* Leaderboard */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black theme-text">
            🏆 Today&apos;s Leaderboard
            <span className="theme-text-muted text-sm font-bold">{attempt.subject}</span>
          </h2>

          {lbLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="theme-card rounded-2xl border theme-border p-4 animate-pulse h-14" />
              ))}
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="theme-card rounded-2xl border theme-border p-6 text-center">
              <p className="text-3xl mb-2">🔭</p>
              <p className="font-black theme-text text-sm">No results yet</p>
              <p className="theme-text-muted text-xs mt-1">
                Be the first on today&apos;s leaderboard!
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map(entry => (
                <LeaderboardRow
                  key={entry.attemptId}
                  entry={entry}
                  isMe={entry.userId === currentUser?.uid}
                />
              ))}
            </div>
          )}
        </section>

        {/* Action buttons */}
        <div className="flex flex-col gap-3">
          <Link
            to="/exams"
            className="theme-accent-fill theme-on-accent w-full rounded-2xl py-3.5 text-center text-sm font-black hover:opacity-90 transition-opacity"
          >
            🏆 More Daily Exams
          </Link>
          <Link
            to="/quizzes"
            className="theme-border theme-text w-full rounded-2xl border-2 py-3.5 text-center text-sm font-black hover:theme-bg-subtle transition-colors"
          >
            📝 Practice Quizzes
          </Link>
        </div>
      </div>
    </div>
  )
}
