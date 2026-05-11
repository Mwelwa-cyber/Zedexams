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
 *
 * Visual language matches the /games "Pick your quest" cards: white
 * sticker cards with a 2px navy border, hard 2px offset shadow, and
 * a pastel mascot tile per subject. Shared utilities live in index.css
 * (.zx-card-shared, .zx-sb, .zx-pill-*, .zx-eyebrow-shared).
 */

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { SUBJECTS } from '../../config/curriculum'
import { getTodaysExam, checkDailyLock } from '../../utils/examService'
import { getSubjectMascot } from '../games/gamesUi'
import Navbar from '../layout/Navbar'
import SeoHelmet from '../seo/SeoHelmet'

// Subject id → game-mascot slug (gamesUi.getSubjectMascot uses slugs
// like "social" / "arts" / "home", not the full curriculum IDs).
const SUBJECT_SLUG = {
  english: 'english',
  science: 'science',
  mathematics: 'mathematics',
  'social-studies': 'social',
  'expressive-arts': 'arts',
  technology: 'technology',
  cinyanja: 'cinyanja',
  'home-economics': 'home',
}

// Pastel mascot-tile background per subject (matches QuizList.jsx).
const SUBJECT_TILE_BG = {
  english: 'bg-blue-100',
  science: 'bg-green-100',
  mathematics: 'bg-orange-100',
  'social-studies': 'bg-yellow-100',
  'expressive-arts': 'bg-rose-100',
  technology: 'bg-cyan-100',
  cinyanja: 'bg-pink-100',
  'home-economics': 'bg-amber-100',
}

function pctColor(p) {
  if (p >= 70) return 'text-green-700'
  if (p >= 50) return 'text-yellow-700'
  return 'text-red-600'
}

function StatusBadge({ lock, exam }) {
  if (!exam)                       return <span className="zx-pill-dark zx-pill-light">None</span>
  if (!lock)                       return <span className="zx-pill-dark zx-pill-orange">Available</span>
  if (lock.status === 'submitted') return <span className="zx-pill-dark zx-pill-green">Completed</span>
  return                                   <span className="zx-pill-dark zx-pill-amber">In progress</span>
}

function SubjectExamCard({ subject, exam, lock }) {
  const navigate = useNavigate()

  const slug = SUBJECT_SLUG[subject.id] || subject.id
  const mascot = getSubjectMascot(slug)
  const tileBg = SUBJECT_TILE_BG[subject.id] || 'bg-amber-100'

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
    <div className="zx-card-shared p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-[18px] border-2 border-slate-900 text-[34px] leading-none sm:h-20 sm:w-20 sm:text-[42px] ${tileBg}`}>
          <span aria-hidden="true">{mascot.emoji}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display truncate text-[18px] font-bold leading-tight text-slate-900 sm:text-xl">
            {subject.label}
          </h3>
          <p className="mt-0.5 truncate text-[11.5px] font-semibold text-slate-500">{mascot.name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge lock={lock} exam={exam} />
            {exam && (
              <>
                <span className="zx-pill-dark zx-pill-light">{exam.durationMinutes || 30} min</span>
                <span className="zx-pill-dark zx-pill-light">{exam.questionCount ?? '—'} Qs</span>
              </>
            )}
          </div>
        </div>
      </div>

      {!exam && (
        <p className="mt-3 rounded-[16px] border-2 border-dashed border-slate-300 px-3 py-3 text-center text-[11.5px] font-bold text-slate-500">
          No exam scheduled today
        </p>
      )}

      {exam && isCompleted && lock && (
        <div className="mt-3 flex items-center gap-2 rounded-[14px] border-2 border-emerald-700 bg-emerald-50 px-3 py-2">
          <span className="text-lg">🏆</span>
          <p className={`text-sm font-black ${pctColor(lock.percentage ?? 0)}`}>
            {lock.percentage ?? '—'}%{' '}
            <span className="ml-1 text-[11px] font-bold text-emerald-700">
              ({lock.score ?? '—'}/{lock.totalMarks ?? '—'})
            </span>
          </p>
        </div>
      )}

      {exam && (
        <div className="mt-3">
          {isCompleted ? (
            <button type="button" onClick={handleCTA} className="zx-sb zx-sb-secondary w-full text-[12px]">
              View results →
            </button>
          ) : isInProgress ? (
            <button type="button" onClick={handleCTA} className="zx-sb zx-sb-amber w-full text-[12px]">
              Resume exam
            </button>
          ) : isAvailable ? (
            <button type="button" onClick={handleCTA} className="zx-sb zx-sb-primary w-full text-[12px]">
              Start exam →
            </button>
          ) : null}
        </div>
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
      <SeoHelmet title="Daily exams" path="/exams" noIndex />
      <Navbar />

      <div className="mx-auto max-w-3xl px-4 pb-24 pt-6">
        <div className="zx-card-shared mb-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="zx-eyebrow-shared">Daily Exams</span>
              <h3 className="mt-1 flex items-center gap-2 text-[22px] font-extrabold tracking-tight text-slate-900">
                <span aria-hidden>🏆</span>
                Today&apos;s exams
              </h3>
              <p className="mt-0.5 text-[12px] font-semibold text-slate-500">{today}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link to="/exams/leaderboard" className="zx-pill-dark zx-pill-amber">
                Leaderboard
              </Link>
              <Link to="/dashboard" className="text-[11px] font-bold text-slate-700 hover:text-slate-900">
                ← Dashboard
              </Link>
            </div>
          </div>
        </div>

        {!loading && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="zx-card-shared px-3 py-2 text-center">
              <p className="text-lg font-extrabold text-slate-900">{completedCount}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Completed</p>
            </div>
            <div className="zx-card-shared px-3 py-2 text-center">
              <p className="text-lg font-extrabold text-slate-900">{availableCount}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Available</p>
            </div>
            <div className="zx-card-shared px-3 py-2 text-center">
              <p className="text-lg font-extrabold text-slate-900">{notScheduledCount}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Not scheduled</p>
            </div>
          </div>
        )}

        <div className="zx-card-shared mb-4 flex items-start gap-2 bg-amber-50 p-3">
          <span aria-hidden className="text-base leading-none">⚠️</span>
          <p className="text-[11.5px] font-bold leading-snug text-slate-700">
            Each subject can be attempted <strong>once per day</strong>. The timer can&apos;t be paused — even if you refresh.
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: SUBJECTS.length }).map((_, i) => (
              <div key={i} className="zx-card-shared animate-pulse" style={{ minHeight: 132 }} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
