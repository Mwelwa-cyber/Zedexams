// src/features/learnerHome/pages/GuardianZonePage.jsx
//
// /guardian — the prototype-v7 Guardian Zone (learner redesign step 11):
// an adult friction gate, then a read-only dashboard over the child's own
// data plus the permission controls a guardian sets.
//
// Three things about what this is, because getting them wrong is how a
// parent ends up trusting something they should not:
//
//   1. It is a CONVENIENCE SURFACE, not an account. It runs inside the
//      child's session on the child's device. The authoritative guardian
//      identity is the verified guardian on the consent record, and the
//      zone only opens on an account that actually has one — otherwise
//      there is nobody whose dashboard this would be.
//   2. The sum is FRICTION, not authentication. It keeps a nine-year-old
//      out; nothing security-critical rests on it. See guardianGateCore.
//   3. The controls are enforced SERVER-SIDE and audited. Writing one
//      goes through the setGuardianControl callable (the field is on the
//      users self-update blocklist), turning one off is enforced at
//      consentGuard.assertLearnerCapability, and every change emails the
//      guardian. So the promise is "cannot change without you being
//      told", and the screen says exactly that rather than implying more.
//
// Everything shown is real: subject progress, the weak topics drawn from
// actual wrong answers, and the recent-activity feed all come from the
// dashboard view-model (with `extras`, which costs no additional reads).
// The mockup's "time this week" tile is not rendered, because ZedExams
// does not measure time on task and a plausible-looking "3h 20m" would be
// the one number on this screen a parent has no way to check.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import { useAuth } from '../../../contexts/AuthContext'
import useLearnerDashboard from '../hooks/useLearnerDashboard'
import useLearnerStats from '../../../hooks/useLearnerStats'
import useWeeklySummary from '../hooks/useWeeklySummary'
import { resolveLearnerAccess } from '../../../utils/guardianConsent'
import { GUARDIAN_CONTROLS, readGuardianControls } from '../../../utils/guardianControls'
import { buildGateQuestion, checkGateAnswer, gateStillValid } from '../lib/guardianGateCore'
import { relativeTime, firstNameOf } from '../lib/learnerHomeCore'
import { setGuardianControl } from '../services/guardianControlsService'
import LearnerIcon, { subjectIconName } from '../components/LearnerIcon'
import { ProgressBar, SectionSkeleton } from '../components/LearnerPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { capture } from '../../../utils/analytics'

const CHILDLINE = '116'

/* ── The adult check ────────────────────────────────────────────── */

function GuardianGate({ onPass, onBack }) {
  const [question, setQuestion] = useState(() => buildGateQuestion())
  const [value, setValue] = useState('')
  const [wrong, setWrong] = useState(false)

  const submit = (e) => {
    e.preventDefault()
    if (checkGateAnswer(question, value)) {
      capture('guardian_zone_opened')
      onPass()
      return
    }
    // A new question on every miss: retrying the same sum until it lands
    // is not a check, it is a delay.
    setQuestion(buildGateQuestion())
    setValue('')
    setWrong(true)
  }

  return (
    <>
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to Settings" onClick={onBack}>‹</button>
        <h1 className="lhx-back-title">Guardian Zone</h1>
      </div>
      <form className="lhx-gz-gate" onSubmit={submit}>
        <div className="lhx-gz-lock" aria-hidden="true">🔒</div>
        <h2>Ask a grown-up</h2>
        <p>This area is for parents and guardians. Please answer the question to continue.</p>
        <p className="lhx-gz-q">{question.prompt}</p>
        <input
          className="lhx-gz-input"
          inputMode="numeric"
          autoComplete="off"
          aria-label={question.prompt}
          aria-invalid={wrong || undefined}
          placeholder="?"
          value={value}
          onChange={(e) => { setValue(e.target.value); setWrong(false) }}
        />
        {wrong && <p className="lhx-gz-wrong" role="alert">Not quite — here is another one.</p>}
        <button type="submit" className="lhx-btn lhx-btn-primary lhx-gz-go">Continue</button>
        <p className="lhx-gz-note">
          Guardians can also manage everything from the approval email we sent.
        </p>
      </form>
    </>
  )
}

/* ── The dashboard ──────────────────────────────────────────────── */

