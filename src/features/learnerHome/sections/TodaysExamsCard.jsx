/**
 * TodaysExamsCard — shown only when Daily Exams are actually open today
 * (spec §11). Availability itself is still validated server-side when
 * the learner starts; this card only summarises. When nothing is open
 * the section renders nothing (Practice carries the quiet message).
 */
import { useNavigate } from 'react-router-dom'
import { normalizeSubject } from '../../../config/curriculum'
import { buildTodaysExamsSummary } from '../lib/learnerHomeCore'
import LearnerIcon from '../components/LearnerIcon'
import { capture } from '../../../utils/analytics'

export default function TodaysExamsCard({ todaysExams, streak }) {
  const navigate = useNavigate()
  const summary = buildTodaysExamsSummary(todaysExams?.exams, todaysExams?.locks)
  if (!summary.hasExams) return null

  const { next, completed, total, allDone } = summary
  const start = () => {
    if (!next) return
    capture('daily_exam_started', { examId: next.examId, from: 'dashboard' })
    navigate(`/exam/${next.examId}`)
  }

  return (
    <section className="lhx-card lhx-exams" aria-labelledby="lhx-exams-title">
      <div className="lhx-section-head">
        <div>
          <h2 id="lhx-exams-title" className="lhx-section-title">Today’s Exams</h2>
          <p className="lhx-exams-count">{completed} of {total} completed</p>
        </div>
        {streak > 0 && (
          <span className="lhx-streak-chip" aria-label={`${streak} day streak`}>
            <LearnerIcon name="streak" size={18} />
            {streak}-day
          </span>
        )}
      </div>

      {next && !allDone && (
        <div className="lhx-exams-next">
          <span className="lhx-quick-icon lhx-tint-green" aria-hidden="true">
            <LearnerIcon name="daily-exam" size={22} />
          </span>
          <div className="lhx-exams-next-info">
            <p className="lhx-exams-next-subject">{normalizeSubject(next.subject)}</p>
            <p className="lhx-exams-next-meta">
              {[
                next.questionCount ? `${next.questionCount} questions` : null,
                next.durationMinutes ? `about ${next.durationMinutes} min` : null,
                'Closes at midnight',
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      )}
      {allDone && (
        <p className="lhx-exams-count" style={{ marginTop: 8 }}>
          All done for today — great work! Results are on the leaderboard.
        </p>
      )}

      <div className="lhx-continue-actions" style={{ marginTop: 12 }}>
        {next && !allDone ? (
          <>
            <button type="button" className="lhx-btn lhx-btn-green" onClick={start}>
              {next.resume ? 'Resume Exam' : 'Start Next Exam'}
            </button>
            <button type="button" className="lhx-btn lhx-btn-ghost lhx-btn-sm" style={{ color: 'var(--lhx-green-deep)' }} onClick={() => navigate('/exams')}>
              View All
            </button>
          </>
        ) : (
          <button type="button" className="lhx-btn lhx-btn-ghost lhx-btn-sm" style={{ color: 'var(--lhx-green-deep)' }} onClick={() => navigate('/exams')}>
            View results &amp; leaderboard
          </button>
        )}
      </div>
    </section>
  )
}
