// src/features/learnerSettings/pages/DeleteAccountPage.jsx
//
// /settings/delete — the child's side of deleting an account.
//
// Built to docs/learner/zedexams-profile-delete-mockup.html, screens 2–4, on
// top of the state machine in functions/deletionFlow/. Three steps, and then a
// fourth screen for a request that already exists.
//
// ── Step 1 is an off-ramp, not a dark pattern ──────────────────────────
//
// Most children who press Delete want one of the lighter exits: the
// notifications to stop, the streak pressure to stop, or a copy of their work.
// Those come FIRST because they are usually the real request — but "Continue
// to delete" is on the same screen, one tap away, in danger styling. Ordering
// the gentler options first is help; hiding the real one would be the dark
// pattern that ordering is usually used for.
//
// ── The screen never claims more than the server will do ───────────────
//
// What happens next depends on who is asking, and the CLIENT DOES NOT DECIDE
// IT — `requestAccountDeletion` returns the state the server opened, and this
// screen renders that. An adult goes straight to a 30-day window; a child with
// a guardian waits on them; a child with no guardian goes to support. Guessing
// here and being wrong would mean telling a child "we'll ask your mum" when
// nobody was asked, which is the exact failure the old screen had.
//
// ── The escape hatch is the load-bearing part ──────────────────────────
//
// "Not your grown-up? Tell us instead" routes to SUPPORT, never to the linked
// guardian, and flags the link for a human to look at. A child who needs out
// of a link with the wrong adult must never be made to ask that adult for
// permission — and must not have that adult told they asked. It is on every
// step from 2 onwards, with Childline Zambia 116: present, not preachy.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import { useAuth } from '../../../contexts/AuthContext'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import PageLoader from '../../../shared/components/PageLoader'
import { ContactDialog } from '../../marketing'
import { downloadMyData } from '../panels/AccountPanel'
import {
  DELETION_STATE,
  cancelDeletionRequest,
  getDeletionRequest,
  reportWrongGuardian,
  requestAccountDeletion,
} from '../../../services/accountDeletion/deletionRequestService'

const CHILDLINE = '116'

/**
 * What is KEPT.
 *
 * The Deleted list comes from the server so the child and the guardian read
 * the same words — the mockups are explicit that they must, because a guardian
 * shown a gentler list than their child was is consenting to something they
 * have not been told.
 *
 * This one is stated here and is deliberately narrow. The design says payment
 * receipts are retained for accounting; today the purge deletes `payments` and
 * `invoices` along with everything else (functions/accountDeletion.js), so
 * claiming retention would be a promise the code does not keep. When that
 * accounting decision is made, this is the line that changes.
 */
const KEPT = ['Nothing that identifies you stays behind.']

function SafetyFooter({ onTellUs }) {
  return (
    <p className="lhx-del-safe">
      <button type="button" className="lhx-del-link" onClick={onTellUs}>
        Not your grown-up? Tell us instead
      </button>
      <br />
      Worried about something? Call{' '}
      <a href={`tel:${CHILDLINE}`}>Childline Zambia {CHILDLINE}</a> — it&apos;s free.
    </p>
  )
}

function List({ tone, title, items }) {
  return (
    <div className={`lhx-del-list lhx-del-list--${tone}`}>
      <b>{title}</b>
      <ul>{items.map((line) => <li key={line}>{line}</li>)}</ul>
    </div>
  )
}

