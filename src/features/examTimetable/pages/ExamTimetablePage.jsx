/**
 * ExamTimetablePage — /timetable
 *
 * A clean, mobile-first exam timeline for Grade-7 PSLE candidates. It replaced
 * the inline ECZ PDF viewer (which stayed A4-sized on phones); the PDF is still
 * reachable at /timetable/pdf and via the button below the hero.
 *
 * The page adapts to the season, all computed from a ticking clock + the pure
 * helpers in utils/examTimetableLogic.js:
 *   BEFORE the exams  → big countdown, exam progress, next exam
 *   DURING the season → "Today's Examination" with live time remaining, then
 *                       the next session; a floating banner keeps today's exam
 *                       visible once the summary scrolls away
 *   AFTER the season  → congratulations + revision resource links
 *
 * Two clocks drive the rendering: `nowMs` ticks every second for the summary
 * countdown + banner (they display seconds), while the day list, statuses, and
 * reminders take the minute-floored `nowMinuteMs` — session boundaries sit on
 * whole minutes, so the (memoized) day list re-renders once a minute instead
 * of every second. The navy hero is memoized on static data, so per-second
 * work is confined to the summary card.
 *
 * Days are collapsible on a vertical timeline: today + the next exam day start
 * open (getDefaultExpandedDates), everything else collapses to a header row +
 * one-line summary and mounts its cards only when tapped; the choice is
 * remembered for the session. A subject/date search temporarily expands
 * whatever matches.
 *
 * Data comes from Firestore (examTimetables, per grade+year) through
 * useExamTimetables, with the bundled 2026 PSLE timetable as fallback. Older
 * years render under "Past Exam Timetables" with every session marked Archived.
 *
 * Reminders are v1 in-app only: a master switch + offset preferences and
 * dismissals live in localStorage (per uid + timetable) and surface as banners
 * here — no Cloud Functions, no FCM.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import useExamTimetables from '../../../hooks/useExamTimetables'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { isNativePlatform } from '../../../utils/runtime'
import Navbar from '../../../components/layout/Navbar'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import Skeleton from '../../../components/ui/Skeleton'
import Icon from '../../../components/ui/Icon'
import {
  ArrowLeft,
  Bell,
  Calendar,
  ChevronRight,
  DocumentTextIcon,
  Download,
  Search,
} from '../../../components/ui/icons'
import { ExamDayGroup } from '../components/ExamSessionCard'
import { sessionVisual } from '../lib/subjectVisuals'
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
  filterTimetableByStatus,
  statusBucketCounts,
  formatSessionTime,
  formatDayHeading,
  countdownParts,
  hms,
  sessionLabel,
  REMINDER_OFFSETS,
  remindersEnabled,
  reminderStorageKey,
  getDueReminders,
} from '../../../utils/examTimetableLogic'

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

// ── Hero ───────────────────────────────────────────────────────────────────

const ExamHero = memo(function ExamHero({ timetable }) {
  return (
    <header className="ztt-hero p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="ztt-hero-eyebrow">Exam Timetable</span>
          <h1 className="mt-1 text-[20px] font-extrabold leading-tight sm:text-[23px]">
            {timetable.shortName} Exam Timetable
          </h1>
          <p className="mt-0.5 text-[12.5px] font-semibold text-white/70">
            Grade {timetable.grade} · {timetable.board} {timetable.year}
          </p>
        </div>
        <div className="ztt-hero-cal shrink-0">
          <Icon as={Calendar} size="sm" style={{ color: '#fff' }} strokeWidth={2} />
          <span className="mt-0.5 tabular-nums">{timetable.year}</span>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Link to="/dashboard" className="ztt-hero-btn">
          <Icon as={ArrowLeft} size="sm" strokeWidth={2.4} />
          Back to Dashboard
        </Link>
      </div>
    </header>
  )
})

// ── Summary building blocks ──────────────────────────────────────────────────

const COUNTDOWN_UNITS = [
  ['days', 'Days'],
  ['hours', 'Hrs'],
  ['minutes', 'Min'],
  ['seconds', 'Sec'],
]

// Compact countdown row (four padded units on one line). Fed pre-computed
// parts so it stays presentational.
function CountdownTimer({ parts }) {
  return (
    <div className="flex items-stretch gap-2">
      {COUNTDOWN_UNITS.map(([key, label]) => (
        <div key={key} className="ztt-count">
          <span className="text-[19px] font-extrabold tabular-nums leading-none theme-text sm:text-[22px]">
            {String(parts[key]).padStart(2, '0')}
          </span>
          <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider theme-text-muted">
            {label}
          </span>
        </div>
      ))}
    </div>
  )
}

function ExamProgress({ progress }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="ztt-eyebrow">Exam Progress</span>
        <span className="text-[12px] font-extrabold tabular-nums theme-text">{progress.pct}%</span>
      </div>
      <div className="ztt-progress-track mt-1.5">
        <div className="ztt-progress-fill" style={{ width: `${progress.pct}%` }} />
      </div>
      <p className="mt-1.5 text-[11.5px] font-semibold theme-text-muted">
        {progress.completed} / {progress.total} Papers Completed
      </p>
    </div>
  )
}

// "Next exam" highlight panel — tap to open + scroll to that day/subject.
function NextExamCard({ session, heading = 'Next Exam', onOpen }) {
  if (!session) return null
  const visual = sessionVisual(session)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${heading}: ${sessionLabel(session)} — open in timetable`}
      className="ztt-next"
    >
      <span
        className="ztt-tile"
        style={{ background: visual.tint.bg, width: 36, height: 36 }}
        aria-hidden="true"
      >
        <Icon as={visual.Icon} size="sm" style={{ color: visual.tint.fg }} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-orange-600">
          {heading}
        </span>
        <span className="block truncate text-[14.5px] font-extrabold leading-tight text-slate-900">
          {sessionLabel(session)}
        </span>
        <span className="block text-[11.5px] font-semibold text-slate-500">
          {formatDayHeading(session.start.slice(0, 10))} · {formatSessionTime(session)}
        </span>
      </span>
      <Icon as={ChevronRight} size="sm" className="shrink-0 text-orange-500" strokeWidth={2.4} />
    </button>
  )
}

/**
 * The one summary card: the exam name, a live countdown/time-remaining, the
 * progress bar, and the next-exam panel — its content follows the season
 * phase (BEFORE = countdown to the first paper; DURING = today's paper +
 * time remaining). AFTER is handled by SeasonOverBanner instead.
 */