function ControlRow({ control, value, busy, onChange }) {
  // `value` is three-valued: null means no guardian has decided, which
  // renders as ON (nothing is restricted) but is NOT recorded as a
  // decision until the parent actually makes one.
  const on = value !== false
  return (
    <div className="lhx-set-row">
      <span className="lhx-set-ic" aria-hidden="true">{control.icon}</span>
      <span className="lhx-set-txt">
        <span className="lhx-set-title">{control.label}</span>
        <span className="lhx-set-desc">{control.hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={control.label}
        disabled={busy}
        className="lhx-switch"
        onClick={() => onChange(!on)}
      />
    </div>
  )
}

function GuardianDashboard({ onExit }) {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const { loading, data } = useLearnerDashboard({ extras: true })
  const { stats, level } = useLearnerStats(currentUser?.uid)
  const week = useWeeklySummary(currentUser?.uid)

  const [controls, setControls] = useState(() => readGuardianControls(userProfile))
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)
  useEffect(() => { setControls(readGuardianControls(userProfile)) }, [userProfile])

  const childName = userProfile?.displayName || 'Your child'
  const firstName = firstNameOf(userProfile?.displayName) || 'your child'
  const activeTerm = data?.activeTerm?.term ?? null
  const streak = Number(stats?.currentStreak) || 0
  const subjects = (data?.subjects || []).filter((s) => s.hasMaterial)
  const weak = (data?.weakTopics || []).slice(0, 6)
  const now = Date.now()

  const change = useCallback(async (key, next) => {
    setBusy(key)
    setNotice(null)
    // Optimistic: the parent's tap must land, and the callable settles it.
    setControls((c) => ({ ...c, [key]: next }))
    try {
      const res = await setGuardianControl(key, next)
      setNotice(res?.notified
        ? 'Saved. We have emailed you a confirmation.'
        : 'Saved.')
    } catch (err) {
      setControls((c) => ({ ...c, [key]: next === true ? false : true }))
      setNotice(err?.message || 'We could not save that just now.')
    } finally {
      setBusy(null)
    }
  }, [])

  return (
    <>
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to the app" onClick={onExit}>‹</button>
        <h1 className="lhx-back-title" style={{ flex: 1 }}>Guardian Zone</h1>
        <span className="lhx-gz-tag">👤 Parent</span>
      </div>

      <section className="lhx-gz-hero" aria-label={`${childName}'s summary`}>
        <div className="lhx-gz-child">
          <span className="lhx-gz-cava" aria-hidden="true">{(firstName[0] || 'Z').toUpperCase()}</span>
          <div>
            <p className="lhx-gz-cname">{childName}</p>
            <p className="lhx-gz-csub">
              {[userProfile?.grade ? `Grade ${userProfile.grade}` : null, activeTerm ? `Term ${activeTerm}` : null, 'verified']
                .filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="lhx-gz-mini">
          <div className="lhx-gz-mtile"><b>🔥 {streak}</b><span>DAY STREAK</span></div>
          <div className="lhx-gz-mtile"><b>{week?.quizzes ?? 0}</b><span>QUIZZES THIS WEEK</span></div>
          <div className="lhx-gz-mtile"><b>Level {level?.level ?? 1}</b><span>PROGRESS</span></div>
        </div>
      </section>

      <h2 className="lhx-set-head">Subject progress</h2>
      <div className="lhx-set-group lhx-gz-pad">
        {loading ? (
          <SectionSkeleton lines={4} height={34} />
        ) : subjects.length === 0 ? (
          <p className="lhx-gz-empty">Nothing to show yet — progress appears once {firstName} starts a subject.</p>
        ) : subjects.map((s, i) => (
          <div className="lhx-gz-subj" key={s.id}>
            <span className="lhx-subject-icon lhx-tint-green lhx-gz-sicon" aria-hidden="true">
              <LearnerIcon name={subjectIconName(s.id)} size={15} />
            </span>
            <span className="lhx-gz-lab">{s.label}</span>
            <span className="lhx-gz-bar">
              <ProgressBar percent={s.percent} tone="var(--lhx-green)" label={`${s.label}: ${s.percent}% complete`} />
            </span>
            <span className="lhx-gz-pct">{s.percent}%</span>
            {i === -1 && null}
          </div>
        ))}
      </div>

      <h2 className="lhx-set-head">Needs a little help</h2>
      <div className="lhx-card lhx-gz-weak">
        {weak.length === 0 ? (
          <p className="lhx-gz-empty">
            No weak topics yet. They appear here once {firstName} has answered enough
            questions on a topic for the pattern to mean something.
          </p>
        ) : (
          <>
            <p className="lhx-gz-weak-lead">From recent quizzes and past papers:</p>
            <div className="lhx-gz-chips">
              {weak.map((w) => (
                <span className="lhx-gz-chip" key={`${w.subject}|${w.topic}`}>
                  {w.topic}
                  {w.subjectLabel ? ` · ${w.subjectLabel}` : ''}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <h2 className="lhx-set-head">Recent activity</h2>
      <div className="lhx-set-group lhx-gz-pad">
        {loading ? (
          <SectionSkeleton lines={3} height={30} />
        ) : (data?.recentActivity || []).length === 0 ? (
          <p className="lhx-gz-empty">Nothing in the last little while.</p>
        ) : data.recentActivity.map((item) => (
          <div className="lhx-gz-act" key={`${item.type}-${item.attemptId || item.sourceId}-${item.completedAt}`}>
            <span className="lhx-gz-adot" aria-hidden="true"><LearnerIcon name={item.icon || 'progress'} size={15} /></span>
            <span className="lhx-gz-atxt">
              {item.title}
              {item.score != null ? ` — ${item.score}%` : ''}
            </span>
            <span className="lhx-gz-atime">{relativeTime(item.completedAt, now)}</span>
          </div>
        ))}
      </div>

      <h2 className="lhx-set-head">What {firstName} can do</h2>
      <div className="lhx-set-group">
        {GUARDIAN_CONTROLS.map((c) => (
          <ControlRow
            key={c.key}
            control={c}
            value={controls[c.key]}
            busy={busy === c.key}
            onChange={(next) => change(c.key, next)}
          />
        ))}
      </div>
      <p className="lhx-gz-fineprint" role={notice ? 'status' : undefined}>
        {notice || (
          'Changes here are applied on our servers, so they hold even if the app is ' +
          'reinstalled — and we email you whenever one changes, because this zone ' +
          'sits on your child’s own device.'
        )}
      </p>

      <h2 className="lhx-set-head">Safety &amp; account</h2>
      <div className="lhx-set-group">
        <div className="lhx-set-row">
          <span className="lhx-set-ic" aria-hidden="true">✅</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Guardian consent</span>
            <span className="lhx-set-desc">Approved · full access</span>
          </span>
          <span className="lhx-set-val" style={{ color: 'var(--lhx-green-dark)' }}>Active</span>
        </div>
        <a className="lhx-set-row lhx-set-tap" href={`tel:${CHILDLINE}`}>
          <span className="lhx-set-ic" aria-hidden="true">☎️</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Get help</span>
            <span className="lhx-set-desc">Childline Zambia · {CHILDLINE}</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </a>
        <button type="button" className="lhx-set-row lhx-set-tap" onClick={() => navigate('/my-subscription')}>
          <span className="lhx-set-ic" aria-hidden="true">💳</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Subscription</span>
            <span className="lhx-set-desc">Plan, payments and renewals</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </button>
        <button type="button" className="lhx-set-row lhx-set-tap lhx-set-danger" onClick={() => navigate('/settings?section=account')}>
          <span className="lhx-set-ic" aria-hidden="true">🗑️</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Delete account</span>
            <span className="lhx-set-desc">Permanent — removes {firstName}’s work too</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </button>
      </div>

      <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" onClick={onExit}>
        ←&nbsp; Back to {firstName}’s app
      </button>
      <div style={{ height: 20 }} />
    </>
  )
}

/* ── Route ──────────────────────────────────────────────────────── */

export default function GuardianZonePage() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const [passedAt, setPassedAt] = useState(null)

  // The zone opens only where there IS a guardian: the same test the
  // profile chip and the Settings row use. Without one, the dashboard
  // would be a parent view with no parent behind it, and the controls
  // would have nobody to notify — which is what makes them meaningful.
  const guardianApproved = useMemo(
    () => resolveLearnerAccess(userProfile).reason === 'guardian-approved',
    [userProfile],
  )

  // The pass is component state, never storage: it must not survive the
  // parent handing the phone back.
  const open = gateStillValid(passedAt)

  // The zone reads as its own space — no learner tab bar, per the mockup.
  return (
    <div className="lhx">
      <div className="lhx-page">
        <SeoHelmet title="Guardian Zone · ZedExams" noindex />
        {!guardianApproved ? (
          <>
            <div className="lhx-back-row">
              <button type="button" className="lhx-back-btn" aria-label="Back to Settings" onClick={() => navigate('/settings')}>‹</button>
              <h1 className="lhx-back-title">Guardian Zone</h1>
            </div>
            <div className="lhx-card lhx-gz-none">
              <p>
                This account has no approved parent or guardian yet, so there is no
                Guardian Zone to open.
              </p>
              <p>
                Tap the banner on the home screen to send an approval message — the
                zone unlocks as soon as it is accepted.
              </p>
            </div>
          </>
        ) : open ? (
          <GuardianDashboard onExit={() => navigate('/dashboard')} />
        ) : (
          <GuardianGate onPass={() => setPassedAt(Date.now())} onBack={() => navigate('/settings')} />
        )}
      </div>
    </div>
  )
}
