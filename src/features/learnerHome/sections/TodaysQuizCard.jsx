/**
 * TodaysQuizCard — the prototype's slim `.daily-slim` card on Home:
 * Zed's face, "Today's Quiz", the question count, and a coral Play
 * pill. Once the learner has played every one of today's exams the
 * card flips to the mockup's finished state — "Done for today ✓ · see
 * the leaderboard", with the pill reading "Ranks" — instead of
 * inviting a play that would be refused.
 *
 * This is the mockup's `dailyEntry()`: ZedExams' daily quiz IS the
 * Daily Exam, so the card reads the same `todaysExams` + locks the
 * dashboard already loads and starts the next unlocked one. It
 * replaces the old Today's Exams panel, which listed each subject
 * separately and sat below Quick Access.
 *
 * Availability is still validated server-side when the runner starts;
 * this card only summarises.
 *
 * IT IS ALWAYS RENDERED. It used to return null when no exam had been
 * picked for today, which is how the card came to be missing from a real
 * learner's home while sitting in every mockup: the daily-exam picker is
 * a cron, and a grade it has not run for yet has an empty set. A fixed
 * part of the furniture that silently disappears reads as a bug, so the
 * third state says what is true — no quiz today — and opens the daily
 * exams screen, which is a real place showing the run of them. What it
 * never does is offer a Play that would be refused.
 */
import { useNavigate } from 'react-router-dom'
import { buildTodaysExamsSummary } from '../lib/learnerHomeCore'
import { capture } from '../../../utils/analytics'

export default function TodaysQuizCard({ todaysExams, streak = 0 }) {
  const navigate = useNavigate()
  const summary = buildTodaysExamsSummary(todaysExams?.exams, todaysExams?.locks)

  if (!summary.hasExams) {
    return (
      <button
        type="button"
        className="lhx-card lhx-daily-slim lhx-press"
        onClick={() => {
          capture('daily_exams_opened', { from: 'home_daily', reason: 'none_today' })
          navigate('/exams')
        }}
      >
        <span className="lhx-ds-icon" aria-hidden="true">
          <img src="/images/characters/poses/zed-waving.webp" alt="" width="40" height="40" loading="lazy" />
        </span>
        <span className="lhx-ds-body">
          <span className="lhx-ds-title">Today’s Quiz</span>
          <span className="lhx-ds-sub">No quiz today — see the ones you’ve done</span>
        </span>
        <span className="lhx-play-pill lhx-play-pill-sm" aria-hidden="true">Open</span>
      </button>
    )
  }

  const { next, completed, total, allDone } = summary
  // allDone can be true with no `next`; a not-all-done state with no
  // unlocked exam left means every remaining one is locked, which reads
  // as done to the learner too.
  const done = allDone || !next

  const sub = done
    ? 'Done for today ✓ · see the leaderboard'
    : [
        `${total - completed} of ${total} left`,
        'with Zed',
        streak > 0 ? `keep your 🔥 ${streak}` : 'start a streak 🔥',
      ].join(' · ')

  const go = () => {
    if (done) {
      capture('exam_leaderboard_opened', { from: 'home_daily' })
      navigate('/exams/leaderboard')
      return
    }
    capture('daily_exam_started', { examId: next.examId, from: 'home_daily' })
    navigate(`/exam/${next.examId}`)
  }

  return (
    <button type="button" className="lhx-card lhx-daily-slim lhx-press" onClick={go}>
      <span className="lhx-ds-icon" aria-hidden="true">
        <img src="/images/characters/poses/zed-waving.webp" alt="" width="40" height="40" loading="lazy" />
      </span>
      <span className="lhx-ds-body">
        <span className="lhx-ds-title">Today’s Quiz</span>
        <span className="lhx-ds-sub">{sub}</span>
      </span>
      <span className="lhx-play-pill lhx-play-pill-sm" aria-hidden="true">{done ? 'Ranks' : 'Play'}</span>
    </button>
  )
}
