/**
 * ExamCountdownChip — the prototype's coral "📅 Exams in N days" chip
 * beside the Grade · Term chip on Home. Ticks live (visibility-aware
 * clock) and taps through to the full timetable screen. Home stays
 * minimal; this chip is what replaced the big countdown card.
 *
 * Counts to the first SAT paper (the briefing day is never "the next
 * exam") via the same session list + phase machine the old card used,
 * so both agree with /timetable. Renders nothing when no timetable is
 * published or the season is over.
 */
import { useNavigate } from 'react-router-dom'
import useCountdown from '../hooks/useCountdown'
import { listSessions } from '../../../utils/examTimetableLogic'
import { getExamCountdownState, countdownParts } from '../lib/learnerHomeCore'
import { capture } from '../../../utils/analytics'

export default function ExamCountdownChip({ timetables }) {
  const navigate = useNavigate()
  const active = timetables?.active || null

  const sessions = active
    ? listSessions(active)
        .filter((s) => (s.papers || []).length > 0)
        .map((s) => ({ startsAt: Date.parse(s.start), endsAt: Date.parse(s.end) }))
    : []
  const now = useCountdown(sessions.length > 0)
  const state = getExamCountdownState(sessions, now)

  if (state.phase !== 'upcoming' && state.phase !== 'in_progress') return null

  const days = state.phase === 'upcoming' ? countdownParts(state.msRemaining).days : 0
  const text = days > 0 ? `Exams in ${days} ${days === 1 ? 'day' : 'days'}` : 'Exams today'

  const open = () => {
    capture('timetable_opened', { from: 'home_chip' })
    navigate('/timetable')
  }

  return (
    <button type="button" className="lhx-chip lhx-chip-exam" onClick={open} aria-label={`${text} — open the exam timetable`}>
      <span aria-hidden="true">📅</span> <b>{text}</b>
    </button>
  )
}
