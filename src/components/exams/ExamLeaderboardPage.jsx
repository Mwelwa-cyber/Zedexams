/**
 * ExamLeaderboardPage — /exams/leaderboard
 *
 * Live daily exam leaderboard with real-time updates.
 * Filters: subject · grade · date
 * Ranking: percentage DESC → score DESC → submittedAt ASC
 */

import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { SUBJECTS, GRADES } from '../../config/curriculum'
import { subscribeToDailyLeaderboard, fmtDuration, fmtDate } from '../../utils/examLeaderboardService'
import { todayString } from '../../utils/examService'
import Navbar from '../layout/Navbar'

// ── sub-components ────────────────────────────────────────────────────────────

function RankBadge({ rank }) {
  if (rank === 1) return <span className="text-2xl">🥇</span>
  if (rank === 2) return <span className="text-2xl">🥈</span>
  if (rank === 3) return <span className="text-2xl">🥉</span>
  return <span className="w-8 text-center text-sm font-black theme-text-muted">#{rank}</span>
}

function PctBar({ pct }) {
  const w = Math.min(100, Math.max(0, pct))
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-400'
  return (
    <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
      <div className={`h-1.5 rounded-full ${color} transition-all duration-500`} style={{ width: `${w}%` }} />
    </div>
  )
}

