// src/features/learnerSettings/pages/DeleteAccountPage.jsx
//
// /settings/delete — deleting your account, on its own route.
//
// Built to docs/learner/zedexams-profile-delete-mockup.html, screens 2–3, with
// one deliberate difference of substance that is explained below.
//
// ── What this screen is honest about ───────────────────────────────────────
//
// The mockup's flow asks a guardian first and then holds the account for 30
// days. That flow needs a server state machine (`deletionRequests`, the 7-day
// escalation, the 30-day grace, the restore path) which DOES NOT EXIST YET. So
// this screen does not claim it. Until the state machine lands, deleting is
// immediate and permanent, and every sentence here says so.
//
// This is not a smaller version of the designed flow — it is the current
// behaviour described accurately. The Settings index used to advertise
// "Guardian approval required" on a row that led to a type-DELETE-and-it-is-
// gone confirmation, which is the worst of both: a child who trusted the label
// believed their grown-up would be asked, and nobody was.
//
// ── Step 1 is an off-ramp, not a dark pattern ──────────────────────────────
//
// Most children who press Delete want one of the lighter exits: the
// notifications to stop, the streak pressure to stop, or a copy of their work.
// Those come FIRST because they are usually the real request — but "Continue to
// delete" is on the same screen, one tap away, in danger styling. Burying it
// would be the dark pattern the ordering is often used for.
//
// ── The escape hatch is the load-bearing part ──────────────────────────────
//
// "Not your grown-up? Tell us instead" routes to SUPPORT and never to a linked
// guardian. A child who needs out of a link with the wrong adult must never be
// made to ask that adult for permission. It is on every step, along with
// Childline Zambia 116 — present, not preachy.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import { useAuth } from '../../../contexts/AuthContext'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { ContactDialog } from '../../marketing'
import { deleteMyAccount, pickReauthMethod } from '../../../utils/accountService'
import { canSubmitDeletion, deletionErrorMessage } from '../../../utils/accountReauth'
import { downloadMyData } from '../panels/AccountPanel'

const CHILDLINE = '116'

/**
 * What goes and what stays, in one place, so the two screens that show it can
 * never word it differently. When the guardian flow lands, the guardian's
 * decision screen shows this same list — the mockup is explicit that the child
 * and the adult must read the same words.
 */
const DELETED = [
  'Your profile and picture',
  'Your notes and saved work',
  'Your results and your streak',
  'Your badges and stickers',
  'Your place on the leaderboard',
  'Your link to your grown-up',
]

/**
 * Payment receipts are listed as KEPT in the design, because a business is
 * normally required to retain financial records. Today the purge deletes
 * `payments` and `invoices` along with everything else
 * (functions/accountDeletion.js), so this screen says what the code does rather
 * than what the design says — an accounting decision has to be made before that
 * behaviour changes, and a screen must not promise retention that is not
 * happening.
 */
const KEPT = [
  'Nothing that identifies you stays behind.',
]

function SafetyFooter({ onTellUs }) {
  return (
    <p className="lhx-del-safe">
      <button type="button" className="lhx-del-link" onClick={onTellUs}>
        Not your grown-up? Tell us instead
      </button>
      <br />
      Worried about something? Call <a href={`tel:${CHILDLINE}`}>Childline Zambia {CHILDLINE}</a> — it&apos;s free.
    </p>
  )
}