/** A date a child can read, not an ISO string. */
function formatDate(ms) {
  if (!ms) return null
  try {
    return new Date(ms).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch { return null }
}

export default function DeleteAccountPage() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()

  const [loading, setLoading] = useState(true)
  const [existing, setExisting] = useState(null)
  const [meta, setMeta] = useState({ deletedSummary: [], graceDays: 30, guardianResponseDays: 7 })
  const [step, setStep] = useState(1)
  const [contact, setContact] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await getDeletionRequest()
      setExisting(res?.request || null)
      if (res?.deletedSummary) {
        setMeta({
          deletedSummary: res.deletedSummary,
          graceDays: res.graceDays ?? 30,
          guardianResponseDays: res.guardianResponseDays ?? 7,
        })
      }
    } catch {
      // A read that fails must not strand the child on a spinner. They can
      // still walk the flow; the server refuses a duplicate on its own.
      setExisting(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const ask = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const out = await requestAccountDeletion()
      await refresh()
      setStep(3)
      if (out?.alreadyOpen) setToast('You had already asked — here is that request.')
    } catch (err) {
      setError(err?.message || 'We could not send that. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async () => {
    if (busy || !existing?.id) return
    setBusy(true)
    setError('')
    try {
      await cancelDeletionRequest(existing.id)
      await refresh()
      setStep(1)
      setToast('Your request is cancelled. Your account is staying.')
    } catch (err) {
      setError(err?.message || 'We could not cancel that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const tellUs = async () => {
    setContact('learner-delete-wrong-guardian')
    // Raise the flag server-side as well as opening the form, so a child who
    // closes the dialog without typing anything has still been heard.
    try { await reportWrongGuardian('') } catch { /* the form is the backup */ }
  }

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  if (loading) return <PageLoader />

  const deleted = meta.deletedSummary.length ? meta.deletedSummary : [
    'Your profile and picture', 'Your notes and saved work',
    'Your results and your streak', 'Your badges and stickers',
    'Your place on the leaderboard',
  ]

  const back = () => (step === 1 ? navigate('/settings') : setStep(step - 1))

  /* ── An open request replaces the whole flow ──────────────────────── */
  if (existing) {
    return (
      <>
        <SeoHelmet title="Delete account" path="/settings/delete" noIndex />
        <div className="lhx-back-row">
          <button type="button" className="lhx-back-btn" aria-label="Back to Settings" onClick={() => navigate('/settings')}>‹</button>
          <div className="lhx-back-title">Your request</div>
        </div>
        <OpenRequest
          request={existing}
          meta={meta}
          busy={busy}
          onWithdraw={withdraw}
          onTellUs={tellUs}
        />
        {error && <p className="lhx-av-error" role="alert">{error}</p>}
        {toast && <p className="lhx-av-toast" role="status">✓ {toast}</p>}
        <ContactDialog open={!!contact} source={contact || 'learner-delete'} onClose={() => setContact(null)} />
      </>
    )
  }

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
              onClick={() => downloadMyData(currentUser, userProfile, (_tone, msg) => setToast(msg))}
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
              Have a read of what happens first — it takes about a minute.
            </p>
            <button type="button" className="lhx-btn lhx-btn-block lhx-del-btn" onClick={() => setStep(2)}>
              Continue to delete
            </button>
            <button type="button" className="lhx-btn lhx-btn-block lhx-btn-soft" onClick={() => navigate('/settings')}>
              Keep my account
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <List tone="gone" title="Deleted" items={deleted} />
          <List tone="kept" title="Kept" items={KEPT} />

          <div className="lhx-del-list lhx-del-list--warn">
            <b>You get {meta.graceDays} days to change your mind</b>
            <ul>
              <li>
                Nothing is deleted straight away. Your account keeps working for{' '}
                {meta.graceDays} days, and signing in brings it back.
              </li>
            </ul>
          </div>

          {/* We say "we will ask" WITHOUT naming who, because at this point we
              do not know. The server decides when the request is made — and a
              screen that promised a guardian who turns out not to be linked
              would be lying to a child at the worst moment. */}
          <div className="lhx-del-list lhx-del-list--info">
            <b>What happens when you ask</b>
            <ul>
              <li>
                If you have a grown-up on ZedExams, we ask them first — you can cancel
                any time before they answer.
              </li>
              <li>
                If they don&apos;t answer within {meta.guardianResponseDays} days, our team
                takes over and helps you.
              </li>
              <li>If you don&apos;t have a grown-up on here, our team handles it.</li>
            </ul>
          </div>

          {error && <p className="lhx-av-error" role="alert">{error}</p>}

          <div className="lhx-av-card">
            <div style={{ display: 'grid', gap: 9 }}>
              <button
                type="button"
                className="lhx-btn lhx-btn-block lhx-del-btn"
                onClick={ask}
                disabled={busy}
              >
                {busy ? 'Sending…' : 'Ask to delete my account'}
              </button>
              <button
                type="button"
                className="lhx-btn lhx-btn-block lhx-btn-primary"
                onClick={() => navigate('/settings')}
                disabled={busy}
              >
                Keep my account
              </button>
            </div>
          </div>

          <SafetyFooter onTellUs={tellUs} />
        </>
      )}

      <ContactDialog open={!!contact} source={contact || 'learner-delete'} onClose={() => setContact(null)} />
    </>
  )
}

