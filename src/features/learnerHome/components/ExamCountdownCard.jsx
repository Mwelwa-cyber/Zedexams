/**
 * ExamCountdownCard — the prototype's coral "EXAMS ARE COMING" card on
 * Home, directly under the Grade · Term chip: calendar tile, the season
 * name, the first paper's date and subject, and the days-to-go badge.
 * Taps through to the full timetable screen.
 *
 * This is the mockup's shape. An earlier pass shrank it to a chip beside
 * the grade chip, which the mockup does not have — v3 through v6 all
 * show the card.
 *
 * Counts to the first SAT paper (a briefing day is never "the next
 * exam") via the same session list + phase machine /timetable uses, so
 * the two always agree. Renders nothing when no timetable is published
 * or the season is over — a countdown to an unknown date is worse than
 * no countdown.
 */
import { useNavigate } from 'react-router-dom'
import useCountdown from '../hooks/useCountdown'
import { listSessions } from '../../../utils/examTimetableLogic'
import { getExamCountdownState, countdownParts } from '../lib/learnerHomeCore'
import { capture } from '../../../utils/analytics'

const DAY_FMT = { weekday: 'short', day: 'numeric', month: 'short' }

export default function ExamCountdownCard({ timetables }) {
  const navigate = useNavigate()
  const active = timetables?.active || null

  const sessions = active
    ? listSessions(active)
      .filter((s) => (s.papers || []).length > 0)
      .map((s) => ({ startsAt: Date.parse(s.start), endsAt: Date.parse(s.end), papers: s.papers }))
    : []
  const now = useCountdown(sessions.length > 0)
  const state = getExamCountdownState(sessions, now)

  if (state.phase !== 'upcoming' && state.phase !== 'in_progress') return null

  const upcoming = state.phase === 'upcoming'
  const days = upcoming ? countdownParts(state.msRemaining).days : 0

  // The first paper still ahead — what the learner actually sits next.
  const next = sessions.find((s) => s.startsAt >= now) || sessions[0]
  const firstPaper = next?.papers?.[0] || null
  const whenLabel = next ? new Date(next.startsAt).toLocaleDateString('en-GB', DAY_FMT) : null
  // Papers carry { name, code } — "English Language 1/1".
  const paperLabel = [firstPaper?.name, firstPaper?.code].filter(Boolean).join(' ')

  const open = () => {
    capture('timetable_opened', { from: 'home_countdown' })
    navigate('/timetable')
  }

  return (
    <button
      type="button"
      className="lhx-exam-card"
      onClick={open}
      aria-label={`${upcoming ? `Exams in ${days} days` : 'Exams in progress'} — open the exam timetable`}
    >
      <span className="lhx-ec-cal" aria-hidden="true">📅</span>
      <span className="lhx-ec-body">
        <span className="lhx-ec-label" style={{ display: 'block' }}>
          {upcoming ? 'EXAMS ARE COMING' : 'EXAMS ARE ON'}
        </span>
        <span className="lhx-ec-title" style={{ display: 'block' }}>{active?.title || 'Exam season'}</span>
        {whenLabel && (
          <span className="lhx-ec-sub" style={{ display: 'block' }}>
            {upcoming ? 'First paper' : 'Next paper'}: {whenLabel}{paperLabel ? ` · ${paperLabel}` : ''}
          </span>
        )}
      </span>
      <span className="lhx-ec-days">
        {upcoming ? (
          <>
            <b>{days}</b>
            <span>{days === 1 ? 'DAY' : 'DAYS'}</span>
          </>
        ) : (
          <>
            <b>NOW</b>
            <span>ON</span>
          </>
        )}
      </span>
    </button>
  )
}
