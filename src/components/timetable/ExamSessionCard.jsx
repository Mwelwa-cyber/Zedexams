/**
 * ExamSessionCard — one exam session as a sticker card, plus the collapsible
 * day-group wrapper that stacks a date's sessions under a "Tuesday,
 * 27 October" heading. Shared by the active timetable and the archived-years
 * section of /timetable.
 *
 * Visual language matches DailyExamsHub/QuizList: .zx-card-shared sticker
 * cards, pastel emoji tile per subject, .zx-pill-* status/meta pills.
 *
 * Status → card emphasis (spec: today's exams jump out, everything else
 * reads secondary):
 *   Today       → emerald-tinted card + green "Today" pill
 *   In Progress → orange-tinted card + orange pill
 *   Next        → white card + dark "Next" pill
 *   Completed   → slate-tinted card + quiet "✓ Completed" pill
 *
 * Session variants:
 *   - briefing        (papers: [])       → info card, no actions
 *   - single paper                       → subject card + quick actions
 *   - alternatives    (papers: many)     → tap-to-select rows ("sit ONE");
 *     only the selected paper expands its actions, and the choice persists
 *     per device so a Cinyanja learner never re-picks their language.
 * Quick actions keep the two most-used links (Practice Quiz / Past Paper)
 * visible and fold the rest behind "⋯ More". Links render only when the
 * paper maps to a real ZedExams resource (subjectId → /practise,
 * paperSubjectId → /papers); Special Paper 2 and most Zambian languages
 * simply show fewer buttons.
 */

import { memo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SUBJECT_MAP } from '../../config/curriculum'
import {
  STATUS,
  getSessionStatus,
  formatSessionTime,
  formatDayHeading,
  sessionLabel,
} from '../../utils/examTimetableLogic'

// Pastel mascot-tile background per curriculum subject (matches QuizList /
// DailyExamsHub). Unmapped papers (special papers, most languages) get slate.
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

const STATUS_PILL = {
  [STATUS.UPCOMING]: { className: 'zx-pill-dark zx-pill-light', label: 'Upcoming' },
  [STATUS.NEXT]: { className: 'zx-pill-dark', label: 'Next' },
  [STATUS.TODAY]: { className: 'zx-pill-dark zx-pill-green', label: 'Today' },
  [STATUS.IN_PROGRESS]: { className: 'zx-pill-dark zx-pill-orange', label: 'In Progress' },
  [STATUS.COMPLETED]: { className: 'zx-pill-dark zx-pill-light', label: '✓ Completed' },
  [STATUS.ARCHIVED]: { className: 'zx-pill-dark', label: 'Archived' },
}

// Card-surface tint per status — today's exams get colour, the rest stay
// secondary (white / muted slate once written).
const STATUS_CARD_BG = {
  [STATUS.TODAY]: 'bg-emerald-50',
  [STATUS.IN_PROGRESS]: 'bg-orange-50',
  [STATUS.COMPLETED]: 'bg-slate-50',
}

export function StatusPill({ status }) {
  const pill = STATUS_PILL[status] || STATUS_PILL[STATUS.UPCOMING]
  return <span className={`${pill.className} transition-colors`}>{pill.label}</span>
}

