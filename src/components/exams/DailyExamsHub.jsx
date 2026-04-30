/**
 * DailyExamsHub — /exams
 *
 * Shows today's available daily exams, one card per subject.
 * Each card reflects the user's current status for that subject:
 *
 *   ● No exam scheduled  → placeholder card
 *   ● Not yet attempted  → "Start Exam" CTA
 *   ● In progress        → "Resume Exam" CTA
 *   ● Completed          → score badge + "View Results" link
 */

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { SUBJECTS } from '../../config/curriculum'
import { getTodaysExam, checkDailyLock } from '../../utils/examService'
import Navbar from '../layout/Navbar'

function pctColor(p) {
  if (p >= 70) return 'text-green-600'
  if (p >= 50) return 'text-yellow-600'
  return 'text-red-500'
}

function StatusBadge({ lock, exam }) {
  if (!exam) return <span className="daily-status-badge">None</span>
  if (!lock) {
    return (
      <span
        className="daily-status-badge"
        style={{ background: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
      >
        Available
      </span>
    )
  }
  if (lock.status === 'submitted') {
    return (
      <span
        className="daily-status-badge"
        style={{ background: 'var(--success-bg)', color: 'var(--success-fg)' }}
      >
        Completed
      </span>
    )
  }
  return (
    <span
      className="daily-status-badge"
      style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}
    >
      In progress
    </span>
  )
}

function SubjectExamCard({ subject, exam, lock }) {
  const navigate = useNavigate()

  const isCompleted = lock?.status === 'submitted'
  const isInProgress = lock?.status === 'in_progress'
  const isAvailable = exam && !lock

  const handleCTA = () => {
    if (!exam) return
    if (isCompleted) {
      navigate(`/exam-results/${lock.attemptId}`)
      return
    }
    navigate(`/exam/${exam.id}`)
  }

  return (
    <div className="daily-card">
      <div className="daily-head">
        <div className="daily-icon" aria-hidden>{subject.icon}</div>
        <div className="daily-name">{subject.label}</div>
        <StatusBadge lock={lock} exam={exam} />
      </div>

      {!exam && (
        <div className="placeholder">No exam scheduled</div>
      )}

      {exam && (
        <>
          {exam.title && (
            <p className="mb-2 truncate text-[11px] font-semibold theme-text-muted">{exam.title}</p>
          )}

          <div className="mb-3 flex flex-wrap gap-1.5 text-[10px] font-semibold">
            <span
              className="rounded px-1.5 py-0.5"
              style={{ background: 'color-mix(in srgb, var(--accent) 6%, var(--card))', color: 'var(--muted)' }}
            >
              {exam.durationMinutes || 30} min
            </span>
            <span
              className="rounded px-1.5 py-0.5"
              style={{ background: 'color-mix(in srgb, var(--accent) 6%, var(--card))', color: 'var(--muted)' }}
            >
              {exam.questionCount ?? '—'} Qs
            </span>
            <span
              className="rounded px-1.5 py-0.5"
              style={{ background: 'color-mix(in srgb, var(--accent) 6%, var(--card))', color: 'var(--muted)' }}
            >
              {exam.totalMarks ?? '—'} marks
            </span>
          </div>

          {isCompleted && lock && (
            <div className="mb-3 flex items-center gap-2 rounded-[var(--r-md)] border border-green-200 bg-green-50 px-2.5 py-1.5">
              <span className="text-base">🏆</span>
              <div className="leading-none">
                <p className={`text-sm font-black ${pctColor(lock.percentage ?? 0)}`}>
                  {lock.percentage ?? '—'}%
                </p>
                <p className="mt-0.5 text-[10px] font-bold text-green-700">
                  {lock.score ?? '—'}/{lock.totalMarks ?? '—'} marks
                </p>
              </div>
            </div>
          )}

          {isCompleted ? (
            <button
              type="button"
              onClick={handleCTA}
              className="w-full rounded-[var(--r-md)] border border-[var(--line-medium)] bg-[var(--surface)] py-1.5 text-[11px] font-bold theme-text shadow-[var(--shadow-tight)] transition-colors hover:bg-[var(--bg-subtle)]"
            >
              View results
            </button>
          ) : isInProgress ? (
            <button
              type="button"
              onClick={handleCTA}
              className="w-full rounded-[var(--r-md)] bg-amber-400 py-1.5 text-[11px] font-black text-slate-900 shadow-[var(--shadow-tight)] transition-colors hover:bg-amber-500"
            >
              Resume exam
            </button>
          ) : isAvailable ? (
            <button
              type="button"
              onClick={handleCTA}
              className="theme-accent-fill theme-on-accent w-full rounded-[var(--r-md)] py-1.5 text-[11px] font-black shadow-[var(--shadow-tight)] transition-opacity hover:opacity-90"
            >
              Start exam
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}

export default function DailyExamsHub() {
  const { currentUser, userProfile } = useAuth()
  const grade = userProfile?.grade || '5'

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false

    async function load() {
      const rows = await Promise.all(
        SUBJECTS.map(async subject => {
          const [exam, lock] = await Promise.all([
            getTodaysExam(subject.label, grade),
            checkDailyLock(currentUser.uid, subject.label),
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
  const notScheduledCount = SUBJECTS.length - completedCount - availableCount

  return (
    <div className="theme-bg theme-text min-h-screen">
      <Navbar />

      <div className="mx-auto max-w-3xl px-4 pb-24 pt-6">
        <div className="daily-header">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3>
                <span aria-hidden className="text-[var(--amber)]">🏆</span>
                Daily Exams
              </h3>
              <p>{today}</p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/exams/leaderboard"
                className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black text-amber-700 transition-colors hover:bg-amber-200"
              >
                Leaderboard
              </Link>
              <Link
                to="/dashboard"
                className="text-[11px] font-bold theme-accent-text hover:opacity-80"
              >
                ← Dashboard
              </Link>
            </div>
          </div>
        </div>

        {!loading && (
          <div className="stats-row stats-row-3">
            <div className="stat-compact">
              <p className="stat-num">{completedCount}</p>
              <p className="stat-label">Completed</p>
            </div>
            <div className="stat-compact">
              <p className="stat-num">{availableCount}</p>
              <p className="stat-label">Available</p>
            </div>
            <div className="stat-compact">
              <p className="stat-num">{notScheduledCount}</p>
              <p className="stat-label">Not scheduled</p>
            </div>
          </div>
        )}

        <div className="alert-strip">
          <span aria-hidden className="text-base leading-none">⚠️</span>
          <p>
            Each subject can be attempted <strong>once per day</strong>. The timer can&apos;t be paused — even if you refresh.
          </p>
        </div>

        {loading ? (
          <div className="daily-grid">
            {Array.from({ length: SUBJECTS.length }).map((_, i) => (
              <div key={i} className="daily-card animate-pulse" style={{ minHeight: 132 }} />
            ))}
          </div>
        ) : (
          <div className="daily-grid">
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
