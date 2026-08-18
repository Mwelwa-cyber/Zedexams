/**
 * LearnerSetupPage — the prototype's first-run setup wizard, and only that.
 *
 *   pick grade → pick subjects → Meet Zed → notification ask
 *
 * with the four-dot progress bar the mockup draws across all four screens.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. The prototype's onboarding also has a
 * welcome screen, a role picker, an age gate, a guardian-email step and the
 * sign-in/sign-up forms. Every one of those already exists in this app, and
 * the middle three are the Play-Families compliance path — the neutral age
 * gate sits in front of BOTH sign-up methods, its answer is locked to the
 * device for 24 hours, and the rule lives in `signupFlowCore.resolveStep`
 * with a plain-node test behind it. Rebuilding them to match a mockup would
 * mean re-deciding a compliance guarantee as a side effect of a visual
 * redesign, so this wizard starts where that flow ends: an account exists.
 *
 * The chrome is hidden here (no bottom nav, no header) per the mockup —
 * setup is not somewhere you tab away from half-done.
 */
import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../onboarding.css'
import { useAuth } from '../../../contexts/AuthContext'
import { LEARNER_GRADES, getGradeSubjects } from '../../../config/curriculum'
import { normalizeNotificationPrefs } from '../../../engines/notification-engine/notificationPrefs'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { capture } from '../../../utils/analytics'
import {
  SETUP_STEP, SETUP_STEPS, resolveSetupStep, stepIndex, nextStep, prevStep,
  canAdvance, buildSetupPatch, normalizeGrade,
} from '../lib/setupWizardCore'

export default function LearnerSetupPage() {
  const { userProfile, updateProfileFields } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [grade, setGrade] = useState(() => normalizeGrade(userProfile?.grade, LEARNER_GRADES))
  const [subjects, setSubjects] = useState(() =>
    Array.isArray(userProfile?.learnerSubjects) ? userProfile.learnerSubjects : [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // The URL proposes; resolveSetupStep decides. Same contract as the sign-up
  // flow: a deep link, a refresh and the back button all go through one rule.
  const step = resolveSetupStep({ requested: params.get('step'), grade })

  const goto = useCallback((next) => {
    if (!next) return
    const p = new URLSearchParams(params)
    p.set('step', next)
    setParams(p)
  }, [params, setParams])

  // Subject chips come from the grade the learner just picked, so the list
  // changes under them as it should — and it is the same accessor Home and
  // the Notes hub read, not a second hand-kept list.
  const gradeSubjects = useMemo(() => (grade ? getGradeSubjects(grade) : []), [grade])

  const toggleSubject = (id) => setSubjects((prev) =>
    prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id])

  const finish = useCallback(async (wantsReminders) => {
    setSaving(true)
    setError('')
    try {
      const patch = buildSetupPatch({
        grade,
        // A subject list identical to the whole grade carries no information
        // — store it as "no narrowing" so a later curriculum change is picked
        // up rather than frozen at whatever the catalogue held today.
        subjects: subjects.length === gradeSubjects.length ? [] : subjects,
        wantsReminders,
        currentPrefs: normalizeNotificationPrefs(userProfile?.notificationPrefs),
      })
      await updateProfileFields(patch)
      capture('learner_setup_completed', {
        grade,
        subjectCount: subjects.length,
        reminders: wantsReminders,
      })
      navigate('/dashboard', { replace: true })
    } catch {
      // Never strand a child on a dead screen: the wizard's whole job is one
      // profile write, so the only honest recovery is to offer it again.
      setError('We couldn’t save that. Check your connection and try again.')
      setSaving(false)
    }
  }, [grade, subjects, gradeSubjects.length, userProfile, updateProfileFields, navigate])

  const back = prevStep(step)
  const index = stepIndex(step)

  return (
    <div className="lhx">
      <SeoHelmet title="Set up your account" path="/setup" noIndex />
      <div className="lhx-ob">
        <div className="lhx-ob-body">
          {back && (
            <div className="lhx-back-row">
              <button type="button" className="lhx-back-btn" onClick={() => goto(back)} aria-label="Back">‹</button>
              <div className="lhx-back-title">Set up</div>
            </div>
          )}

          <ol className="lhx-ob-steps" aria-label={`Step ${index + 1} of ${SETUP_STEPS.length}`}>
            {SETUP_STEPS.map((s, i) => (
              <li key={s} className={`lhx-ob-step${i <= index ? ' is-on' : ''}`} />
            ))}
          </ol>

          {error && <div className="lhx-ob-error" role="alert">{error}</div>}

          {step === SETUP_STEP.GRADE && (
            <>
              <h1 className="lhx-ob-title">What grade are you in?</h1>
              <p className="lhx-ob-sub">We’ll show only your grade’s lessons, papers and games.</p>
              <div className="lhx-ob-grades">
                {LEARNER_GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className="lhx-ob-grade"
                    aria-pressed={grade === g}
                    onClick={() => setGrade(g)}
                  >
                    Grade {g}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === SETUP_STEP.SUBJECTS && (
            <>
              <h1 className="lhx-ob-title">Pick your subjects</h1>
              <p className="lhx-ob-sub">
                Choose the ones you’re taking. You can change these any time.
              </p>
              <ul className="lhx-ob-subjects">
                {gradeSubjects.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="lhx-ob-subject"
                      aria-pressed={subjects.includes(s.id)}
                      onClick={() => toggleSubject(s.id)}
                    >
                      <span aria-hidden="true">{s.icon}</span>
                      {s.label}
                      <span className="lhx-ob-check" aria-hidden="true">✓</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {step === SETUP_STEP.ZED && (
            <>
              <div className="lhx-ob-hero">
                <img src="/images/characters/poses/zed-waving.webp" alt="" width="118" height="118" />
              </div>
              <h1 className="lhx-ob-title" style={{ textAlign: 'center' }}>Meet Zed 👋</h1>
              <p className="lhx-ob-sub" style={{ textAlign: 'center' }}>
                I’m your study buddy! I host your daily quiz, cheer you on, and explain
                anything you’re stuck on. Tap me any time you need help.
              </p>
            </>
          )}

          {step === SETUP_STEP.NOTIFICATIONS && (
            <>
              <div className="lhx-ob-hero">
                <div className="lhx-ob-emoji" aria-hidden="true">🔔</div>
              </div>
              <h1 className="lhx-ob-title" style={{ textAlign: 'center' }}>Stay on track</h1>
              <p className="lhx-ob-sub" style={{ textAlign: 'center' }}>
                Want a gentle daily reminder to keep your streak and get ready for exams?
                You choose — and can change it any time in Settings.
              </p>
            </>
          )}
        </div>

        {/* The footer is the only place the wizard moves forward from, so the
            enabled/disabled state has exactly one source. */}
        {step === SETUP_STEP.NOTIFICATIONS ? (
          <div>
            <button
              type="button"
              className="lhx-ob-btn lhx-ob-btn-primary"
              disabled={saving}
              onClick={() => finish(true)}
            >
              {saving ? 'Saving…' : 'Yes, remind me'}
            </button>
            <button
              type="button"
              className="lhx-ob-btn lhx-ob-btn-ghost"
              disabled={saving}
              onClick={() => finish(false)}
            >
              Not now
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="lhx-ob-btn lhx-ob-btn-primary"
            disabled={!canAdvance(step, { grade })}
            onClick={() => goto(nextStep(step))}
          >
            {step === SETUP_STEP.ZED ? 'Nice to meet you!' : 'Continue'}
          </button>
        )}
      </div>
    </div>
  )
}