function tileFor(session) {
  if (session.briefing) return { emoji: '📋', bg: 'bg-slate-100' }
  const papers = session.papers || []
  if (papers.length > 1) return { emoji: '📚', bg: 'bg-slate-100' }
  const subjectId = papers[0]?.subjectId
  return {
    emoji: SUBJECT_MAP[subjectId]?.icon || '📝',
    bg: SUBJECT_TILE_BG[subjectId] || 'bg-slate-100',
  }
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
 * rest live behind "⋯ More". After the paper is written the emphasis flips
 * from preparing (Practice Quiz) to reviewing (View Past Paper).
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

  // Papers with no mapped resources (Special Paper 2): surface Revision
  // Notes inline rather than an empty row next to a lone "More" button.
  if (primary.length === 0 && more.length > 0) primary.push(more.shift())

  const btn = 'zx-sb px-3 py-1.5 text-[11px]'
  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {primary.map((a) => (
          <Link
            key={a.label}
            to={a.to}
            className={`${btn} ${a.emphasis ? 'zx-sb-primary' : 'zx-sb-secondary'}`}
          >
            {a.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className={`${btn} ${moreOpen ? 'zx-sb-dark' : 'zx-sb-secondary'}`}
        >
          ⋯ More
        </button>
      </div>
      {moreOpen && (
        <div className="animate-fade-in mt-1.5 flex flex-wrap items-center gap-1.5">
          {more.map((a) => (
            <Link key={a.label} to={a.to} className={`${btn} zx-sb-secondary`}>
              {a.label}
            </Link>
          ))}
          <ShareAction
            session={session}
            paperName={paper.name}
            className={`${btn} zx-sb-secondary`}
          />
        </div>
      )}
    </div>
  )
}

// One alternative paper inside a multi-paper session. The whole row is a
// tap target; only the selected paper expands its resource actions. Archived
// rows are read-only — no selection, no actions, and (crucially) no write to
// the stored choice the active year's card reads.
function AlternativePaperRow({ paper, grade, selected, onSelect, completed, archived }) {
  const practise = practiseLink(paper, grade)
  const pastPaper = pastPaperLink(paper, grade)
  const rowContent = (
    <>
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-900">
        {SUBJECT_MAP[paper.subjectId]?.icon || '📝'} {paper.name}
      </span>
      <span className="zx-pill-dark zx-pill-light">Paper {paper.code}</span>
      <span className="hidden sm:inline-flex zx-pill-dark zx-pill-light">
        {paper.durationMinutes} min
      </span>
      {!archived && (
        <span
          aria-hidden="true"
          className={`text-[11px] text-slate-500 transition-transform ${selected ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
      )}
    </>
  )
  const rowClass = 'flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left'
  return (
    <div
      className={`rounded-[14px] border-2 transition-colors ${
        selected ? 'border-slate-900 bg-amber-50' : 'border-slate-200 bg-white'
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
        <div className="animate-fade-in flex flex-wrap gap-1.5 px-3 pb-2.5">
          {practise && (
            <Link to={practise} className="zx-sb zx-sb-secondary px-3 py-1.5 text-[11px]">
              {completed ? 'Practice Similar Questions' : 'Practice Quiz'}
            </Link>
          )}
          {pastPaper && (
            <Link to={pastPaper} className="zx-sb zx-sb-secondary px-3 py-1.5 text-[11px]">
              Past Paper
            </Link>
          )}
          <Link to="/notes" className="zx-sb zx-sb-secondary px-3 py-1.5 text-[11px]">
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
// guards match ExamTimetablePage (Safari private mode must not break the
// card).
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
  const tile = tileFor(session)
  const papers = session.papers || []
  const single = papers.length === 1 ? papers[0] : null
  const isLanguageChoice = (session.sessionNote || '').toLowerCase().includes('language')

  const [selectedCode, setSelectedCode] = useState(() =>
    papers.length > 1 && !archived ? readChoice(timetableId, session.key) : null,
  )
  const selectPaper = (code) => {
    if (archived) return
    const next = selectedCode === code ? null : code
    setSelectedCode(next)
    if (next) writeChoice(timetableId, session.key, next)
  }

  return (
    <div className={`zx-card-shared p-3 sm:p-4 ${STATUS_CARD_BG[status] || ''}`}>
      <div className="flex items-start gap-2.5 sm:gap-3">
        <div
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border-2 border-slate-900 text-[20px] leading-none sm:h-12 sm:w-12 sm:text-[24px] ${tile.bg}`}
        >
          <span aria-hidden="true">{tile.emoji}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[15px] font-bold leading-tight text-slate-900 sm:text-[17px]">
            {session.briefing
              ? session.title
              : single
                ? single.name
                : isLanguageChoice
                  ? 'Choose Your Zambian Language'
                  : 'Choose your paper'}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusPill status={status} />
            <span className="zx-pill-dark zx-pill-light">{formatSessionTime(session)}</span>
            {single && (
              <>
                <span className="zx-pill-dark zx-pill-light">{single.durationMinutes} min</span>
                <span className="zx-pill-dark zx-pill-light">Paper {single.code}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {session.briefing && (
        <p className="mt-2.5 rounded-[14px] border-2 border-dashed border-slate-300 px-3 py-2 text-[11.5px] font-bold text-slate-500">
          No paper is written this day — candidates receive the examination guidelines.
        </p>
      )}

      {papers.length > 1 && (
        <div className="mt-2.5 space-y-1.5">
          {session.sessionNote && (
            <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">
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
    </div>
  )
}

/**
 * One date's sessions under a collapsible "Tuesday, 27 October" heading.
 *
 * Controlled when the page passes `open` + `onToggle` (the active timetable:
 * today + the next exam day start open, the rest collapsed); uncontrolled
 * and closed by default otherwise (archived years). Collapsed days render
 * only the header row — the session cards mount when expanded, which also
 * keeps offscreen days out of the per-second render work.
 *
 * `dayNumber` is the 1-based position in the FULL timetable (the page derives
 * it before search filtering, so "Day 2" stays correct in filtered results).
 *
 * memo matters here: the page re-renders every second for the hero clock,
 * but passes the day list a minute-floored `nowMs` — so each group actually
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

  return (
    <section>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 rounded-[14px] px-1 py-1 text-left"
      >
        <span
          aria-hidden="true"
          className={`text-[13px] text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
        <h2 className="font-display min-w-0 flex-1 truncate text-[15px] font-extrabold text-slate-900 sm:text-base">
          {formatDayHeading(day.date)}
        </h2>
        {isToday && <span className="zx-pill-dark zx-pill-green">Today</span>}
        {dayNumber > 0 && <span className="zx-pill-dark zx-pill-light">Day {dayNumber}</span>}
      </button>
      {!isOpen && summary && (
        <p className="mt-0.5 truncate pl-6 text-[11.5px] font-semibold text-slate-500">{summary}</p>
      )}
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
    </section>
  )
})
