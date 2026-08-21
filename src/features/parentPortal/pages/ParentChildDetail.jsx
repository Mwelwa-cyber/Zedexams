/**
 * ParentChildDetail — /family/child/:childUid. One child: how they are
 * doing, where they need help, what they have been up to, and what they
 * are allowed to use.
 *
 * The hero shows three figures and every one of them is measured: the
 * streak, the quizzes behind it, and the subject completion the bars
 * below break down. The prototype's "3h 20m this week" and "68% exam
 * ready" are absent — ZedExams instruments neither, the Guardian Zone
 * already ruled on it once, and a parent who catches one invented number
 * will not believe the one that matters.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'
import { getGuardianChildDetail } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { can } from '../../../utils/guardianRoles'
import { firstNameOf } from '../lib/parentAppView'
import { describeChildPlan } from '../lib/childPlanView'
import ActivityTimeline from '../components/ActivityTimeline'
import ChildControls from '../components/ChildControls'
import { Avatar, BackRow, ErrorRetry, ListSkeleton } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

export default function ParentChildDetail() {
  const { childUid } = useParams()
  const online = useNetworkStatus()
  const [state, setState] = useState({ loading: true, error: null, data: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await getGuardianChildDetail(childUid)
      setState({ loading: false, error: null, data })
    } catch (err) {
      reportClientError(err, 'parentApp.getGuardianChildDetail')
      setState({ loading: false, error: err?.message || 'We could not load this child.', data: null })
    }
  }, [childUid])

  useEffect(() => { load() }, [load])

  const { loading, error, data } = state
  const name = firstNameOf(data?.displayName) || 'Your child'
  const subjects = (data?.subjectBreakdown || []).filter((s) => Number.isFinite(Number(s.percent ?? s.averageScore)))
  const weak = data?.summary?.weakTopics || []
  const plan = data ? describeChildPlan(data) : null

  return (
    <>
      <SeoHelmet title={`${name} · ZedExams`} noIndex />
      <BackRow title={name} to="/family/children" />

      {loading ? (
        <ListSkeleton rows={3} height={110} />
      ) : error ? (
        <ErrorRetry message={error} onRetry={load} />
      ) : (
        <>
          <section className="pax-hero" aria-label={`${name}'s summary`}>
            <div className="pax-hero-top">
              <Avatar name={data.displayName} size="lg" />
              <div>
                <p className="pax-hero-name">{data.displayName}</p>
                <p className="pax-hero-sub">
                  {[data.grade ? `Grade ${data.grade}` : null, 'guardian-verified']
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            <div className="pax-hero-tiles">
              <div className="pax-tile"><b>🔥 {data.streak}</b><span>DAY STREAK</span></div>
              <div className="pax-tile">
                <b>{data.summary?.attempts ?? 0}</b><span>QUIZZES DONE</span>
              </div>
              <div className="pax-tile">
                <b>{Number.isFinite(Number(data.summary?.averageScore)) ?
                  `${Math.round(data.summary.averageScore)}%` : '—'}</b>
                <span>AVERAGE SCORE</span>
              </div>
            </div>
          </section>

          {/* The plan, on the screen a guardian lands on from the pill
              they just tapped. It reads the same facts the card does, so
              the two cannot disagree; without it, tapping "Free plan"
              led to a page that never mentioned a plan again. */}
          {plan && (
            <>
              <h2 className="lhx-set-head">Plan</h2>
              <div className="lhx-set-group">
                <div className="pax-planrow">
                  <span className="pax-planrow-main">
                    <span className={`pax-planrow-head pax-planrow-head-${plan.tone}`}>
                      {plan.headline}
                    </span>
                    <span className="pax-planrow-detail">{plan.detail}</span>
                  </span>
                  <span className="pax-planrow-cta">
                    <Link
                      className={`lhx-btn lhx-btn-sm ${plan.paid ? 'lhx-btn-soft' : 'lhx-btn-primary'}`}
                      to={plan.to}
                      aria-label={`${plan.cta} — ${name}`}
                    >
                      {plan.cta}
                    </Link>
                  </span>
                </div>
              </div>
            </>
          )}

          <h2 className="lhx-set-head">Subject progress</h2>
          <div className="lhx-set-group lhx-gz-pad">
            {subjects.length === 0 ? (
              <p className="lhx-gz-empty">
                Progress appears here once {name} starts a subject.
              </p>
            ) : subjects.map((s) => {
              const pct = Math.round(Number(s.percent ?? s.averageScore))
              return (
                <div className="lhx-gz-subj" key={s.subject || s.label}>
                  <span className="lhx-gz-lab">{s.label || s.subject}</span>
                  <span className="lhx-gz-bar">
                    <span className="lhx-track">
                      <span className="lhx-fill" style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                  <span className="lhx-gz-pct">{pct}%</span>
                </div>
              )
            })}
          </div>

          <h2 className="lhx-set-head">Needs a little help</h2>
          <div className="lhx-card lhx-gz-weak">
            {weak.length === 0 ? (
              <p className="lhx-gz-empty">
                Nothing stands out yet. Weak topics appear once {name} has
                answered enough questions on one for the pattern to mean
                something.
              </p>
            ) : (
              <>
                <p className="lhx-gz-weak-lead">From recent quizzes and past papers:</p>
                <div className="lhx-gz-chips">
                  {weak.slice(0, 6).map((w) => (
                    <span className="lhx-gz-chip" key={`${w.subject}|${w.topic}`}>
                      {w.topic}{w.subjectLabel ? ` · ${w.subjectLabel}` : ''}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="lhx-section-head">
            <h2 className="lhx-section-title">Recent activity</h2>
            <Link className="lhx-see-all" to={`/family/child/${childUid}/activity`}>See all →</Link>
          </div>
          {data.activity?.length > 0 ? (
            <ActivityTimeline days={data.activity.slice(0, 2)} />
          ) : (
            <p className="lhx-gz-empty">Nothing in the last week.</p>
          )}

          <h2 className="lhx-set-head">What {name} can do</h2>
          <ChildControls
            childUid={childUid}
            controls={data.controls}
            canEdit={can(data.role, 'setChildControls')}
            disabled={online === false}
            onChanged={load}
          />

          <h2 className="lhx-set-head">Guardians</h2>
          <div className="lhx-set-group">
            <Link className="lhx-set-row lhx-set-tap" to={`/family/sharing/${childUid}`}>
              <span className="lhx-set-ic" aria-hidden="true">🧑‍🤝‍🧑</span>
              <span className="lhx-set-txt">
                <span className="lhx-set-title">Family sharing</span>
                <span className="lhx-set-desc">
                  {data.guardians?.length === 1 ?
                    'You are the only guardian' :
                    `${data.guardians?.length} guardians`}
                  {can(data.role, 'manageGuardians') ? ' · invite another' : ''}
                </span>
              </span>
              <span className="lhx-set-chev" aria-hidden="true">›</span>
            </Link>
            <Link className="lhx-set-row lhx-set-tap" to={`/family/child/${childUid}/report`}>
              <span className="lhx-set-ic" aria-hidden="true">📈</span>
              <span className="lhx-set-txt">
                <span className="lhx-set-title">This week's report</span>
                <span className="lhx-set-desc">What went well and where to focus</span>
              </span>
              <span className="lhx-set-chev" aria-hidden="true">›</span>
            </Link>
          </div>

          <div style={{ height: 20 }} />
        </>
      )}
    </>
  )
}
