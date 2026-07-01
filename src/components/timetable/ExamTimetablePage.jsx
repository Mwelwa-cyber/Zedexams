/**
 * ExamTimetablePage — /timetable
 *
 * Interactive, mobile-first exam hub that replaced the inline ECZ PDF viewer
 * (the PDF stayed A4-sized on phones and forced constant pinch-zooming; it is
 * still reachable at /timetable/pdf and via the buttons below the hero).
 *
 * The page adapts to the season, all computed from a ticking clock + the
 * pure helpers in utils/examTimetableLogic.js:
 *   BEFORE the exams  → big countdown, exam progress, next exam
 *   DURING the season → "Today's Examination" with live time remaining,
 *                       then the next session; evenings show the next day;
 *                       a floating banner keeps today's exam visible once
 *                       the hero scrolls away
 *   AFTER the season  → congratulations + revision resource links
 *
 * Two clocks drive the rendering: `nowMs` ticks every second for the hero
 * and banner (they display seconds), while the day list, statuses, and
 * reminders take the minute-floored `nowMinuteMs` — session boundaries sit
 * on whole minutes, so the (memoized) card list re-renders once a minute
 * instead of every second.
 *
 * Days are collapsible: today + the next exam day start open (see
 * getDefaultExpandedDates), everything else collapses to a header row and
 * mounts its cards only when tapped. A subject search temporarily expands
 * whatever matches.
 *
 * Data comes from Firestore (examTimetables, per grade+year) through
 * useExamTimetables, with the bundled 2026 PSLE timetable as fallback, so
 * future years are a seed-script run — no app release. Older years render
 * under "Past Exam Timetables" with every session marked Archived.
 *
 * Reminders are v1 in-app only: a master switch + offset preferences and
 * dismissals live in localStorage (per uid + timetable) and surface as
 * banners here — no Cloud Functions, no FCM (candidates for a later
 * iteration).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import useExamTimetables from '../../hooks/useExamTimetables'
import { isNativePlatform } from '../../utils/runtime'
import Navbar from '../layout/Navbar'
import SeoHelmet from '../seo/SeoHelmet'
import Skeleton from '../ui/Skeleton'
import { ExamDayGroup } from './ExamSessionCard'
import {
  PHASE,
  STATUS,
  getSeasonPhase,
  getSessionStatus,
  getCurrentSession,
  getNextSession,
  getNextPaperSession,
  getDefaultExpandedDates,
  listSessions,
  computeProgress,
  filterTimetable,
  formatSessionTime,
  formatDayHeading,
  countdownParts,
  hms,
  sessionLabel,
  REMINDER_OFFSETS,
  remindersEnabled,
  reminderStorageKey,
  getDueReminders,
} from '../../utils/examTimetableLogic'

// localStorage guards, same idiom as PastPapersHub: never let a blocked or
// full storage (Safari private mode) break the page.
function readStored(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* best-effort */
  }
}

// One padded unit of the big countdown (value + label), sticker-styled to
// match the rest of the page (the dashboard card keeps its own rose look).
function CountdownUnit({ value, label }) {
  return (
    <div className="flex min-w-[3.25rem] flex-col items-center rounded-[14px] border-2 border-slate-900 bg-white px-2 py-1.5">
      <span className="text-xl font-black tabular-nums leading-none text-slate-900 sm:text-2xl">
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</span>
    </div>
  )
}

function ProgressBar({ progress }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-500">
          Exam Progress
        </span>
        <span className="text-[11px] font-bold tabular-nums text-slate-600">{progress.pct}%</span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full border-2 border-slate-900 bg-white">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] font-bold text-slate-600">
        {progress.completed} / {progress.total} Papers Completed
      </p>
    </div>
  )
}

