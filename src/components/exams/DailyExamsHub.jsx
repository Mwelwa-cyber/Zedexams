/**
 * DailyExamsHub — /exams
 *
 * Shows today's available daily exams, one card per subject.
 * Each card reflects the user's current status for that subject:
 *
 *   ● No exam scheduled  → greyed-out card
 *   ● Not yet attempted  → "Start Exam" CTA
 *   ● In progress        → "Resume Exam" CTA + time remaining
 *   ● Completed          → score badge + "View Results" link
 */

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { SUBJECTS } from '../../config/curriculum'
import { getTodaysExam, checkDailyLock, todayString } from '../../utils/examService'
import Navbar from '../layout/Navbar'

function fmt(seconds) {
  const m = Math.floor(seconds / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return `${m}:${s}`
}

function pctColor(p) {
  if (p >= 70) return 'text-green-600'
  if (p >= 50) return 'text-yellow-600'
  return 'text-red-500'
}

function StatusPill({ lock, exam }) {
  if (!exam) return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">No exam today</span>
  if (!lock) return <span className="theme-accent-bg theme-accent-text rounded-full px-2.5 py-1 text-xs font-bold">Available</span>
  if (lock.status === 'submitted') return <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-700">Completed ✓</span>
  return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">In Progress</span>
}

function SubjectExamCard({ subject, exam, lock, onStart }) {
  const navigate = useNavigate()

  const handleCTA = () => {
    if (!exam) return
    if (lock?.status === 'submitted') {
      navigate(`/exam-results/${lock.attemptId}`)
      return
    }
    navigate(`/exam/${exam.id}`)
  }

  const isCompleted = lock?.status === 'submitted'
  const isInProgress = lock?.status === 'in_progress'
  const isAvailable = exam && !lock

  return (
    <div className={`theme-card rounded-2xl border-2 p-5 transition-all ${
      exam ? 'theme-border hover:shadow-md' : 'border-dashed border-slate-200 opacity-60'
    }`}>
      {/* Header row */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-2xl ${subject.tailwind.light}`}>
            {subject.icon}
          </div>
          <div>
            <p className="font-black theme-text text-sm leading-tight">{subject.label}</p>
            {exam && (
              <p className="theme-text-muted mt-0.5 text-xs font-bold truncate max-w-[140px]">{exam.title}</p>
            )}
          </div>
        </div>
        <StatusPill lock={lock} exam={exam} />
      </div>

      {/* Stats row (when exam exists) */}
      {exam && (
        <div className="mb-4 flex gap-3 text-xs">
          <span className="theme-bg-subtle theme-text-muted rounded-lg px-2 py-1 font-bold">
            ⏱️ {exam.durationMinutes || 30} min
          </span>
          <span className="theme-bg-subtle theme-text-muted rounded-lg px-2 py-1 font-bold">
            ❓ {exam.questionCount ?? '—'} Qs
          </span>
          <span className="theme-bg-subtle theme-text-muted rounded-lg px-2 py-1 font-bold">
            ⭐ {exam.totalMarks ?? '—'} marks
          </span>
        </div>
      )}

      {/* Score (completed) */}
      {isCompleted && lock && (
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-green-50 border border-green-200 px-3 py-2">
          <span className="text-xl">🏆</span>
          <div>
            <p className={`text-lg font-black ${pctColor(lock.percentage ?? 0)}`}>
              {lock.percentage ?? '—'}%
            </p>
            <p className="text-xs font-bold text-green-700">
              {lock.score ?? '—'}/{lock.totalMarks ?? '—'} marks
            </p>
          </div>
        </div>
      )}

      {/* CTA button */}
      {isCompleted ? (
        <button
          type="button"
          onClick={handleCTA}
          className="w-full rounded-xl border-2 theme-border py-2.5 text-sm font-black theme-text hover:theme-bg-subtle transition-colors"
        >
          📊 View Results & Leaderboard
        </button>
      ) : isInProgress ? (
        <button
          type="button"
          onClick={handleCTA}
          className="w-full rounded-xl bg-amber-400 py-2.5 text-sm font-black text-slate-900 shadow-sm hover:bg-amber-500 transition-colors"
        >
          ▶ Resume Exam
        </button>
      ) : isAvailable ? (
        <button
          type="button"
          onClick={handleCTA}
          className="theme-accent-fill theme-on-accent w-full rounded-xl py-2.5 text-sm font-black shadow-sm hover:opacity-90 transition-opacity"
        >
          🚀 Start Exam
        </button>
      ) : (
        <div className="w-full rounded-xl border border-dashed border-slate-200 py-2.5 text-center text-xs font-bold text-slate-400">
          No exam scheduled
        </div>
      )}
    </div>
  )
}

export default function DailyExamsHub() {
  const { currentUser, userProfile } = useAuth()
  const grade = userProfile?.grade || '5'

  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false

    async function load() {
      const rows = await Promise.all(
        SUBJECTS.map(async subject => {
          const [exam, lock] = await Promise.all([
            getTodaysExam(subject.id, grade),
            checkDailyLock(currentUser.uid, subject.id),
          ])
          return { subject, exam, lock }
        }),
      )
      if (!cancelled) {
        setItems(rows)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [currentUser, grade])

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const completedCount = items.filter(r => r.lock?.status === 'submitted').length
  const availableCount = items.filter(r => r.exam && !r.lock).length

  return (
    <div className="min-h-screen theme-bg theme-text">
      <Navbar />

      <div className="mx-auto max-w-4xl px-4 py-6 pb-24">

        {/* Page header */}
        <div className="mb-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black theme-text flex items-center gap-2">
                🏆 Daily Exams
              </h1>
              <p className="theme-text-muted text-sm mt-0.5">{today}</p>
            </div>
            <Link
              to="/dashboard"
              className="text-xs font-bold theme-accent-text hover:opacity-80"
            >
              ← Dashboard
            </Link>
          </div>

          {/* Summary banner */}
          {!loading && (
            <div className="mt-4 flex gap-3 flex-wrap">
              <div className="theme-card rounded-xl border theme-border px-4 py-2.5 text-center">
                <p className="text-xl font-black theme-text">{completedCount}</p>
                <p className="theme-text-muted text-xs font-bold">Completed</p>
              </div>
              <div className="theme-card rounded-xl border theme-border px-4 py-2.5 text-center">
                <p className="text-xl font-black theme-text">{availableCount}</p>
                <p className="theme-text-muted text-xs font-bold">Available</p>
              </div>
              <div className="theme-card rounded-xl border theme-border px-4 py-2.5 text-center">
                <p className="text-xl font-black theme-text">{SUBJECTS.length - completedCount - availableCount}</p>
                <p className="theme-text-muted text-xs font-bold">Not scheduled</p>
              </div>
            </div>
          )}
        </div>

        {/* Rule callout */}
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="text-lg mt-0.5">⚠️</span>
          <p className="text-sm font-bold text-amber-800">
            Each subject can only be attempted <strong>once per day</strong>. The timer cannot be
            paused or reset — even if you refresh the page.
          </p>
        </div>

        {/* Cards grid */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: SUBJECTS.length }).map((_, i) => (
              <div key={i} className="theme-card rounded-2xl border theme-border p-5 animate-pulse h-44" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {items.map(({ subject, exam, lock }) => (
              <SubjectExamCard
                key={subject.id}
                subject={subject}
                exam={exam}
                lock={lock}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
