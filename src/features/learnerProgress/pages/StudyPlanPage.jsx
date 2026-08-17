/**
 * StudyPlanPage — the prototype's Study Plan: the exam countdown, the
 * "focus on these first" cards built from the learner's own weak topics,
 * and today's short checklist.
 *
 * This is the screen that closes the loop the playbook cares about —
 * results → weak topics → practice. Every card is a real deep link into
 * the subject's practice surface; none of them is a placeholder.
 *
 * The checklist ticks from RECORDED ACTIVITY, not from a stored plan.
 * The prototype's is hard-coded with one item pre-ticked; a checklist
 * that ticks itself regardless of what the learner did would be worse
 * than none, so each row is checked only when something of that kind was
 * actually finished today.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../progress.css'
import {
  useLearnerDashboard, EmptyState, ErrorState, SectionSkeleton,
} from '../../learnerHome'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { capture } from '../../../utils/analytics'
import { listSessions } from '../../../utils/examTimetableLogic'
import { buildStudyPlan, focusReason, daysUntil, toMillis } from '../lib/progressCore'

const TOPIC_ICON = '🎯'

function finishedToday(activity, kinds, now = Date.now()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  return (activity || []).some((a) => {
    const t = toMillis(a.completedAt || a.createdAt)
    return t != null && t >= start.getTime() && kinds.some((k) => String(a.type || '').includes(k))
  })
}

export default function StudyPlanPage() {
  const navigate = useNavigate()
  const { loading, error, data, grade, timetables, refresh } = useLearnerDashboard({ extras: true })

  const plan = useMemo(() => buildStudyPlan(data?.weakTopics), [data?.weakTopics])
  const activity = data?.recentActivity || []

  // Days to the next paper of the published timetable, if there is one.
  // Read through the same `listSessions` the countdown card uses, so the
  // two never disagree about which paper is next.
  const days = useMemo(() => {
    const active = timetables?.active
    if (!active) return null
    const next = listSessions(active)
      .filter((s) => (s.papers || []).length > 0)
      .map((s) => Date.parse(s.start))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)
      .find((t) => t > Date.now())
    return next ? daysUntil(next) : null
  }, [timetables])

  const practise = (item) => {
    capture('study_plan_practise', { topic: item.topic, subject: item.subject })
    // The subject's practice surface is the closest real destination for a
    // topic today; it opens on that subject's quizzes grouped by topic.
    if (item.subject && grade) navigate(`/practise/${grade}/${item.subject}`)
    else navigate('/quizzes')
  }

  const checklist = [
    {
      key: 'revise',
      label: data?.learningResume?.title
        ? `Revise: ${data.learningResume.title}`
        : 'Read one note',
      done: finishedToday(activity, ['note']),
      go: () => navigate(data?.learningResume?.id ? `/notes/${data.learningResume.id}` : '/notes'),
    },
    {
      key: 'practise',
      label: plan[0] ? `Practise: ${plan[0].topic}` : 'Practise a weak topic',
      done: finishedToday(activity, ['quiz', 'exam']),
      go: () => (plan[0] ? practise(plan[0]) : navigate('/games')),
    },
    {
      key: 'paper',
      label: 'One past-paper section',
      done: finishedToday(activity, ['paper']),
      go: () => navigate('/papers'),
    },
  ]

  return (
    <div>
      <SeoHelmet title="Study Plan" path="/study-plan" noIndex />
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to My Progress" onClick={() => navigate('/progress')}>‹</button>
        <div>
          <div className="lhx-back-title">Study Plan</div>
          {data?.activeTerm?.term && <div className="lhx-back-sub">Term {data.activeTerm.term}</div>}
        </div>
      </div>

      {error ? (
        <div className="lhx-card"><ErrorState onRetry={refresh}>We couldn’t load your study plan.</ErrorState></div>
      ) : loading ? (
        <div className="lhx-card"><SectionSkeleton lines={5} height={56} /></div>
      ) : (
        <>
          {/* The countdown appears only when a timetable is published —
              a hero counting down to nothing is worse than no hero. */}
          {days != null && (
            <section className="lhx-sp-hero" aria-label="Exam countdown">
              <div className="lhx-sp-hero-label">GET EXAM READY</div>
              <div className="lhx-sp-hero-days">{days} {days === 1 ? 'day' : 'days'} to go</div>
              <div className="lhx-sp-hero-sub">Focus on your weak spots first — here’s your plan.</div>
            </section>
          )}

          <section className="lhx-section" aria-labelledby="lhx-focus-title">
            <div className="lhx-section-head">
              <h2 id="lhx-focus-title" className="lhx-section-title">Focus on these first</h2>
            </div>
            {plan.length === 0 ? (
              <div className="lhx-card">
                <EmptyState icon="learn">
                  Nothing to focus on yet — finish a few quizzes and the topics worth practising will appear here.
                </EmptyState>
              </div>
            ) : (
              <ul className="lhx-sp-list">
                {plan.map((item) => (
                  <li key={`${item.subject}|${item.topic}`} className="lhx-card lhx-sp-topic">
                    <span className="lhx-sp-ic" aria-hidden="true">{TOPIC_ICON}</span>
                    <span className="lhx-sp-txt">
                      <b>{item.topic}</b>
                      <small>{focusReason(item)}</small>
                    </span>
                    <button type="button" className="lhx-sp-practise" onClick={() => practise(item)}>
                      Practise
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="lhx-section" aria-labelledby="lhx-today-title">
            <div className="lhx-section-head">
              <h2 id="lhx-today-title" className="lhx-section-title">Today’s plan</h2>
            </div>
            <ul className="lhx-sp-checks">
              {checklist.map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    className={`lhx-sp-check${row.done ? ' is-done' : ''}`}
                    onClick={row.go}
                  >
                    <span className="lhx-sp-box" aria-hidden="true">{row.done ? '✓' : ''}</span>
                    <span className="lhx-sp-lbl">{row.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