function LeaderboardRow({ entry, isMe }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-all ${
      isMe
        ? 'bg-amber-50 border-2 border-amber-300 shadow-sm'
        : 'theme-card border theme-border hover:shadow-sm'
    }`}>
      {/* Rank */}
      <div className="w-9 flex-shrink-0 flex items-center justify-center">
        <RankBadge rank={entry.rank} />
      </div>

      {/* Name + bar */}
      <div className="flex-1 min-w-0">
        <p className={`font-black text-sm truncate ${isMe ? 'text-amber-800' : 'theme-text'}`}>
          {entry.displayName}{isMe ? ' 👈 You' : ''}
        </p>
        {entry.subject && (
          <p className="text-xs font-bold theme-text-muted truncate">
            {entry.subject} · Grade {entry.grade}
          </p>
        )}
        <PctBar pct={entry.percentage} />
      </div>

      {/* Stats */}
      <div className="flex-shrink-0 text-right">
        <p className={`text-lg font-black ${
          entry.percentage >= 80 ? 'text-green-600' :
          entry.percentage >= 60 ? 'text-yellow-600' : 'text-red-500'
        }`}>{entry.percentage}%</p>
        <p className="text-xs font-bold theme-text-muted">
          {entry.score}/{entry.totalMarks} · {fmtDuration(entry.timeTakenSeconds)}
        </p>
      </div>
    </div>
  )
}

function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
      </span>
      <span className="text-xs font-black text-red-600">LIVE</span>
    </span>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function ExamLeaderboardPage() {
  const { currentUser } = useAuth()

  const today = todayString()
  const [subject,  setSubject]  = useState('')          // '' = all subjects
  const [grade,    setGrade]    = useState('')           // '' = all grades
  const [date,     setDate]     = useState(today)

  const [rows,     setRows]     = useState([])
  const [error,    setError]    = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [lastTick, setLastTick] = useState(null)        // timestamp of last update

  // ── real-time subscription ─────────────────────────────────────────────
  const unsubRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    setError(null)

    // tear down previous listener
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }

    unsubRef.current = subscribeToDailyLeaderboard(
      { subject: subject || undefined, grade: grade || undefined, date },
      (newRows, err) => {
        setRows(newRows)
        setError(err)
        setLoading(false)
        setLastTick(new Date())
      },
    )

    return () => { if (unsubRef.current) { unsubRef.current(); unsubRef.current = null } }
  }, [subject, grade, date])

  const myEntry = rows.find(r => r.userId === currentUser?.uid)

  // ── stats strip ────────────────────────────────────────────────────────
  const topPct   = rows[0]?.percentage ?? null
  const avgPct   = rows.length ? Math.round(rows.reduce((s, r) => s + r.percentage, 0) / rows.length) : null

  const isToday  = date === today
  const dateLabel = isToday ? 'Today' : fmtDate(date)

  return (
    <div className="min-h-screen theme-bg theme-text">
      <Navbar />

      <div className="mx-auto max-w-3xl px-4 py-6 pb-28 space-y-5">

        {/* ── header ──────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black theme-text flex items-center gap-2">
              🏆 Daily Leaderboard
            </h1>
            <p className="theme-text-muted text-sm mt-0.5 flex items-center gap-2">
              {dateLabel}
              {isToday && <LiveDot />}
            </p>
          </div>
          <Link to="/exams" className="text-xs font-bold theme-accent-text hover:opacity-80">
            ← Daily Exams
          </Link>
        </div>

        {/* ── filters ─────────────────────────────────────────── */}
        <div className="theme-card rounded-2xl border theme-border p-4 space-y-3">
          <p className="text-xs font-black uppercase tracking-wide theme-text-muted">Filters</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

            {/* Subject */}
            <div>
              <label className="block text-xs font-bold theme-text-muted mb-1">Subject</label>
              <select
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="theme-input w-full rounded-xl border-2 px-3 py-2 text-sm outline-none"
              >
                <option value="">All subjects</option>
                {SUBJECTS.map(s => (
                  <option key={s.id} value={s.label}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Grade */}
            <div>
              <label className="block text-xs font-bold theme-text-muted mb-1">Grade</label>
              <select
                value={grade}
                onChange={e => setGrade(e.target.value)}
                className="theme-input w-full rounded-xl border-2 px-3 py-2 text-sm outline-none"
              >
                <option value="">All grades</option>
                {GRADES.map(g => (
                  <option key={g} value={String(g)}>Grade {g}</option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-bold theme-text-muted mb-1">Date</label>
              <input
                type="date"
                value={date}
                max={today}
                onChange={e => setDate(e.target.value || today)}
                className="theme-input w-full rounded-xl border-2 px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>
        </div>

        {/* ── stats strip ─────────────────────────────────────── */}
        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="theme-card rounded-2xl border theme-border p-3 text-center">
              <p className="text-xl font-black theme-text">{rows.length}</p>
              <p className="theme-text-muted text-xs font-bold">Participants</p>
            </div>
            <div className="theme-card rounded-2xl border theme-border p-3 text-center">
              <p className="text-xl font-black text-green-600">{topPct}%</p>
              <p className="theme-text-muted text-xs font-bold">Top Score</p>
            </div>
            <div className="theme-card rounded-2xl border theme-border p-3 text-center">
              <p className="text-xl font-black theme-text">{avgPct}%</p>
              <p className="theme-text-muted text-xs font-bold">Average</p>
            </div>
          </div>
        )}

        {/* ── my rank callout ──────────────────────────────────── */}
        {myEntry && (
          <div className="flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
            <span className="text-2xl">⭐</span>
            <div>
              <p className="font-black text-amber-800 text-sm">
                You are ranked #{myEntry.rank} — {myEntry.percentage}%
              </p>
              <p className="text-amber-700 text-xs font-bold mt-0.5">
                {myEntry.score}/{myEntry.totalMarks} marks · {fmtDuration(myEntry.timeTakenSeconds)}
              </p>
            </div>
          </div>
        )}

        {/* ── leaderboard rows ─────────────────────────────────── */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="theme-card rounded-2xl border theme-border p-4 animate-pulse h-16" />
            ))}
          </div>
        ) : error ? (
          <div className="theme-card rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-3xl mb-2">⚠️</p>
            <p className="font-black text-red-700 text-sm">Could not load leaderboard</p>
            <p className="text-red-600 text-xs mt-1">{error}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="theme-card rounded-2xl border theme-border p-10 text-center">
            <p className="text-4xl mb-3">🔭</p>
            <p className="font-black theme-text text-base">No results yet</p>
            <p className="theme-text-muted text-sm mt-1">
              {isToday
                ? 'Be the first to complete a daily exam today!'
                : 'No exams were completed on this date with the selected filters.'}
            </p>
            {isToday && (
              <Link
                to="/exams"
                className="theme-accent-fill theme-on-accent mt-4 inline-block rounded-2xl px-5 py-2.5 text-sm font-black hover:opacity-90"
              >
                Start an Exam →
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(entry => (
              <LeaderboardRow
                key={entry.attemptId}
                entry={entry}
                isMe={entry.userId === currentUser?.uid}
              />
            ))}
          </div>
        )}

        {/* ── last updated ─────────────────────────────────────── */}
        {lastTick && !loading && (
          <p className="text-center text-xs theme-text-muted">
            Last updated {lastTick.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            {isToday && ' · Updates automatically'}
          </p>
        )}

      </div>
    </div>
  )
}
