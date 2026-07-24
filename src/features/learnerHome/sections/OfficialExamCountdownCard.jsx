/**
 * OfficialExamCountdownCard — the 2026 official exam timetable summary
 * + live countdown. Uses the canonical examTimetables data (Firestore
 * with bundled fallback), ticks only while visible, and never labels
 * Daily Exams as the official examination.
 */
import { useNavigate } from 'react-router-dom'
import LearnerIcon from '../components/LearnerIcon'
import { SectionSkeleton, EmptyState } from '../components/LearnerPrimitives'
import useCountdown from '../hooks/useCountdown'
import { listSessions, sessionLabel } from '../../../utils/examTimetableLogic'
import { getExamCountdownState, countdownParts } from '../lib/learnerHomeCore'
import { capture } from '../../../utils/analytics'

function fmtWhen(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
    + ' · '
    + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function OfficialExamCountdownCard({ grade, timetables }) {
  const navigate = useNavigate()
  const { active, loading } = timetables || {}

  // Sessions with papers only (the briefing day is never "the next exam").
  const sessions = active
    ? listSessions(active)
        .filter((s) => (s.papers || []).length > 0)
        .map((s) => ({ startsAt: Date.parse(s.start), endsAt: Date.parse(s.end), raw: s }))
    : []
  const hasData = sessions.length > 0
  const now = useCountdown(hasData)
  const state = getExamCountdownState(sessions, now)

  const openTimetable = () => {
    capture('timetable_opened', { from: 'dashboard' })
    navigate('/timetable')
  }

  if (loading) {
    return (
      <section className="lhx-card lhx-countdown" aria-label="Exam timetable">
        <SectionSkeleton lines={3} />
      </section>
    )
  }

  const heading = active
    ? `${active.year || ''} Exam Timetable`.trim()
    : 'Exam Timetable'

  return (
    <section className="lhx-card lhx-countdown" aria-labelledby="lhx-countdown-title">
      <div className="lhx-section-head">
        <div>
          <p className="lhx-kicker">
            {[grade ? `Grade ${grade}` : null, active?.board || null, active?.year || null].filter(Boolean).join(' · ')}
          </p>
          <h2 id="lhx-countdown-title" className="lhx-section-title">{heading}</h2>
        </div>
        <span className="lhx-quick-icon lhx-tint-orange" aria-hidden="true">
          <LearnerIcon name="countdown" size={22} />
        </span>
      </div>

      {!active || state.phase === 'none' ? (
        <EmptyState icon="timetable">
          The examination timetable has not been published yet.
        </EmptyState>
      ) : state.phase === 'in_progress' ? (
        <>
          <p className="lhx-countdown-next">{sessionLabel(state.session.raw)}</p>
          <p className="lhx-countdown-status" role="status">Exam in progress</p>
        </>
      ) : state.phase === 'completed' ? (
        <p className="lhx-countdown-status" role="status">Examinations completed — well done!</p>
      ) : (
        <>
          <p className="lhx-kicker" style={{ marginTop: 4 }}>Next</p>
          <p className="lhx-countdown-next">{sessionLabel(state.session.raw)}</p>
          <p className="lhx-countdown-when">{fmtWhen(state.session.raw.start)}</p>
          {(() => {
            const parts = countdownParts(state.msRemaining)
            const cells = [
              { v: parts.days, u: 'days' },
              { v: parts.hours, u: 'hrs' },
              { v: parts.minutes, u: 'min' },
              { v: parts.seconds, u: 'sec' },
            ]
            return (
              <div
                className="lhx-count-grid"
                role="timer"
                aria-label={`Starts in ${parts.days} days, ${parts.hours} hours, ${parts.minutes} minutes`}
              >
                {cells.map((c) => (
                  <div key={c.u} className="lhx-count-cell">
                    <div className="lhx-count-num">{c.v}</div>
                    <div className="lhx-count-unit">{c.u}</div>
                  </div>
                ))}
              </div>
            )
          })()}
        </>
      )}

      {active && (
        <button
          type="button"
          className="lhx-btn lhx-btn-sm lhx-btn-soft lhx-btn-block"
          style={{ marginTop: 12, background: 'var(--lhx-orange-soft)', color: 'var(--lhx-orange)' }}
          onClick={openTimetable}
        >
          View Full Timetable
        </button>
      )}
    </section>
  )
}
