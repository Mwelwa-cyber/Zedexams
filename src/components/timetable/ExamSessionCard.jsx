/**
 * ExamSessionCard — one exam session as a sticker card, plus the day-group
 * wrapper that stacks a date's sessions under a "Tuesday, 27 October"
 * heading. Shared by the active timetable and the archived-years section
 * of /timetable.
 *
 * Visual language matches DailyExamsHub/QuizList: .zx-card-shared sticker
 * cards, pastel emoji tile per subject, .zx-pill-* status/meta pills.
 *
 * Session variants:
 *   - briefing        (papers: [])       → info card, no actions
 *   - single paper                       → subject card + quick actions
 *   - alternatives    (papers: many)     → one row per paper ("sit ONE")
 * Quick-action links render only when the paper maps to a real ZedExams
 * resource (subjectId → /practise, paperSubjectId → /papers); Special
 * Paper 2 and most Zambian languages simply show fewer buttons.
 */

import { Link } from 'react-router-dom'
import { SUBJECT_MAP } from '../../config/curriculum'
import {
  STATUS,
  getSessionStatus,
  formatSessionTime,
  formatDayHeading,
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
  [STATUS.TODAY]: { className: 'zx-pill-dark zx-pill-amber', label: 'Today' },
  [STATUS.IN_PROGRESS]: { className: 'zx-pill-dark zx-pill-orange', label: 'In Progress' },
  [STATUS.COMPLETED]: { className: 'zx-pill-dark zx-pill-green', label: 'Completed' },
  [STATUS.ARCHIVED]: { className: 'zx-pill-dark', label: 'Archived' },
}

export function StatusPill({ status }) {
  const pill = STATUS_PILL[status] || STATUS_PILL[STATUS.UPCOMING]
  return <span className={pill.className}>{pill.label}</span>
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

// Resource links for one paper. After the paper is written the emphasis
// flips from preparing (Practice Quiz / Mock Exam) to reviewing (View Past
// Paper / Practice Similar Questions).
function paperActions(paper, grade, completed) {
  const practise = paper.subjectId ? `/practise/${grade}/${paper.subjectId}` : null
  const pastPaper = paper.paperSubjectId
    ? `/papers?grade=${grade}&subject=${paper.paperSubjectId}`
    : null
  if (completed) {
    return [
      pastPaper && { label: 'View Past Paper', to: pastPaper },
      practise && { label: 'Practice Similar Questions', to: practise },
      { label: 'Revision Notes', to: '/notes' },
    ].filter(Boolean)
  }
  return [
    practise && { label: 'Practice Quiz', to: practise },
    pastPaper && { label: 'Past Paper', to: pastPaper },
    { label: 'Revision Notes', to: '/notes' },
    { label: 'Mock Exam', to: '/exams' },
  ].filter(Boolean)
}

function QuickActions({ paper, grade, completed }) {
  const actions = paperActions(paper, grade, completed)
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {actions.map((a) => (
        <Link
          key={a.label}
          to={a.to}
          className={`zx-sb px-3 py-1.5 text-[11px] ${
            completed && a.label === 'View Past Paper' ? 'zx-sb-primary' : 'zx-sb-secondary'
          }`}
        >
          {a.label}
        </Link>
      ))}
    </div>
  )
}

// One alternative paper inside a multi-paper session (Friday). Keeps the
// row compact: name, meta pills, and small inline resource links.
function AlternativePaperRow({ paper, grade, completed, archived }) {
  return (
    <div className="rounded-[14px] border-2 border-slate-200 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-900">
          {SUBJECT_MAP[paper.subjectId]?.icon || '📝'} {paper.name}
        </span>
        <span className="zx-pill-dark zx-pill-light">Paper {paper.code}</span>
        <span className="zx-pill-dark zx-pill-light">{paper.durationMinutes} min</span>
      </div>
      {!archived && (paper.subjectId || paper.paperSubjectId) && (
        <div className="mt-1 flex flex-wrap gap-x-3">
          {paper.subjectId && (
            <Link
              to={`/practise/${grade}/${paper.subjectId}`}
              className="text-[11px] font-bold text-orange-600 hover:text-orange-700"
            >
              {completed ? 'Practice similar →' : 'Practice quiz →'}
            </Link>
          )}
          {paper.paperSubjectId && (
            <Link
              to={`/papers?grade=${grade}&subject=${paper.paperSubjectId}`}
              className="text-[11px] font-bold text-slate-600 hover:text-slate-900"
            >
              Past paper →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

export function ExamSessionCard({ session, grade, nowMs, archived = false }) {
  const status = getSessionStatus(session, nowMs, { archived })
  const completed = status === STATUS.COMPLETED
  const tile = tileFor(session)
  const papers = session.papers || []
  const single = papers.length === 1 ? papers[0] : null

  return (
    <div className="zx-card-shared p-4">
      <div className="flex items-start gap-3">
        <div
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border-2 border-slate-900 text-[24px] leading-none sm:h-14 sm:w-14 sm:text-[28px] ${tile.bg}`}
        >
          <span aria-hidden="true">{tile.emoji}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[16px] font-bold leading-tight text-slate-900 sm:text-lg">
            {session.briefing ? session.title : single ? single.name : 'Choose your paper'}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
        {completed && (
          <span aria-hidden="true" className="shrink-0 text-xl">
            ✅
          </span>
        )}
      </div>

      {session.briefing && (
        <p className="mt-3 rounded-[14px] border-2 border-dashed border-slate-300 px-3 py-2 text-[11.5px] font-bold text-slate-500">
          No paper is written this day — candidates receive the examination guidelines.
        </p>
      )}

      {papers.length > 1 && (
        <div className="mt-3 space-y-2">
          {session.sessionNote && (
            <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">
              {session.sessionNote}
            </p>
          )}
          {papers.map((paper) => (
            <AlternativePaperRow
              key={paper.code}
              paper={paper}
              grade={grade}
              completed={completed}
              archived={archived}
            />
          ))}
        </div>
      )}

      {single && !archived && <QuickActions paper={single} grade={grade} completed={completed} />}
    </div>
  )
}

// `dayNumber` is the 1-based position in the FULL timetable (the page derives
// it before search filtering, so "Day 2" stays correct in filtered results).
export function ExamDayGroup({ day, dayNumber, grade, nowMs, archived = false }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-display text-[15px] font-extrabold text-slate-900 sm:text-base">
          {formatDayHeading(day.date)}
        </h2>
        {dayNumber > 0 && <span className="zx-pill-dark zx-pill-light">Day {dayNumber}</span>}
      </div>
      <div className="space-y-3">
        {day.sessions.map((session) => (
          <ExamSessionCard
            key={session.key}
            session={session}
            grade={grade}
            nowMs={nowMs}
            archived={archived}
          />
        ))}
      </div>
    </section>
  )
}
