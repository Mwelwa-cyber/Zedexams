/**
 * ExamCountdownCard — the prototype's coral `.exam-countdown` card, the
 * first thing under the Grade · Term chip on Home: calendar tile, the
 * "EXAMS ARE COMING" label, the season name, the next paper's date and
 * subject, and the days-to-go badge. Tapping it opens /timetable.
 *
 * This replaces the chip step 2 shipped in its place. The chip could
 * only ever say "Exams in 12 days"; the mockup's card says WHICH paper
 * is next and WHEN, which is the part a learner plans around — so the
 * sub-line is built from a real session's papers, not from a count.
 *
 * Two things it is careful about:
 *   - The named paper is the next paper session that has NOT started,
 *     not `sessions[0]` — mid-season, the first session of the week is
 *     in the past, and naming it would tell a learner to revise for an
 *     exam they already sat.
 *   - A choose-ONE session (Friday) carries several papers; it says how
 *     many rather than picking one, because the learner sits one of
 *     them and we do not know which.
 *
 * The countdown maths is unchanged (getExamCountdownState over the same
 * session list /timetable reads), so the two can never disagree.
 * Renders nothing when no timetable is published or the season is over
 * — an absent timetable is never drawn as "0 days".
 */
import { useNavigate } from 'react-router-dom'
import useCountdown from '../hooks/useCountdown'
import { listSessions } from '../../../utils/examTimetableLogic'
import { getExamCountdownState, countdownParts } from '../lib/learnerHomeCore'
import { capture } from '../../../utils/analytics'

const DAY_FMT = { weekday: 'short', day: 'numeric', month: 'short' }

/** Papers → the mockup's paper name ("English Language", "3 papers"). */
export function paperName(papers) {
  const list = papers || []
  if (list.length === 0) return null
  if (list.length > 1) return `${list.length} papers`
  return list[0]?.name || null
}

/** "First paper: Mon 27 Oct · English Language" for a session. */
export function nextPaperLine(session) {
  if (!session) return null
  const when = Number.isFinite(session.startsAt)
    ? new Date(session.startsAt).toLocaleDateString('en-GB', DAY_FMT)
    : null
  return [when ? `Next paper: ${when}` : null, paperName(session.papers)]
    .filter(Boolean).join(' · ') || null
}

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

  const days = state.phase === 'upcoming' ? countdownParts(state.msRemaining).days : 0
  const title = active?.shortName || active?.examName || 'Exams'
  const sub = nextPaperLine(sessions.find((s) => s.startsAt > now) || null)
  const label = days > 0 ? `${days} ${days === 1 ? 'day' : 'days'} to go` : 'exams are on today'

  return (
    <button
      type="button"
      className="lhx-exam-card lhx-press"
      onClick={() => { capture('timetable_opened', { from: 'home_countdown' }); navigate('/timetable') }}
      aria-label={`${title} — ${label}. Open the exam timetable.`}
    >
      <span className="lhx-exam-cal" aria-hidden="true">📅</span>
      <span className="lhx-exam-body">
        <span className="lhx-exam-label">EXAMS ARE COMING</span>
        <span className="lhx-exam-title">{title}</span>
        {sub && <span className="lhx-exam-sub">{sub}</span>}
      </span>
      <span className="lhx-exam-days" aria-hidden="true">
        {days > 0 ? <><b>{days}</b><span>{days === 1 ? 'DAY' : 'DAYS'}</span></> : <b>NOW</b>}
      </span>
    </button>
  )
}
