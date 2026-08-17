/**
 * GuardianZonePage — /guardian, the parent/guardian area inside the child's app.
 *
 * Reached from the learner's Settings. It renders OUTSIDE the learner shell —
 * no bottom nav, no Ask Zed pill, no learner header — so it reads as a
 * different place rather than as a fifth tab of the child's app. That is the
 * prototype's decision and it is also the safer one: nothing here should look
 * like something a child is meant to browse.
 *
 * ── Three layers, and only one of them is a lock ─────────────────────────
 *
 *   1. The arithmetic gate. Friction. It keeps a child from wandering in and
 *      is not claimed to do more (see lib/parentalGateCore.js).
 *   2. Progress, visible once through the gate. It is the child's OWN data,
 *      read through the child's own session with the same hook the child's
 *      home page uses — so there is nothing here a determined child could not
 *      already see about themselves.
 *   3. The controls, behind a PIN whose setup code goes to the guardian's
 *      verified inbox and which is re-verified server-side on every write.
 *
 * The zone is a CONVENIENCE surface. The authoritative guardian identity is
 * the address the consent flow verified; this screen is bound to that address
 * through the code, and claims no more authority than that.
 *
 * ── One child, stated ───────────────────────────────────────────────────
 *
 * There is no child switcher, because this app has no guardian ACCOUNT to
 * switch within — the zone lives inside one learner's session, so it can only
 * ever be about that learner. A guardian with several children uses the
 * separate parent portal (/family), which does have a per-child view. Saying
 * so on screen beats a switcher with one entry in it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, LifeBuoy, ShieldCheck, Trash2, CreditCard } from 'lucide-react'
import '../../../shared/styles/learnerTheme.css'
import '../guardianZone.css'
import { useAuth } from '../../../contexts/AuthContext'
import useLearnerStats from '../../../hooks/useLearnerStats'
import { resolveLearnerAccess } from '../../../utils/guardianConsent'
import { normalizeGuardianControls } from '../../../utils/guardianControls'
import { useLearnerDashboard, useWeeklySummary, firstNameOf } from '../../learnerHome'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import ParentalGate from '../components/ParentalGate'
import GuardianPinPanel from '../components/GuardianPinPanel'
import GuardianControls from '../components/GuardianControls'
import { ChildSnapshot, SubjectProgress, WeakTopics, RecentActivity } from '../components/GuardianProgress'
import { fetchGuardianZoneStatus, guardianZoneErrorMessage } from '../services/guardianZoneService'

export default function GuardianZonePage() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const uid = currentUser?.uid || null

  const [passed, setPassed] = useState(false)
  // The PIN lives in memory for as long as this screen is mounted, and
  // nowhere else. Not localStorage, not sessionStorage: the device belongs to
  // the child, and a cached PIN is a readable PIN.
  const [pin, setPin] = useState('')
  const [status, setStatus] = useState(null)
  const [statusError, setStatusError] = useState('')

  const dash = useLearnerDashboard()
  const { stats, level } = useLearnerStats(uid)
  const week = useWeeklySummary(uid)

  // The status read is deferred until the gate is passed — a child who never
  // answers the sum never causes a call.
  useEffect(() => {
    if (!passed || !uid) return undefined
    let alive = true
    fetchGuardianZoneStatus()
      .then((s) => { if (alive) setStatus(s) })
      .catch((err) => { if (alive) setStatusError(guardianZoneErrorMessage(err)) })
    return () => { alive = false }
  }, [passed, uid])

  const access = useMemo(() => resolveLearnerAccess(userProfile), [userProfile])
  const controls = useMemo(
    () => normalizeGuardianControls(userProfile?.guardianControls),
    [userProfile],
  )
  // The page keeps its own copy after a save so the switches settle
  // immediately, rather than waiting for the profile listener to come round.
  const [savedControls, setSavedControls] = useState(null)
  const shown = savedControls || controls

  const childName = firstNameOf(userProfile?.displayName) || 'your learner'
  const subLine = [
    userProfile?.grade ? `Grade ${userProfile.grade}` : null,
    dash?.data?.activeTerm?.term ? `Term ${dash.data.activeTerm.term}` : null,
  ].filter(Boolean).join(' · ')

  const handleUnlocked = useCallback((value) => {
    setPin(value)
    setStatus((s) => ({ ...(s || {}), hasPin: true }))
  }, [])

  const exit = useCallback(() => navigate('/dashboard'), [navigate])

  if (!passed) {
    return (
      <div className="lhx">
        <div className="gz">
          <SeoHelmet title="Guardian Zone" description="Parent and guardian controls for a ZedExams learner account." path="/guardian" noIndex />
          <div className="lhx-back-row">
            <button type="button" className="lhx-back-btn" onClick={exit} aria-label="Back">
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
            <div className="lhx-back-title">Guardian Zone</div>
          </div>
          <ParentalGate onPass={() => setPassed(true)} />
        </div>
      </div>
    )
  }

  const weekCount = week.loading ? '—' : week.quizzes + week.games + week.topics

  return (
    <div className="lhx">
      <div className="gz">
        <SeoHelmet title="Guardian Zone" description="Parent and guardian controls for a ZedExams learner account." path="/guardian" noIndex />

        <div className="lhx-back-row">
          <button type="button" className="lhx-back-btn" onClick={exit} aria-label="Back to the learner app">
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <div style={{ flex: 1 }}>
            <div className="lhx-back-title">Guardian Zone</div>
            <div className="lhx-back-sub">For {childName}&apos;s parent or guardian</div>
          </div>
        </div>

        <ChildSnapshot
          name={userProfile?.displayName || childName}
          subLine={subLine}
          verified={access.reason === 'guardian-approved'}
          streak={Number(stats?.currentStreak) || 0}
          level={level || 1}
          weekCount={weekCount}
        />

        <SubjectProgress subjects={dash?.data?.subjects} />
        <WeakTopics topics={dash?.data?.weakTopics} />
        <RecentActivity items={dash?.data?.recentActivity} />

        {statusError
          ? <p className="gz-error" role="alert">{statusError}</p>
          : !pin && status && (
            <GuardianPinPanel
              status={status}
              onUnlocked={handleUnlocked}
              onStatusChange={(patch) => setStatus((s) => ({ ...(s || {}), ...patch }))}
            />
          )}

        <GuardianControls
          childName={childName}
          controls={shown}
          pin={pin}
          onSaved={setSavedControls}
        />

        <div className="gz-head">Safety &amp; account</div>
        <div className="gz-group">
          <div className="gz-row">
            <div className="gz-ic"><ShieldCheck size={19} aria-hidden="true" /></div>
            <div className="gz-row-main">
              <div className="gz-row-title">Guardian consent</div>
              <div className="gz-row-desc">
                {access.reason === 'guardian-approved'
                  ? 'Approved — full access'
                  : 'Not yet approved — this account is in limited mode'}
              </div>
            </div>
            <div className={`gz-row-val${access.reason === 'guardian-approved' ? ' is-ok' : ''}`}>
              {access.reason === 'guardian-approved' ? 'Active' : 'Pending'}
            </div>
          </div>

          <a className="gz-row" href="tel:116">
            <div className="gz-ic"><LifeBuoy size={19} aria-hidden="true" /></div>
            <div className="gz-row-main">
              <div className="gz-row-title">Get help</div>
              <div className="gz-row-desc">Childline Zambia · 116 · free and confidential</div>
            </div>
          </a>

          <button type="button" className="gz-row" onClick={() => navigate('/my-subscription')}>
            <div className="gz-ic"><CreditCard size={19} aria-hidden="true" /></div>
            <div className="gz-row-main">
              <div className="gz-row-title">Subscription</div>
              <div className="gz-row-desc">Plan, payments and invoices</div>
            </div>
          </button>

          <button type="button" className="gz-row gz-danger" onClick={() => navigate('/settings/account')}>
            <div className="gz-ic"><Trash2 size={19} aria-hidden="true" /></div>
            <div className="gz-row-main">
              <div className="gz-row-title">Delete this account</div>
              <div className="gz-row-desc">Permanent. Removes every record we hold.</div>
            </div>
          </button>
        </div>

        <p className="gz-note">
          This zone covers the account you are signed in on. A guardian following
          more than one child uses the parent portal, which has a view per child.
        </p>

        <button type="button" className="lhx-btn lhx-btn-soft" onClick={exit}>
          ← Back to {childName}&apos;s app
        </button>
      </div>
    </div>
  )
}