function ExamSummary({ timetable, nowMs, onOpenDay }) {
  const phase = getSeasonPhase(timetable, nowMs)
  const progress = computeProgress(timetable, nowMs)
  const nextExam = getNextPaperSession(timetable, nowMs)

  let header
  let nextPanelSession = nextExam
  let nextPanelHeading = 'Next Exam'

  if (phase === PHASE.BEFORE) {
    const parts = countdownParts(Date.parse(timetable.startsAt), nowMs)
    header = (
      <>
        <p className="mt-2 ztt-eyebrow">Starts in</p>
        <div className="mt-1.5">
          <CountdownTimer parts={parts} />
        </div>
      </>
    )
  } else {
    // DURING: a paper is running, or we're between sessions / on an evening.
    const current = getCurrentSession(timetable, nowMs)
    const next = getNextSession(timetable, nowMs)
    const nextIsToday = next && getSessionStatus(next, nowMs) === STATUS.TODAY
    const featured = current || (nextIsToday ? next : null)
    nextPanelHeading = 'Next Examination'
    nextPanelSession = featured
      ? listSessions(timetable).find(
          (s) => (s.papers || []).length > 0 && Date.parse(s.start) > Date.parse(featured.start),
        )
      : nextExam

    if (current) {
      header = (
        <>
          <p className="mt-1 text-[16px] font-extrabold theme-text">
            {current.briefing ? "Today's Briefing" : "Today's Examination"}
          </p>
          <p className="mt-0.5 text-[13.5px] font-bold theme-text">{sessionLabel(current)}</p>
          <p className="text-[12px] font-semibold theme-text-muted">
            Started {current.start.slice(11, 16)} · Ends {current.end.slice(11, 16)}
          </p>
          <p className="mt-2.5 ztt-eyebrow">Time remaining</p>
          <p className="mt-0.5 text-3xl font-extrabold tabular-nums text-orange-600">
            {hms(Date.parse(current.end) - nowMs)}
          </p>
        </>
      )
    } else if (nextIsToday) {
      header = (
        <>
          <p className="mt-1 text-[16px] font-extrabold theme-text">
            {next.briefing ? 'Today' : "Today's Examination"}
          </p>
          <p className="mt-0.5 text-[13.5px] font-bold theme-text">{sessionLabel(next)}</p>
          <p className="text-[12px] font-semibold theme-text-muted">
            Starts {next.start.slice(11, 16)} · Ends {next.end.slice(11, 16)}
          </p>
          <p className="mt-2.5 ztt-eyebrow">Starts in</p>
          <p className="mt-0.5 text-3xl font-extrabold tabular-nums theme-text">
            {hms(Date.parse(next.start) - nowMs)}
          </p>
        </>
      )
    } else {
      header = <p className="mt-1 text-[16px] font-extrabold theme-text">Done for today — well done! 💪</p>
    }
  }

  return (
    <section className="ztt-card p-4 sm:p-5">
      <span className="ztt-eyebrow">
        Grade {timetable.grade} · {timetable.board} {timetable.year}
      </span>
      <h2 className="mt-0.5 text-[19px] font-extrabold leading-tight theme-text sm:text-[21px]">
        {timetable.examName}
      </h2>
      {header}
      <div className="mt-4 space-y-3">
        <ExamProgress progress={progress} />
        <NextExamCard
          session={nextPanelSession}
          heading={nextPanelHeading}
          onOpen={() => nextPanelSession && onOpenDay(nextPanelSession.start.slice(0, 10))}
        />
      </div>
    </section>
  )
}

