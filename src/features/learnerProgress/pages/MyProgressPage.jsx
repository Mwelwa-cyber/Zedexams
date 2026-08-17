/**
 * MyProgressPage — the prototype's My Progress screen, reached from
 * Profile: exam-readiness ring, this week's activity, subject mastery,
 * topics to improve, and the CTA into the Study Plan.
 *
 * WHAT THE PROTOTYPE HAS AND THIS DOES NOT, and why: it shows
 * "3h 20m this week" and captions the chart "Minutes learned each day".
 * The app records no time — there is no session timer and no duration on
 * any result or note-progress document — so those would be invented
 * numbers shown to a child as fact. The chart plots what IS recorded,
 * how many things they finished each day, and is captioned as that. If
 * time tracking is added later, the caption is the only thing that has
 * to change.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../progress.css'
import {
  useLearnerDashboard, LearnerIcon, subjectIconName,
  EmptyState, ErrorState, SectionSkeleton,
} from '../../learnerHome'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { examReadiness, weeklyActivity } from '../lib/progressCore'

export default function MyProgressPage() {
  const navigate = useNavigate()
  const { loading, error, data, refresh } = useLearnerDashboard({ extras: true })

  const subjects = useMemo(() => data?.subjects || [], [data?.subjects])
  const readiness = useMemo(() => examReadiness(subjects), [subjects])
  const week = useMemo(() => weeklyActivity(data?.recentActivity || []), [data?.recentActivity])
  const weakTopics = data?.weakTopics || []
  const streak = data?.streak || 0
  const doneThisWeek = week.reduce((n, d) => n + d.count, 0)

  return (
    <div>
      <SeoHelmet title="My Progress" path="/progress" noIndex />
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to Profile" onClick={() => navigate('/profile')}>‹</button>
        <div>
          <div className="lhx-back-title">My Progress</div>
          {data?.activeTerm?.term && (
            <div className="lhx-back-sub">Term {data.activeTerm.term}</div>
          )}
        </div>
      </div>

      {error ? (
        <div className="lhx-card"><ErrorState onRetry={refresh}>We couldn’t load your progress.</ErrorState></div>
      ) : loading ? (
        <div className="lhx-card"><SectionSkeleton lines={6} height={56} /></div>
      ) : (
        <>
          <section className="lhx-prog-hero" aria-label="Exam readiness">
            {/* The ring is decorative; the number beside it is the value,
                so a screen reader gets it once rather than twice. */}
            <div
              className="lhx-prog-ring"
              aria-hidden="true"
              style={{
                background: readiness == null
                  ? 'rgba(255,255,255,.18)'
                  : `conic-gradient(var(--lhx-yellow) ${readiness}%, rgba(255,255,255,.22) 0)`,
              }}
            >
              <b>{readiness == null ? '—' : `${readiness}%`}</b>
            </div>
            <div className="lhx-prog-hero-txt">
              <div className="lhx-prog-h1">Exam readiness</div>
              <div className="lhx-prog-h2">
                {readiness == null
                  ? 'Open a subject and finish your first topic — this fills in as you go.'
                  : [
                      streak > 0 ? `🔥 ${streak}-day streak` : null,
                      doneThisWeek > 0
                        ? `${doneThisWeek} finished this week`
                        : 'Nothing finished yet this week',
                    ].filter(Boolean).join(' · ')}
              </div>
            </div>
          </section>

          <section className="lhx-section" aria-labelledby="lhx-week-title">
            <div className="lhx-section-head">
              <h2 id="lhx-week-title" className="lhx-section-title">This week</h2>
            </div>
            <div className="lhx-card" style={{ padding: '14px 14px 10px' }}>
              <ol className="lhx-wk-bars">
                {week.map((d) => (
                  <li key={d.key} className={`lhx-wk-bar${d.isToday ? ' is-today' : ''}`}>
                    <span
                      className="lhx-wk-fill"
                      style={{ height: `${d.percent}%` }}
                      /* The count is the fact; the bar is how it looks. */
                      title={`${d.count} finished`}
                    />
                    <span className="lhx-wk-day">{d.letter}</span>
                  </li>
                ))}
              </ol>
              <p className="lhx-wk-cap">Quizzes, notes and papers finished each day</p>
            </div>
          </section>

          <section className="lhx-section" aria-labelledby="lhx-mastery-title">
            <div className="lhx-section-head">
              <h2 id="lhx-mastery-title" className="lhx-section-title">Subject mastery</h2>
            </div>
            {subjects.length === 0 ? (
              <div className="lhx-card"><EmptyState icon="learn">Your subjects will appear here once your grade is set.</EmptyState></div>
            ) : (
              <div className="lhx-card" style={{ padding: '6px 15px' }}>
                {subjects.map((s) => (
                  <div key={s.id} className="lhx-gz-subj">
                    <span className="lhx-gz-ic" aria-hidden="true">
                      <LearnerIcon name={subjectIconName(s.id)} size={18} />
                    </span>
                    <span className="lhx-gz-lab">{s.label}</span>
                    <span className="lhx-gz-bar" aria-hidden="true">
                      <i style={{ width: `${s.started ? s.percent : 0}%` }} />
                    </span>
                    <span className="lhx-gz-pct">{s.started ? `${s.percent}%` : '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="lhx-section" aria-labelledby="lhx-weak-title">
            <div className="lhx-section-head">
              <h2 id="lhx-weak-title" className="lhx-section-title">Topics to improve</h2>
            </div>
            <div className="lhx-card" style={{ padding: '14px 16px' }}>
              {weakTopics.length === 0 ? (
                <p className="lhx-notif-text" style={{ margin: 0 }}>
                  Nothing flagged yet. Finish a few quizzes and the topics worth revising will show up here.
                </p>
              ) : (
                <>
                  <p className="lhx-wk-cap" style={{ textAlign: 'left', margin: '0 0 10px' }}>
                    From your recent quizzes &amp; papers:
                  </p>
                  <ul className="lhx-weak-chips">
                    {weakTopics.slice(0, 6).map((t) => (
                      <li key={`${t.subject}|${t.topic}`} className="lhx-weak-chip">{t.topic}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>

          {/* Offered only when there is something to practise. A plan
              button that opens an empty plan is a dead end. */}
          {weakTopics.length > 0 && (
            <button
              type="button"
              className="lhx-btn lhx-btn-primary lhx-btn-block"
              onClick={() => navigate('/study-plan')}
            >
              🎯&nbsp; Practise these &amp; get exam-ready
            </button>
          )}
        </>
      )}
    </div>
  )
}