export default function DeleteAccountPage() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()

  const [step, setStep] = useState(1)
  const [contact, setContact] = useState(null)
  const [confirmText, setConfirmText] = useState('')
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const reauthMethod = pickReauthMethod(currentUser?.providerData)
  const confirmed = confirmText.trim().toUpperCase() === 'DELETE'
  const canDelete = canSubmitDeletion({ method: reauthMethod, password, confirmed })

  const runDelete = async () => {
    if (!canDelete || deleting) return
    setDeleting(true)
    setError('')
    try {
      await deleteMyAccount({ password })
      navigate('/', { replace: true })
    } catch (err) {
      setError(deletionErrorMessage(err))
      setDeleting(false)
    }
  }

  const back = () => (step === 1 ? navigate('/settings') : setStep(step - 1))

  return (
    <>
      <SeoHelmet title="Delete account" path="/settings/delete" noIndex />

      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back" onClick={back}>‹</button>
        <div className="lhx-back-title">{step === 1 ? 'Before you go' : 'What happens'}</div>
      </div>

      {step === 1 && (
        <>
          <p className="lhx-del-intro">
            Deleting is not the only way to get some peace. One of these might be what you
            actually want — and none of them lose your work.
          </p>

          <div className="lhx-set-group">
            <button type="button" className="lhx-set-row" onClick={() => navigate('/settings/notifications')}>
              <span className="lhx-set-ic" aria-hidden="true">🔕</span>
              <span className="lhx-set-txt">
                <span className="lhx-set-title">Turn off notifications</span>
                <span className="lhx-set-desc">We&apos;ll stop reminding you</span>
              </span>
              <span className="lhx-set-chev" aria-hidden="true">›</span>
            </button>
            <button type="button" className="lhx-set-row" onClick={() => navigate('/settings/learning')}>
              <span className="lhx-set-ic" aria-hidden="true">⏸️</span>
              <span className="lhx-set-txt">
                <span className="lhx-set-title">Take a break</span>
                <span className="lhx-set-desc">Turn the daily goal off — your badges stay</span>
              </span>
              <span className="lhx-set-chev" aria-hidden="true">›</span>
            </button>
            <button
              type="button"
              className="lhx-set-row"
              onClick={() => {
                downloadMyData(currentUser, userProfile, (_tone, msg) => setToast(msg))
              }}
            >
              <span className="lhx-set-ic" aria-hidden="true">⬇️</span>
              <span className="lhx-set-txt">
                <span className="lhx-set-title">Download my work first</span>
                <span className="lhx-set-desc">A copy of everything, saved to this device</span>
              </span>
              <span className="lhx-set-chev" aria-hidden="true">›</span>
            </button>
          </div>

          {toast && <p className="lhx-av-toast" role="status">✓ {toast}</p>}

          <div className="lhx-del-danger">
            <div className="lhx-del-danger-title">Still want to delete?</div>
            <p className="lhx-del-danger-body">
              This one cannot be undone. Have a read of what happens first.
            </p>
            <button type="button" className="lhx-btn lhx-btn-block lhx-del-btn" onClick={() => setStep(2)}>
              Continue to delete
            </button>
            <button type="button" className="lhx-btn lhx-btn-block lhx-btn-soft" onClick={() => navigate('/settings')}>
              Keep my account
            </button>
          </div>

          <SafetyFooter onTellUs={() => setContact('learner-delete-wrong-guardian')} />
        </>
      )}

      {step === 2 && (
        <>
          <div className="lhx-del-list lhx-del-list--gone">
            <b>Deleted</b>
            <ul>{DELETED.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>

          <div className="lhx-del-list lhx-del-list--kept">
            <b>Kept</b>
            <ul>{KEPT.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>

          {/* No 30-day grace exists yet, so none is offered. */}
          <div className="lhx-del-list lhx-del-list--warn">
            <b>This happens straight away</b>
            <ul>
              <li>
                Your account is deleted the moment you confirm. There is no waiting
                period and no way to bring it back.
              </li>
            </ul>
          </div>

          <div className="lhx-av-card">
            <p className="lhx-del-intro" style={{ marginTop: 0 }}>
              To be sure it&apos;s really you, type <b>DELETE</b>
              {reauthMethod === 'password' ? ' and enter your password.' : ' — then confirm with Google.'}
            </p>

            <label className="lhx-av-field" htmlFor="lhx-del-confirm">
              <span className="lhx-av-flabel">Type DELETE</span>
              <input
                id="lhx-del-confirm"
                className="lhx-av-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                disabled={deleting}
                autoComplete="off"
              />
            </label>

            {reauthMethod === 'password' && (
              <label className="lhx-av-field" htmlFor="lhx-del-pw">
                <span className="lhx-av-flabel">Your password</span>
                <input
                  id="lhx-del-pw"
                  className="lhx-av-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={deleting}
                />
              </label>
            )}

            {error && <p className="lhx-av-error" role="alert">{error}</p>}

            <div style={{ marginTop: 14, display: 'grid', gap: 9 }}>
              <button
                type="button"
                className="lhx-btn lhx-btn-block lhx-del-btn"
                onClick={runDelete}
                disabled={!canDelete || deleting}
              >
                {deleting ? 'Deleting…' : 'Delete my account'}
              </button>
              <button
                type="button"
                className="lhx-btn lhx-btn-block lhx-btn-primary"
                onClick={() => navigate('/settings')}
                disabled={deleting}
              >
                Keep my account
              </button>
            </div>
          </div>

          <SafetyFooter onTellUs={() => setContact('learner-delete-wrong-guardian')} />
        </>
      )}

      {/* Support, never the guardian. */}
      <ContactDialog open={!!contact} source={contact || 'learner-delete'} onClose={() => setContact(null)} />
    </>
  )
}