// Resource links shown once the whole season is over — the page must never go
// empty after the last paper.
const SEASON_OVER_LINKS = (grade) => [
  { label: '📄 Past Papers', to: `/papers?grade=${grade}` },
  { label: '📒 Revision Notes', to: '/notes' },
  { label: '🧠 Practice Quizzes', to: '/quizzes' },
  { label: '🏆 Mock Examinations', to: '/exams' },
  { label: `🌉 Grade ${grade + 1} Bridge Lessons`, to: '/lessons' },
]

function SeasonOverBanner({ timetable }) {
  return (
    <section className="ztt-card bg-emerald-50/60 p-4 sm:p-5">
      <span className="ztt-eyebrow">
        {timetable.shortName} · {timetable.board}
      </span>
      <h2 className="mt-1 text-xl font-extrabold theme-text sm:text-2xl">
        🎉 {timetable.year} {timetable.examName} Completed
      </h2>
      <p className="mt-1 text-[13px] font-semibold theme-text-muted">
        Congratulations to all Grade {timetable.grade} learners — you made it! Keep the momentum
        going while you wait for your results:
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SEASON_OVER_LINKS(timetable.grade).map((l) => (
          <Link key={l.label} to={l.to} className="ztt-btn ztt-btn-block justify-start !px-4">
            {l.label}
          </Link>
        ))}
      </div>
    </section>
  )
}

/**
 * Floating banner that keeps today's exam in view once the summary scrolls
 * away: the session running now, or the next one starting today. Derived from
 * the ticking clock, so it vanishes on its own when the last session of the
 * day ends. Fixed below the navbar; pointer events pass through the gutter so
 * only the pill itself is tappable.
 */
