/**
 * ExamSessionCard — one exam session as a compact subject card, plus the
 * collapsible timeline day-section that stacks a date's sessions under a
 * "Tuesday, 27 October" heading. Shared by the active timetable and the
 * archived-years section of /timetable.
 *
 * Visual language: the `.ztt-*` redesign (thin borders + soft shadows,
 * theme-variable surfaces, a coherent Heroicon subject set from
 * subjectVisuals). NOT the old .zx-card-shared sticker look.
 *
 * Status → card emphasis:
 *   Today       → orange "Today" badge, faint tinted surface
 *   In Progress → purple "In Progress" badge, faint tinted surface
 *   Next        → dark-blue "Next" badge
 *   Upcoming    → green "Upcoming" badge
 *   Completed   → muted "✓ Completed" badge
 *
 * Session variants:
 *   - briefing        (papers: [])       → info card, no actions
 *   - single paper                       → subject card + quick actions
 *   - alternatives    (papers: many)     → tap-to-select rows ("sit ONE");
 *     only the selected paper expands its actions, and the choice persists
 *     per device so a Cinyanja learner never re-picks their language.
 * Quick actions keep the two most-used links (Practice Quiz / Past Paper)
 * visible and fold the rest behind "More". Links render only when the paper
 * maps to a real ZedExams resource (subjectId → /practise, paperSubjectId →
 * /papers); the special papers and most Zambian languages simply show fewer
 * buttons. Unavailable actions are never shown.
 */

import { memo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../../shared/components/Icon'
import { ChevronRight } from '../../../shared/components/icons'
import {
  STATUS,
  getSessionStatus,
  formatSessionTime,
  formatDayHeading,
  sessionLabel,
} from '../../../utils/examTimetableLogic'
import { sessionVisual, paperVisual } from '../lib/subjectVisuals'

// Status → badge class + text label. The label is always rendered (never
// colour alone), so screen readers and colour-blind learners get the state.
const STATUS_BADGE = {
  [STATUS.UPCOMING]: { className: 'ztt-badge-upcoming', label: 'Upcoming' },
  [STATUS.NEXT]: { className: 'ztt-badge-next', label: 'Next' },
  [STATUS.TODAY]: { className: 'ztt-badge-today', label: 'Today' },
  [STATUS.IN_PROGRESS]: { className: 'ztt-badge-in-progress', label: 'In Progress' },
  [STATUS.COMPLETED]: { className: 'ztt-badge-completed', label: '✓ Completed' },
  [STATUS.MISSED]: { className: 'ztt-badge-missed', label: 'Missed' },
  [STATUS.ARCHIVED]: { className: 'ztt-badge-archived', label: 'Archived' },
}

// Faint surface tint per status — today's/live exams get a whisper of colour,
// everything else stays on the plain card surface.
const STATUS_SURFACE = {
  [STATUS.TODAY]: 'bg-orange-50/60',
  [STATUS.IN_PROGRESS]: 'bg-violet-50/60',
}

// Screen-reader phrasing for the status, spoken with the subject.
const STATUS_SR = {
  [STATUS.UPCOMING]: 'upcoming exam',
  [STATUS.NEXT]: 'next exam',
  [STATUS.TODAY]: 'exam today',
  [STATUS.IN_PROGRESS]: 'exam in progress',
  [STATUS.COMPLETED]: 'completed exam',
  [STATUS.MISSED]: 'missed exam',
  [STATUS.ARCHIVED]: 'archived exam',
}

export function ExamStatusBadge({ status }) {
  const badge = STATUS_BADGE[status] || STATUS_BADGE[STATUS.UPCOMING]
  return <span className={`ztt-badge ${badge.className} transition-colors`}>{badge.label}</span>
}

// Soft circular subject tile with a coherent Heroicon (no mixed emoji).
function SubjectTile({ visual, size = 42 }) {
  const { Icon: SubjectIcon, tint } = visual
  return (
    <span
      className="ztt-tile"
      style={{ background: tint.bg, width: size, height: size }}
      aria-hidden="true"
    >
      <Icon as={SubjectIcon} size="md" style={{ color: tint.fg }} strokeWidth={2} />
    </span>
  )
}

function practiseLink(paper, grade) {
  return paper.subjectId ? `/practise/${grade}/${paper.subjectId}` : null
}
function pastPaperLink(paper, grade) {
  return paper.paperSubjectId ? `/papers?grade=${grade}&subject=${paper.paperSubjectId}` : null
}

// Share one paper's date + time via the native share sheet, falling back to
// the clipboard on desktop browsers. Best-effort — never throws at the UI.
function ShareAction({ session, paperName, className }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const text = `${paperName} — ${formatDayHeading(session.start.slice(0, 10))}, ${formatSessionTime(session)} (ZedExams exam timetable)`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Exam Timetable', text })
        return
      }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* learner cancelled the share sheet, or clipboard is blocked */
    }
  }
  return (
    <button type="button" onClick={share} className={className}>
      {copied ? '✓ Copied' : 'Share'}
    </button>
  )
}