/**
 * Step 3, and every visit after it: what is happening now.
 *
 * Each state gets its own words, because "we sent it" is not what a child
 * needs to read three days later. A request that shows the same screen forever
 * is one a child assumes was never received — which is how they end up asking
 * again, or asking somebody else.
 */
function OpenRequest({ request, meta, busy, onWithdraw, onTellUs }) {
  const asked = request.requestedAt ? formatDate(request.requestedAt) : null
  const deleteOn = formatDate(request.scheduledDeleteAt)

  const views = {
    [DELETION_STATE.PENDING_GUARDIAN]: {
      pill: 'WAITING',
      title: 'We asked your grown-up',
      body: (
        <>
          <p className="lhx-del-intro" style={{ marginTop: 0 }}>
            <b>Nothing has been deleted.</b> We sent your grown-up a message
            {asked ? ` on ${asked}` : ''} and we are waiting for them to answer.
          </p>
          <p className="lhx-del-intro">
            If they don&apos;t answer within {meta.guardianResponseDays} days, our team
            takes over and helps you — you will not be left waiting forever.
          </p>
        </>
      ),
      cancel: 'Cancel this request',
    },
    [DELETION_STATE.SCHEDULED]: {
      pill: `${meta.graceDays} DAYS`,
      title: 'Your account is going',
      body: (
        <>
          <p className="lhx-del-intro" style={{ marginTop: 0 }}>
            {deleteOn
              ? <>It is deleted for good on <b>{deleteOn}</b>.</>
              : <>It is deleted for good in about {meta.graceDays} days.</>}
            {' '}Until then everything is paused, not gone — your streak is frozen
            where it was.
          </p>
          <p className="lhx-del-intro">Changed your mind? One tap brings it all back.</p>
        </>
      ),
      cancel: 'Keep my account after all',
    },
    [DELETION_STATE.ESCALATED_SUPPORT]: {
      pill: 'WITH OUR TEAM',
      title: 'A person is handling this',
      body: (
        <p className="lhx-del-intro" style={{ marginTop: 0 }}>
          <b>Nothing has been deleted.</b> Someone on our team is looking at your
          request and will sort it out. You do not need to do anything else.
        </p>
      ),
      cancel: 'Cancel this request',
    },
  }

  const view = views[request.state]
  // A state with no view would render an empty screen, which is the worst
  // possible answer to "what happened to my request". `test:deletion-state-mirror`
  // exists to stop that reaching production; this is the seatbelt behind it.
  if (!view) {
    return (
      <div className="lhx-av-card">
        <div className="lhx-av-bigname">Your request is being handled</div>
        <p className="lhx-del-intro">
          Nothing has been deleted. If you are not sure what is happening, our team can tell you.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="lhx-av-card">
        <span className="lhx-del-pill">{view.pill}</span>
        <div className="lhx-av-bigname">{view.title}</div>
        {view.body}
        <button
          type="button"
          className="lhx-btn lhx-btn-block lhx-btn-primary"
          onClick={onWithdraw}
          disabled={busy}
          style={{ marginTop: 12 }}
        >
          {busy ? 'Working…' : view.cancel}
        </button>
      </div>

      <SafetyFooter onTellUs={onTellUs} />
    </>
  )
}