function TodayExamBanner({ timetable, nowMs, onView }) {
  const current = getCurrentSession(timetable, nowMs)
  const next = getNextSession(timetable, nowMs)
  const featured =
    current || (next && getSessionStatus(next, nowMs) === STATUS.TODAY ? next : null)
  if (!featured) return null
  const running = Boolean(current)
  const visual = sessionVisual(featured)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-30 px-4">
      <div className="ztt-banner animate-slide-in-soft pointer-events-auto mx-auto flex max-w-3xl items-center gap-2.5 px-3 py-2">
        <span
          className="ztt-tile"
          style={{ background: visual.tint.bg, width: 34, height: 34 }}
          aria-hidden="true"
        >
          <Icon as={visual.Icon} size="sm" style={{ color: visual.tint.fg }} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[9.5px] font-bold uppercase tracking-widest text-emerald-700">
            {running ? 'In progress' : "Today's Exam"}
          </p>
          <p className="truncate text-[13px] font-extrabold leading-tight theme-text">
            {sessionLabel(featured)}
            <span className="ml-1.5 font-semibold theme-text-muted">
              {formatSessionTime(featured)}
            </span>
          </p>
        </div>
        <button type="button" onClick={onView} className="ztt-btn ztt-btn-primary shrink-0 !min-h-[38px] !px-3">
          View
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
        <div key={r.key} className="ztt-card flex items-start gap-2 bg-amber-50/70 p-3">
          <span aria-hidden="true" className="text-base leading-none">
            ⏰
          </span>
          <p className="min-w-0 flex-1 text-[12px] font-semibold leading-snug theme-text-muted">
            <span className="font-bold theme-text">{sessionLabel(r.session)}</span> —{' '}
            {formatDayHeading(r.session.start.slice(0, 10))}, {formatSessionTime(r.session)}
            <span className="ml-1 text-[10.5px] font-bold uppercase tracking-wide text-amber-700">
              ({r.offsetLabel})
            </span>
          </p>
          <button
            type="button"
            onClick={() => onDismiss(r.key)}
            aria-label="Dismiss reminder"
            className="shrink-0 rounded-full px-1.5 text-sm font-black theme-text-muted hover:theme-text"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * Compact reminder control: a bell + label + supporting text, with the toggle
 * switch on the right. The offset pills only exist while it's on; turning it
 * off hides the choices but keeps them stored so toggling back restores them.
 */
function ReminderToggle({ prefs, onToggleEnabled, onToggleOffset }) {
  const enabled = remindersEnabled(prefs)
  const selected = new Set(prefs?.offsets || [])
  return (
    <section className="ztt-card p-3.5">
      <div className="flex items-center gap-3">
        <span
          className="ztt-tile"
          style={{ background: '#e3edfb', width: 38, height: 38 }}
          aria-hidden="true"
        >
          <Icon as={Bell} size="sm" style={{ color: '#1d4ed8' }} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-extrabold theme-text">Exam reminders</p>
          <p className="text-[11.5px] font-semibold theme-text-muted">
            Receive reminders before each paper
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Enable exam reminders"
          onClick={onToggleEnabled}
          className="ztt-switch"
        />
      </div>
      {enabled && (
        <div className="animate-fade-in mt-3 border-t theme-border pt-3">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wide theme-text-muted">
            Remind me
          </p>
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_OFFSETS.map((o) => {
              const on = selected.has(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggleOffset(o.id)}
                  className={`ztt-pick ${on ? 'ztt-pick-on' : ''}`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[10.5px] font-medium theme-text-muted">
            Reminders show here in the app when you open it within the window.
          </p>
        </div>
      )}
    </section>
  )
}

// External-link glyph (no matching Heroicon export) — small, decorative.
function ExternalLinkGlyph({ className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

function OfficialPdfButtons({ pdfUrl }) {
  return (
    <div className="space-y-2">
      <Link to="/timetable/pdf" className="ztt-btn ztt-btn-block justify-between !px-4">
        <span className="flex items-center gap-2">
          <Icon as={DocumentTextIcon} size="sm" strokeWidth={2} />
          View Official ECZ Timetable (PDF)
        </span>
        <ExternalLinkGlyph />
      </Link>
      {/* Android WebView can't run a browser download; the in-app viewer at
          /timetable/pdf covers reading it there. */}
      {!isNativePlatform() && pdfUrl && (
        <a href={pdfUrl} download className="ztt-btn ztt-btn-block justify-between !px-4">
          <span className="flex items-center gap-2">
            <Icon as={Download} size="sm" strokeWidth={2} />
            Download Official PDF
          </span>
        </a>
      )}
    </div>
  )
}

function TimetableSearch({ value, onChange }) {
  return (
    <div className="relative">
      <label htmlFor="timetable-search" className="sr-only">
        Search subjects
      </label>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 theme-text-muted">
        <Icon as={Search} size="sm" strokeWidth={2} />
      </span>
      <input
        id="timetable-search"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search subjects, papers or dates…"
        className="ztt-search"
      />
    </div>
  )
}

// Filter chips over the (already search-filtered) timeline. Each chip carries
// its live match count and only renders when it would match something; the
// whole row hides unless at least two buckets are non-empty — so filters never
// appear when they couldn't meaningfully partition the list (e.g. before the
// season, when everything is simply "upcoming").
const FILTER_CHIPS = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
]

function TimetableFilters({ counts, value, onChange }) {
  const available = FILTER_CHIPS.filter((c) => counts[c.key] > 0)
  if (available.length < 2) return null
  const chips = [{ key: 'all', label: 'All', count: counts.all }, ...available.map((c) => ({ ...c, count: counts[c.key] }))]
  return (
    <div
      role="group"
      aria-label="Filter exams by status"
      className="flex flex-wrap gap-1.5"
    >
      {chips.map((c) => {
        const on = value === c.key
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            aria-label={`Show ${c.label.toLowerCase()} exams`}
            onClick={() => onChange(c.key)}
            className={`ztt-pick ${on ? 'ztt-pick-sel' : ''}`}
          >
            {c.label}
            <span className="ml-1 opacity-70 tabular-nums">{c.count}</span>
          </button>
        )
      })}
    </div>
  )
}

function PastTimetablesSection({ archived, nowMs }) {
  const [openId, setOpenId] = useState(null)
  if (archived.length === 0) return null
  return (
    <section>
      <h2 className="mb-2 text-[15px] font-extrabold theme-text sm:text-base">
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
                className="ztt-card flex min-h-[44px] w-full items-center gap-2 p-3 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold theme-text">
                  {t.year} {t.examName}
                </span>
                <span className="ztt-badge ztt-badge-archived">Archived</span>
                <Icon
                  as={ChevronRight}
                  size="sm"
                  className={`shrink-0 theme-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                />
              </button>
              {open && (
                <div className="animate-slide-in-soft ztt-timeline mt-3 space-y-4 pl-1">
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
      <Skeleton height={150} className="!rounded-[20px]" />
      <Skeleton height={46} className="!rounded-[14px]" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={110} className="!rounded-[20px]" />
      ))}
    </div>
  )
}

function ErrorState({ onRetry }) {
  return (
    <div className="ztt-card p-6 text-center">
      <p className="text-[14px] font-extrabold theme-text">
        We could not load the exam timetable.
      </p>
      <p className="mt-1 text-[12px] font-semibold theme-text-muted">
        Check your connection and try again.
      </p>
      <button type="button" onClick={onRetry} className="ztt-btn ztt-btn-primary mx-auto mt-3">
        Try Again
      </button>
    </div>
  )
}

export default function ExamTimetablePage() {
  const { currentUser, userProfile } = useAuth()
  // Grade-agnostic page; learners without a grade set (who also see the
  // dashboard card) get the Grade-7 PSLE timetable, matching the card's gate.
  const grade = parseInt(userProfile?.grade, 10) || 7
  const { active, archived, loading, error } = useExamTimetables(grade)

  // The 1 s clock drives the summary + floating banner (they display seconds).
  // Everything below — statuses, day groups, reminders — takes the minute-
  // floored clock instead: session boundaries sit on whole minutes, so the
  // day list only re-renders when something can actually change.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const nowMinuteMs = nowMs - (nowMs % 60000)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 200)
  const isSearching = debouncedSearch.trim().length > 0
  // Status filter chips ('all' | 'today' | 'upcoming' | 'completed'). Like a
  // search, an active filter expands every matching day so results are visible.
  const [statusFilter, setStatusFilter] = useState('all')
  const isFiltering = isSearching || statusFilter !== 'all'

  // Collapsible days: today + the next exam day start open, the rest start
  // collapsed. A learner's taps override the defaults until the page reloads
  // or the timetable changes; an active search expands every match.
  const defaultOpenKey = active
    ? [...getDefaultExpandedDates(active, nowMinuteMs)].sort().join(',')
    : ''
  const defaultOpenDates = useMemo(
    () => new Set(defaultOpenKey ? defaultOpenKey.split(',') : []),
    [defaultOpenKey],
  )
  const [dayOverrides, setDayOverrides] = useState({})
  useEffect(() => {
    setDayOverrides({})
    setStatusFilter('all')
  }, [active?.id])
  const toggleDay = useCallback(
    (date) => {
      if (isFiltering) return
      setDayOverrides((prev) => ({
        ...prev,
        [date]: !(prev[date] ?? defaultOpenDates.has(date)),
      }))
    },
    [defaultOpenDates, isFiltering],
  )

  // Open (if collapsed) and scroll to a specific day — used by the next-exam
  // panel so tapping it jumps straight to the relevant timeline entry.
  const openAndScrollToDay = useCallback(
    (date) => {
      if (!isSearching) setDayOverrides((prev) => ({ ...prev, [date]: true }))
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          document
            .getElementById(`day-${date}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
    },
    [isSearching],
  )

  // Floating today-banner: only while the summary (which carries the same
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

  // Search first, then the status chip — order-independent, both prune days.
  const filtered = useMemo(() => {
    if (!active) return null
    return filterTimetableByStatus(filterTimetable(active, debouncedSearch), statusFilter, nowMinuteMs)
  }, [active, debouncedSearch, statusFilter, nowMinuteMs])
  // Chip counts run over the search-filtered set so they reflect the current
  // search context (and the row hides itself when filters wouldn't partition).
  const filterCounts = useMemo(
    () => (active ? statusBucketCounts(filterTimetable(active, debouncedSearch), nowMinuteMs) : null),
    [active, debouncedSearch, nowMinuteMs],
  )
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
    <div
      className="theme-bg theme-text min-h-screen"
      style={{ paddingBottom: 'calc(6.5rem + env(safe-area-inset-bottom))' }}
    >
      <SeoHelmet title="Exam Timetable" path="/timetable" noIndex />
      <Navbar />

      {active && phase === PHASE.DURING && !heroVisible && (
        <TodayExamBanner timetable={active} nowMs={nowMs} onView={scrollToHero} />
      )}

      <div className="mx-auto max-w-[1100px] px-4 pt-4">
        {loading ? (
          <PageSkeleton />
        ) : error && !active ? (
          <ErrorState onRetry={() => window.location.reload()} />
        ) : !active ? (
          <div className="ztt-card p-6 text-center">
            <p className="text-[14px] font-extrabold theme-text">
              No exam timetable is available for Grade {grade} yet.
            </p>
            <p className="mt-1 text-[12px] font-semibold theme-text-muted">
              Check back soon — timetables appear here as soon as ECZ publishes them.
            </p>
            <Link to="/dashboard" className="ztt-btn mx-auto mt-3">
              ← Back to dashboard
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <ExamHero timetable={active} />

            <div className="lg:grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start lg:gap-5">
              {/* Left column — summary + controls (sticky on desktop) */}
              <div ref={heroRef} className="space-y-3 lg:sticky lg:top-20 lg:self-start">
                {phase === PHASE.AFTER ? (
                  <SeasonOverBanner timetable={active} />
                ) : (
                  <ExamSummary
                    timetable={active}
                    nowMs={nowMs}
                    onOpenDay={openAndScrollToDay}
                  />
                )}

                <ReminderBar reminders={dueReminders} onDismiss={dismissReminder} />

                {phase !== PHASE.AFTER && (
                  <ReminderToggle
                    prefs={prefs}
                    onToggleEnabled={toggleEnabled}
                    onToggleOffset={toggleOffset}
                  />
                )}

                <OfficialPdfButtons pdfUrl={active.pdfUrl} />

                <div className="space-y-2.5">
                  <TimetableSearch value={search} onChange={setSearch} />
                  <TimetableFilters
                    counts={filterCounts}
                    value={statusFilter}
                    onChange={setStatusFilter}
                  />
                </div>
              </div>

              {/* Right column — the exam timeline */}
              <div className="mt-3 min-w-0 lg:mt-0">
                {filtered.days.length === 0 ? (
                  <div className="ztt-card p-6 text-center">
                    <p className="text-[13px] font-bold theme-text-muted">
                      No timetable items match your {isSearching ? 'search' : 'filter'}.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('')
                        setStatusFilter('all')
                      }}
                      className="ztt-btn mx-auto mt-3"
                    >
                      {isSearching ? 'Clear search' : 'Show all'}
                    </button>
                  </div>
                ) : (
                  <div className="ztt-timeline space-y-4">
                    {filtered.days.map((day) => (
                      <ExamDayGroup
                        key={day.date}
                        day={day}
                        dayNumber={dayNumbers.get(day.date) || 0}
                        grade={active.grade}
                        timetableId={active.id}
                        nowMs={nowMinuteMs}
                        nextKey={nextPaperKey}
                        open={
                          isFiltering
                            ? true
                            : (dayOverrides[day.date] ?? defaultOpenDates.has(day.date))
                        }
                        onToggle={toggleDay}
                      />
                    ))}
                  </div>
                )}

                <div className="mt-4">
                  <PastTimetablesSection archived={archived} nowMs={nowMinuteMs} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