/**
 * Quick actions for one paper: the two most-used links stay visible, the
 * rest live behind "More". After the paper is written the emphasis flips from
 * preparing (Practice Quiz) to reviewing (View Past Paper). Buttons are equal
 * height and wrap cleanly on very narrow phones.
 */
function QuickActions({ session, paper, grade, completed }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const practise = practiseLink(paper, grade)
  const pastPaper = pastPaperLink(paper, grade)

  const primary = completed
    ? [
        pastPaper && { label: 'View Past Paper', to: pastPaper, emphasis: true },
        practise && { label: 'Practice Similar Questions', to: practise },
      ].filter(Boolean)
    : [
        practise && { label: 'Practice Quiz', to: practise },
        pastPaper && { label: 'Past Paper', to: pastPaper },
      ].filter(Boolean)

  const more = completed
    ? [{ label: 'Revision Notes', to: '/notes' }]
    : [
        { label: 'Revision Notes', to: '/notes' },
        { label: 'Mock Exam', to: '/exams' },
        { label: 'Study Plan', to: '/study-plan' },
      ]

  // Papers with no mapped resources at all: surface Revision Notes inline
  // rather than an empty row next to a lone "More" button.
  if (primary.length === 0 && more.length > 0) primary.push(more.shift())

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {primary.map((a) => (
          <Link
            key={a.label}
            to={a.to}
            className={`ztt-btn ${a.emphasis ? 'ztt-btn-primary' : ''}`}
          >
            {a.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="ztt-btn"
        >
          <span aria-hidden="true">⋯</span> More
        </button>
      </div>
      {moreOpen && (
        <div className="animate-fade-in mt-1.5 flex flex-wrap items-center gap-1.5">
          {more.map((a) => (
            <Link key={a.label} to={a.to} className="ztt-btn">
              {a.label}
            </Link>
          ))}
          <ShareAction session={session} paperName={paper.name} className="ztt-btn" />
        </div>
      )}
    </div>
  )
}

/**
 * One alternative paper inside a multi-paper session. The whole row is a tap
 * target; only the selected paper expands its resource actions. Long names
 * (e.g. "Home Economics and Hospitality") wrap onto two lines rather than
 * truncate. Archived rows are read-only — no selection, no actions, and
 * (crucially) no write to the stored choice the active year's card reads.
 */
function AlternativePaperRow({ paper, grade, selected, onSelect, completed, archived }) {
  const practise = practiseLink(paper, grade)
  const pastPaper = pastPaperLink(paper, grade)
  const rowContent = (
    <>
      <SubjectTile visual={paperVisual(paper)} size={30} />
      <span className="min-w-0 flex-1 text-[13px] font-bold leading-snug theme-text">
        {paper.name}
      </span>
      <span className="ztt-chip">Paper {paper.code}</span>
      {!archived && (
        <Icon
          as={ChevronRight}
          size="sm"
          className={`shrink-0 theme-text-muted transition-transform ${selected ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      )}
    </>
  )
  const rowClass =
    'flex w-full items-center gap-2.5 px-3 py-2.5 text-left min-h-[44px]'
  return (
    <div
      className={`ztt-card-flat overflow-hidden transition-colors ${
        selected ? '!border-blue-500 bg-blue-50/50' : ''
      }`}
    >
      {archived ? (
        <div className={rowClass}>{rowContent}</div>
      ) : (
        <button type="button" onClick={onSelect} aria-pressed={selected} className={rowClass}>
          {rowContent}
        </button>
      )}
      {selected && !archived && (
        <div className="animate-fade-in flex flex-wrap gap-1.5 px-3 pb-3">
          {practise && (
            <Link to={practise} className="ztt-btn">
              {completed ? 'Practice Similar Questions' : 'Practice Quiz'}
            </Link>
          )}
          {pastPaper && (
            <Link to={pastPaper} className="ztt-btn">
              Past Paper
            </Link>
          )}
          <Link to="/notes" className="ztt-btn">
            Revision Notes
          </Link>
        </div>
      )}
    </div>
  )
}

// The learner's pick within a choose-ONE session, remembered per device so a
// Silozi learner never re-taps their language. Scoped by timetable id (like
// reminderStorageKey) — session keys such as 'zl' repeat across years, so a
// grade-only key would bleed one year's choice into another. localStorage
// guards match ExamTimetablePage (Safari private mode must not break the card).
function choiceStorageKey(timetableId, sessionKey) {
  return `zx_exam_paper_choice_${timetableId}_${sessionKey}`
}
function readChoice(timetableId, sessionKey) {
  try {
    return localStorage.getItem(choiceStorageKey(timetableId, sessionKey)) || null
  } catch {
    return null
  }
}
function writeChoice(timetableId, sessionKey, code) {
  try {
    localStorage.setItem(choiceStorageKey(timetableId, sessionKey), code)
  } catch {
    /* best-effort */
  }
}

export function ExamSessionCard({
  session,
  grade,
  timetableId,
  nowMs,
  archived = false,
  nextKey = null,
}) {
  const status = getSessionStatus(session, nowMs, { archived, nextKey })
  const completed = status === STATUS.COMPLETED
  const papers = session.papers || []
  const single = papers.length === 1 ? papers[0] : null
  const isMulti = papers.length > 1
  const isLanguageChoice = (session.sessionNote || '').toLowerCase().includes('language')

  const [selectedCode, setSelectedCode] = useState(() =>
    isMulti && !archived ? readChoice(timetableId, session.key) : null,
  )
  const selectPaper = (code) => {
    if (archived) return
    const next = selectedCode === code ? null : code
    setSelectedCode(next)
    if (next) writeChoice(timetableId, session.key, next)
  }

  const heading = session.briefing
    ? session.title
    : single
      ? single.name
      : isLanguageChoice
        ? 'Choose Your Zambian Language'
        : 'Choose your paper'

  return (
    <article className={`ztt-card p-3 sm:p-3.5 ${STATUS_SURFACE[status] || ''}`}>
      <div className="flex items-start gap-3">
        <SubjectTile visual={sessionVisual(session)} />
        <div className="min-w-0 flex-1">
          <h4 className="text-[15px] font-extrabold leading-tight theme-text sm:text-[16px]">
            {heading}
          </h4>
          {/* Screen-reader-only status + duration, read with the subject. */}
          {!isMulti && (
            <span className="sr-only">
              {STATUS_SR[status] || 'exam'}
              {single ? `, ${single.durationMinutes} minute paper` : ''}
            </span>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {!archived && <ExamStatusBadge status={status} />}
            {archived && <ExamStatusBadge status={STATUS.ARCHIVED} />}
            <span className="ztt-chip">{formatSessionTime(session)}</span>
            {single && (
              <>
                <span className="ztt-chip">{single.durationMinutes} MIN</span>
                <span className="ztt-chip">Paper {single.code}</span>
              </>
            )}
            {isMulti && (
              <span className="ztt-chip">
                {papers.length} {isLanguageChoice ? 'languages' : 'papers'}
              </span>
            )}
          </div>
        </div>
      </div>

      {session.briefing && (
        <p className="mt-3 rounded-[12px] border border-dashed theme-border px-3 py-2 text-[12px] font-semibold theme-text-muted">
          No paper is written this day — candidates receive the examination guidelines.
        </p>
      )}

      {isMulti && (
        <div className="mt-3 space-y-1.5">
          {session.sessionNote && (
            <p className="text-[11px] font-bold uppercase tracking-wide theme-text-muted">
              {session.sessionNote}
              {!archived && ' — tap yours'}
            </p>
          )}
          {papers.map((paper) => (
            <AlternativePaperRow
              key={paper.code}
              paper={paper}
              grade={grade}
              selected={selectedCode === paper.code}
              onSelect={() => selectPaper(paper.code)}
              completed={completed}
              archived={archived}
            />
          ))}
        </div>
      )}

      {single && !archived && (
        <QuickActions session={session} paper={single} grade={grade} completed={completed} />
      )}
    </article>
  )
}

/**
 * One date's sessions under a collapsible "Tuesday, 27 October" heading, laid
 * out as one node on the vertical exam timeline (dot + connecting line).
 *
 * Controlled when the page passes `open` + `onToggle` (the active timetable:
 * today + the next exam day start open, the rest collapsed); uncontrolled and
 * closed by default otherwise (archived years). Collapsed days render only the
 * header row + a one-line summary — the session cards mount when expanded,
 * which also keeps offscreen days out of the per-minute render work.
 *
 * `dayNumber` is the 1-based position in the FULL timetable (the page derives
 * it before search filtering, so "Day 2" stays correct in filtered results).
 *
 * memo matters here: the page re-renders every second for the hero clock, but
 * passes the day list a minute-floored `nowMs` — so each group actually
 * re-renders once a minute (or on expand/collapse), not sixty times.
 */
export const ExamDayGroup = memo(function ExamDayGroup({
  day,
  dayNumber,
  grade,
  timetableId,
  nowMs,
  archived = false,
  nextKey = null,
  open,
  onToggle,
}) {
  const [selfOpen, setSelfOpen] = useState(false)
  const isControlled = typeof onToggle === 'function'
  const isOpen = isControlled ? open : selfOpen
  const toggle = () => (isControlled ? onToggle(day.date) : setSelfOpen((v) => !v))

  const sessions = day.sessions || []
  const isToday =
    !archived &&
    sessions.some((s) => {
      const st = getSessionStatus(s, nowMs)
      return st === STATUS.TODAY || st === STATUS.IN_PROGRESS
    })
  const summary = sessions.map((s) => sessionLabel(s)).join(' · ')
  const panelId = `day-panel-${timetableId}-${day.date}`

  return (
    <section id={`day-${day.date}`} className="ztt-tl-item scroll-mt-24">
      <span className={`ztt-tl-dot ${isToday ? 'ztt-tl-dot-today' : ''}`} aria-hidden="true" />
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-[12px] py-1 pr-1 text-left"
      >
        <h3 className="min-w-0 flex-1 text-[15px] font-extrabold leading-tight theme-text sm:text-base">
          {formatDayHeading(day.date)}
        </h3>
        {isToday && <span className="ztt-badge ztt-badge-today">Today</span>}
        {dayNumber > 0 && <span className="ztt-chip">Day {dayNumber}</span>}
        <Icon
          as={ChevronRight}
          size="sm"
          className={`shrink-0 theme-text-muted transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>
      {!isOpen && summary && (
        <p className="mt-0.5 line-clamp-2 text-[12px] font-semibold theme-text-muted">{summary}</p>
      )}
      <div id={panelId} hidden={!isOpen}>
        {isOpen && (
          <div className="animate-slide-in-soft mt-2 space-y-2.5">
            {sessions.map((session) => (
              <ExamSessionCard
                key={session.key}
                session={session}
                grade={grade}
                timetableId={timetableId}
                nowMs={nowMs}
                archived={archived}
                nextKey={nextKey}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
})