// "Next Exam" mini-panel used in the BEFORE and DURING heroes.
function NextExamPanel({ session, heading = 'Next Exam' }) {
  if (!session) return null
  return (
    <div className="rounded-[16px] border-2 border-slate-900 bg-amber-50 px-3 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{heading}</p>
      <p className="mt-0.5 text-[15px] font-extrabold leading-tight text-slate-900">
        {sessionLabel(session)}
      </p>
      <p className="text-[12px] font-bold text-slate-600">
        {formatDayHeading(session.start.slice(0, 10))} · {formatSessionTime(session)}
      </p>
    </div>
  )
}

// Resource links shown once the whole season is over — the page must never
// go empty after the last paper.
const SEASON_OVER_LINKS = (grade) => [
  { label: '📄 Past Papers', to: `/papers?grade=${grade}` },
  { label: '📒 Revision Notes', to: '/notes' },
  { label: '🧠 Practice Quizzes', to: '/quizzes' },
  { label: '🏆 Mock Examinations', to: '/exams' },
  { label: `🌉 Grade ${grade + 1} Bridge Lessons`, to: '/lessons' },
]

function SeasonOverBanner({ timetable }) {
  return (
    <div className="zx-card-shared bg-emerald-50 p-4 sm:p-6">
      <span className="zx-eyebrow-shared">
        {timetable.shortName} · {timetable.board}
      </span>
      <h2 className="font-display mt-1 text-xl font-extrabold text-slate-900 sm:text-2xl">
        🎉 {timetable.year} {timetable.examName} Completed
      </h2>
      <p className="mt-1 text-[13px] font-semibold text-slate-600">
        Congratulations to all Grade {timetable.grade} learners — you made it! Keep the momentum
        going while you wait for your results:
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SEASON_OVER_LINKS(timetable.grade).map((l) => (
          <Link key={l.label} to={l.to} className="zx-sb zx-sb-secondary w-full text-[12px]">
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

function TimetableHero({ timetable, nowMs }) {
  const phase = getSeasonPhase(timetable, nowMs)
  const progress = computeProgress(timetable, nowMs)

  if (phase === PHASE.AFTER) return <SeasonOverBanner timetable={timetable} />

  // First paper session that hasn't started — the briefing day is shown in
  // the card list but is not "the next exam".
  const nextExam = getNextPaperSession(timetable, nowMs)

  if (phase === PHASE.BEFORE) {
    const parts = countdownParts(Date.parse(timetable.startsAt), nowMs)
    return (
      <div className="zx-card-shared p-4 sm:p-6">
        <span className="zx-eyebrow-shared">
          Grade {timetable.grade} · {timetable.board} {timetable.year}
        </span>
        <h2 className="font-display mt-1 text-xl font-extrabold leading-tight text-slate-900 sm:text-2xl">
          {timetable.examName}
        </h2>
        <p className="mt-2 text-[11px] font-black uppercase tracking-wider text-slate-500">
          Starts in
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <CountdownUnit value={parts.days} label="Days" />
          <CountdownUnit value={parts.hours} label="Hours" />
          <CountdownUnit value={parts.minutes} label="Min" />
          <CountdownUnit value={parts.seconds} label="Sec" />
        </div>
        <div className="mt-4 space-y-3">
          <ProgressBar progress={progress} />
          <NextExamPanel session={nextExam} />
        </div>
      </div>
    )
  }

  // DURING: a paper is running, or we're between sessions / on an evening.
  const current = getCurrentSession(timetable, nowMs)
  const next = getNextSession(timetable, nowMs)
  const nextIsToday = next && getSessionStatus(next, nowMs) === STATUS.TODAY
  // When the hero already features a session (running, or starting later
  // today), the "Next Examination" panel shows the paper session after it;
  // otherwise it shows the next paper session outright.
  const featured = current || (nextIsToday ? next : null)
  const nextExamPanelSession = featured
    ? listSessions(timetable).find(
        (s) => (s.papers || []).length > 0 && Date.parse(s.start) > Date.parse(featured.start),
      )
    : nextExam

  return (
    <div className="zx-card-shared p-4 sm:p-6">
      <span className="zx-eyebrow-shared">
        Grade {timetable.grade} · {timetable.board} {timetable.year}
      </span>
      {current ? (
        <>
          <h2 className="font-display mt-1 text-xl font-extrabold leading-tight text-slate-900 sm:text-2xl">
            {current.briefing ? "Today's Briefing" : "Today's Examination"}
          </h2>
          <p className="mt-1 text-lg font-extrabold text-slate-900">{sessionLabel(current)}</p>
          <p className="text-[12.5px] font-bold text-slate-600">
            Started at {current.start.slice(11, 16)} · Ends at {current.end.slice(11, 16)}
          </p>
          <p className="mt-3 text-[11px] font-black uppercase tracking-wider text-slate-500">
            Time remaining
          </p>
          <p className="mt-0.5 text-3xl font-black tabular-nums text-orange-600 sm:text-4xl">
            {hms(Date.parse(current.end) - nowMs)}
          </p>
        </>
      ) : nextIsToday ? (
        <>
          <h2 className="font-display mt-1 text-xl font-extrabold leading-tight text-slate-900 sm:text-2xl">
            {next.briefing ? 'Today' : "Today's Examination"}
          </h2>
          <p className="mt-1 text-lg font-extrabold text-slate-900">{sessionLabel(next)}</p>
          <p className="text-[12.5px] font-bold text-slate-600">
            Starts at {next.start.slice(11, 16)} · Ends at {next.end.slice(11, 16)}
          </p>
          <p className="mt-3 text-[11px] font-black uppercase tracking-wider text-slate-500">
            Starts in
          </p>
          <p className="mt-0.5 text-3xl font-black tabular-nums text-slate-900 sm:text-4xl">
            {hms(Date.parse(next.start) - nowMs)}
          </p>
        </>
      ) : (
        <h2 className="font-display mt-1 text-xl font-extrabold leading-tight text-slate-900 sm:text-2xl">
          Done for today — well done! 💪
        </h2>
      )}
      <div className="mt-4 space-y-3">
        <ProgressBar progress={progress} />
        <NextExamPanel session={nextExamPanelSession} heading="Next Examination" />
      </div>
    </div>
  )
}

/**
 * Floating banner that keeps today's exam in view once the hero scrolls
 * away: the session running now, or the next one starting today. Derived
 * from the ticking clock, so it vanishes on its own when the last session
 * of the day ends. Fixed below the navbar; pointer events pass through the
 * gutter so only the pill itself is tappable.
 */
function TodayExamBanner({ timetable, nowMs, onView }) {
  const current = getCurrentSession(timetable, nowMs)
  const next = getNextSession(timetable, nowMs)
  const featured =
    current || (next && getSessionStatus(next, nowMs) === STATUS.TODAY ? next : null)
  if (!featured) return null
  const running = Boolean(current)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-30 px-4">
      <div className="animate-slide-in-soft pointer-events-auto mx-auto flex max-w-3xl items-center gap-2.5 rounded-[16px] border-2 border-slate-900 bg-emerald-50 px-3 py-2 shadow-[0_2px_0_#0F1B2D]">
        <span aria-hidden="true" className="text-lg leading-none">
          {featured.briefing ? '📋' : '✏️'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[9.5px] font-black uppercase tracking-widest text-emerald-700">
            {running ? 'In progress' : "Today's Exam"}
          </p>
          <p className="truncate text-[13px] font-extrabold leading-tight text-slate-900">
            {sessionLabel(featured)}
            <span className="ml-1.5 font-bold text-slate-600">{formatSessionTime(featured)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onView}
          className="zx-sb zx-sb-primary shrink-0 px-3 py-1.5 text-[11px]"
        >
          View →
        </button>
      </div>
    </div>
  )
}

function ReminderBar({ reminders, onDismiss }) {
  if (reminders.length === 0) return null
  return (
    <div className="space-y-2">
      {reminders.map((r) => (
        <div key={r.key} className="zx-card-shared flex items-start gap-2 bg-amber-50 p-3">
          <span aria-hidden="true" className="text-base leading-none">
            ⏰
          </span>
          <p className="min-w-0 flex-1 text-[12px] font-bold leading-snug text-slate-700">
            <span className="text-slate-900">{sessionLabel(r.session)}</span> —{' '}
            {formatDayHeading(r.session.start.slice(0, 10))}, {formatSessionTime(r.session)}
            <span className="ml-1 text-[10.5px] font-black uppercase tracking-wide text-amber-700">
              ({r.offsetLabel})
            </span>
          </p>
          <button
            type="button"
            onClick={() => onDismiss(r.key)}
            aria-label="Dismiss reminder"
            className="shrink-0 rounded-full px-1.5 text-sm font-black text-slate-500 hover:text-slate-900"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * One master switch; the offset pills only exist while it's on. Turning it
 * off hides the choices but keeps them stored, so toggling back restores
 * the learner's picks.
 */
function ReminderSettings({ prefs, onToggleEnabled, onToggleOffset }) {
  const enabled = remindersEnabled(prefs)
  const selected = new Set(prefs?.offsets || [])
  return (
    <div className="zx-card-shared p-3">
      <button
        type="button"
        onClick={onToggleEnabled}
        role="switch"
        aria-checked={enabled}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1 text-[12.5px] font-extrabold text-slate-900">
          🔔 Enable Exam Reminders
        </span>
        <span
          aria-hidden="true"
          className={`relative h-6 w-11 shrink-0 rounded-full border-2 border-slate-900 transition-colors ${
            enabled ? 'bg-emerald-500' : 'bg-white'
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full border-2 border-slate-900 bg-white transition-transform ${
              enabled ? 'translate-x-[1.4rem]' : 'translate-x-0.5'
            }`}
          />
        </span>
      </button>
      {enabled && (
        <div className="animate-fade-in">
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {REMINDER_OFFSETS.map((o) => {
              const on = selected.has(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggleOffset(o.id)}
                  className={`zx-pill-dark transition-colors ${on ? 'zx-pill-orange' : 'zx-pill-light'}`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[10.5px] font-semibold text-slate-500">
            Reminders show here in the app when you open it within the window.
          </p>
        </div>
      )}
    </div>
  )
}

function PdfButtons({ pdfUrl }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link to="/timetable/pdf" className="zx-sb zx-sb-secondary text-[12px]">
        📄 View Official ECZ Timetable (PDF)
      </Link>
      {/* Android WebView can't run a browser download; the in-app viewer at
          /timetable/pdf covers reading it there. */}
      {!isNativePlatform() && pdfUrl && (
        <a href={pdfUrl} download className="zx-sb zx-sb-secondary text-[12px]">
          ⬇️ Download Official PDF
        </a>
      )}
    </div>
  )
}

function PastTimetablesSection({ archived, nowMs }) {
  const [openId, setOpenId] = useState(null)
  if (archived.length === 0) return null
  return (
    <section>
      <h2 className="font-display mb-2 text-[15px] font-extrabold text-slate-900 sm:text-base">
        Past Exam Timetables
      </h2>
      <div className="space-y-3">
        {archived.map((t) => {
          const open = openId === t.id
          return (
            <div key={t.id}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : t.id)}
                aria-expanded={open}
                className="zx-card-shared is-pressable flex w-full items-center gap-2 p-3 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold text-slate-900">
                  {t.year} {t.examName}
                </span>
                <span className="zx-pill-dark">Archived</span>
                <span aria-hidden="true" className="text-slate-500">
                  {open ? '▴' : '▾'}
                </span>
              </button>
              {open && (
                <div className="animate-slide-in-soft mt-3 space-y-3 pl-1">
                  {t.days.map((day, i) => (
                    <ExamDayGroup
                      key={day.date}
                      day={day}
                      dayNumber={i + 1}
                      grade={t.grade}
                      timetableId={t.id}
                      nowMs={nowMs}
                      archived
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton height={190} className="!rounded-[22px]" />
      <Skeleton height={46} className="!rounded-[16px]" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={124} className="!rounded-[22px]" />
      ))}
    </div>
  )
}

export default function ExamTimetablePage() {
  const { currentUser, userProfile } = useAuth()
  // Grade-agnostic page; learners without a grade set (who also see the
  // dashboard card) get the Grade-7 PSLE timetable, matching the card's gate.
  const grade = parseInt(userProfile?.grade, 10) || 7
  const { active, archived, loading } = useExamTimetables(grade)

  // The 1 s clock drives the hero + floating banner (they display seconds).
  // Everything below the hero — statuses, day groups, reminders — takes the
  // minute-floored clock instead: session boundaries sit on whole minutes,
  // so the card list only re-renders when something can actually change.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const nowMinuteMs = nowMs - (nowMs % 60000)

  const [search, setSearch] = useState('')
  const isSearching = search.trim().length > 0

  // Collapsible days: today + the next exam day start open, the rest start
  // collapsed. A learner's taps override the defaults until the page reloads
  // or the timetable changes; an active search expands every match.
  // The Set is memoized on its CONTENTS (the joined key), not on nowMinuteMs
  // — the dates only actually change once or twice a day, so its identity
  // (and toggleDay's, and therefore the memoized day groups) stays stable
  // across the minute ticks in between.
  const defaultOpenKey = active
    ? [...getDefaultExpandedDates(active, nowMinuteMs)].sort().join(',')
    : ''
  const defaultOpenDates = useMemo(
    () => new Set(defaultOpenKey ? defaultOpenKey.split(',') : []),
    [defaultOpenKey],
  )
  const [dayOverrides, setDayOverrides] = useState({})
  useEffect(() => setDayOverrides({}), [active?.id])
  // No-op while a search forces every match open — a toggle stored then
  // would only take effect after the search cleared, which reads as a day
  // randomly collapsing on its own.
  const toggleDay = useCallback(
    (date) => {
      if (isSearching) return
      setDayOverrides((prev) => ({
        ...prev,
        [date]: !(prev[date] ?? defaultOpenDates.has(date)),
      }))
    },
    [defaultOpenDates, isSearching],
  )

  // Floating today-banner: only while the hero (which carries the same
  // information, bigger) is scrolled out of view during the exam season.
  const heroRef = useRef(null)
  const [heroVisible, setHeroVisible] = useState(true)
  useEffect(() => {
    const el = heroRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(([entry]) => setHeroVisible(entry.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [loading, active?.id])
  const scrollToHero = useCallback(
    () => heroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    [],
  )

  // Reminder prefs live in localStorage per learner + timetable.
  const prefsKey = active ? reminderStorageKey(currentUser?.uid, active.id) : null
  const [prefs, setPrefs] = useState(null)
  useEffect(() => {
    if (prefsKey) setPrefs(readStored(prefsKey) || { enabled: false, offsets: [], dismissed: {} })
  }, [prefsKey])
  const updatePrefs = (updater) => {
    setPrefs((prev) => {
      const next = updater(prev || { enabled: false, offsets: [], dismissed: {} })
      if (prefsKey) writeStored(prefsKey, next)
      return next
    })
  }
  // First enable pre-selects "1 day before" so the switch does something
  // useful immediately; the learner can still untick it.
  const toggleEnabled = () =>
    updatePrefs((p) => {
      const enabled = !remindersEnabled(p)
      const offsets = enabled && (p.offsets || []).length === 0 ? ['1d'] : p.offsets
      return { ...p, enabled, offsets }
    })
  const toggleOffset = (id) =>
    updatePrefs((p) => ({
      ...p,
      offsets: p.offsets.includes(id) ? p.offsets.filter((o) => o !== id) : [...p.offsets, id],
    }))
  const dismissReminder = (key) =>
    updatePrefs((p) => ({ ...p, dismissed: { ...p.dismissed, [key]: true } }))

  const dueReminders = useMemo(
    () => (active && prefs ? getDueReminders(active, prefs, nowMinuteMs) : []),
    [active, prefs, nowMinuteMs],
  )

  const filtered = useMemo(() => (active ? filterTimetable(active, search) : null), [active, search])
  // "Day N" numbers come from the unfiltered timetable so search results
  // keep their real position in the week.
  const dayNumbers = useMemo(
    () => new Map((active?.days || []).map((d, i) => [d.date, i + 1])),
    [active],
  )
  const nextPaperKey = useMemo(
    () => (active ? getNextPaperSession(active, nowMinuteMs)?.key || null : null),
    [active, nowMinuteMs],
  )

  const phase = active ? getSeasonPhase(active, nowMs) : null

  return (
    <div className="theme-bg theme-text min-h-screen">
      <SeoHelmet title="Exam Timetable" path="/timetable" noIndex />
      <Navbar />

      {active && phase === PHASE.DURING && !heroVisible && (
        <TodayExamBanner timetable={active} nowMs={nowMs} onView={scrollToHero} />
      )}

      <div className="mx-auto max-w-3xl px-4 pb-24 pt-5">
        <div className="zx-card-shared mb-3 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="zx-eyebrow-shared">Exam Timetable</span>
              <h1 className="font-display mt-0.5 flex items-center gap-2 text-[21px] font-extrabold tracking-tight text-slate-900">
                <span aria-hidden="true">🗓️</span>
                {active ? `${active.shortName} Exam Timetable` : 'Exam Timetable'}
              </h1>
              {active && (
                <p className="text-[12px] font-semibold text-slate-500">
                  Grade {active.grade} · {active.board} {active.year}
                </p>
              )}
            </div>
            <Link
              to="/dashboard"
              className="shrink-0 text-[11px] font-bold text-slate-700 hover:text-slate-900"
            >
              ← Dashboard
            </Link>
          </div>
        </div>

        {loading ? (
          <PageSkeleton />
        ) : !active ? (
          <div className="zx-card-shared p-5 text-center">
            <p className="text-[14px] font-extrabold text-slate-900">
              No exam timetable is available for Grade {grade} yet.
            </p>
            <p className="mt-1 text-[12px] font-semibold text-slate-500">
              Check back soon — timetables appear here as soon as ECZ publishes them.
            </p>
            <Link to="/dashboard" className="zx-sb zx-sb-secondary mt-3 inline-block text-[12px]">
              ← Back to dashboard
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div ref={heroRef}>
              <TimetableHero timetable={active} nowMs={nowMs} />
            </div>

            <ReminderBar reminders={dueReminders} onDismiss={dismissReminder} />
            {phase !== PHASE.AFTER && (
              <ReminderSettings
                prefs={prefs}
                onToggleEnabled={toggleEnabled}
                onToggleOffset={toggleOffset}
              />
            )}

            <PdfButtons pdfUrl={active.pdfUrl} />

            <div>
              <label htmlFor="timetable-search" className="sr-only">
                Search subjects
              </label>
              <input
                id="timetable-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 Search subjects — English, Science, Mathematics…"
                className="w-full rounded-[16px] border-2 border-slate-900 bg-white px-4 py-2 text-[13px] font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>

            {filtered.days.length === 0 ? (
              <div className="zx-card-shared p-5 text-center">
                <p className="text-[13px] font-bold text-slate-600">
                  No exams match &ldquo;{search}&rdquo; — try a subject like English or Science.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filtered.days.map((day) => (
                  <ExamDayGroup
                    key={day.date}
                    day={day}
                    dayNumber={dayNumbers.get(day.date) || 0}
                    grade={active.grade}
                    timetableId={active.id}
                    nowMs={nowMinuteMs}
                    nextKey={nextPaperKey}
                    open={isSearching ? true : (dayOverrides[day.date] ?? defaultOpenDates.has(day.date))}
                    onToggle={toggleDay}
                  />
                ))}
              </div>
            )}

            <PastTimetablesSection archived={archived} nowMs={nowMinuteMs} />
          </div>
        )}
      </div>
    </div>
  )
}
