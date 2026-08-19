/**
 * ParentDeletionRequest — /family/requests/:requestId
 *
 * Built to docs/learner/zedexams-guardian-delete-mockup.html, screens 3–5.
 *
 * ── The screen's job is to make the decision INFORMED, not fast ────────
 *
 * A parent woken at 23:15 by a push about their child's account should not be
 * deciding blind, so the child's streak, exam readiness and days-to-exam are
 * the first thing on it. But every one of those is an argument for saying no,
 * which is why the note beside them is generated server-side and SUPPRESSED
 * when the child genuinely is inactive (`decisionContextCore`, node-tested).
 * A screen that manufactures arguments is not informing anybody.
 *
 * ── Three actions, weighted on purpose ─────────────────────────────────
 *
 * "Talk to them first" is the honest middle option most flows leave out: it
 * parks the request without answering, and tells the child their grown-up
 * wants to chat. It deliberately does NOT stop the seven-day clock — a parent
 * who parks and forgets is, from the child's side, one who ignored it.
 *
 * "Keep their account" is the visually dominant choice and "Approve deletion"
 * is deliberately quiet. That is not a dark pattern in reverse: approving is
 * irreversible after thirty days and keeping is not, so the loud button is the
 * one whose mistake is recoverable.
 *
 * ── Hold to confirm, not type DELETE ───────────────────────────────────
 *
 * Typing a word is a developer's idea of friction. A hold works one-handed on
 * a phone, on a slow connection, and for a parent who is not a confident
 * typer — which is most of the audience this product was built for.
 *
 * ── The same words the child read ──────────────────────────────────────
 *
 * The Deleted list comes from the server, from the same constant the child's
 * screen renders. A guardian shown a gentler list than their child was is
 * consenting to something they have not been told.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BackRow, ListSkeleton, ErrorRetry } from '../components/ParentPrimitives'
import {
  DELETION_STATE,
  cancelDeletionRequest,
  getDeletionRequest,
  respondToDeletionRequest,
} from '../../../services/accountDeletion/deletionRequestService'
import { reportClientError } from '../../../utils/clientErrorReporting'

/** How long the confirm button must be held. */
const HOLD_MS = 1600

function formatDate(ms) {
  if (!ms) return null
  try {
    return new Date(ms).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch { return null }
}

/**
 * Hold-to-confirm. The progress bar is the affordance — a button that fills
 * tells you it is doing something and how much longer, where one that simply
 * waits reads as broken.
 */
function HoldToConfirm({ label, onConfirm, disabled }) {
  const [progress, setProgress] = useState(0)
  const raf = useRef(null)
  const start = useRef(0)

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = null
    setProgress(0)
  }, [])

  const tick = useCallback(() => {
    const elapsed = Date.now() - start.current
    const pct = Math.min(1, elapsed / HOLD_MS)
    setProgress(pct)
    if (pct >= 1) {
      stop()
      onConfirm()
      return
    }
    raf.current = requestAnimationFrame(tick)
  }, [onConfirm, stop])

  const begin = (e) => {
    if (disabled) return
    e.preventDefault()
    start.current = Date.now()
    raf.current = requestAnimationFrame(tick)
  }

  useEffect(() => stop, [stop])

  return (
    <button
      type="button"
      className="pax-hold"
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // A pointer hold is unusable with a keyboard or a switch device, so the
      // keyboard path is a plain confirm rather than a hold nobody can perform.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (!disabled && window.confirm(`${label}?`)) onConfirm()
        }
      }}
    >
      <span className="pax-hold-fill" style={{ width: `${Math.round(progress * 100)}%` }} aria-hidden="true" />
      <span className="pax-hold-label">{label}</span>
    </button>
  )
}

export default function ParentDeletionRequest() {
  const { requestId } = useParams()
  const navigate = useNavigate()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await getDeletionRequest(requestId)
      setData(res?.request ? res : null)
    } catch (err) {
      reportClientError(err, 'deletionFlow.getDeletionRequest')
      setError(err?.message || 'We could not load that request.')
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => { load() }, [load])

  const act = async (decision) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await respondToDeletionRequest(requestId, decision)
      setConfirming(false)
      await load()
    } catch (err) {
      reportClientError(err, 'deletionFlow.respond')
      setError(err?.message || 'We could not save that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await cancelDeletionRequest(requestId)
      await load()
    } catch (err) {
      reportClientError(err, 'deletionFlow.restore')
      setError(err?.message || 'We could not restore that account. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <><BackRow title="Request" to="/family" /><ListSkeleton rows={3} /></>
  if (error && !data) return <><BackRow title="Request" to="/family" /><ErrorRetry message={error} onRetry={load} /></>
  if (!data) {
    return (
      <>
        <BackRow title="Request" to="/family" />
        <div className="lhx-av-card">
          <b>We could not find that request.</b>
          <p className="lhx-del-intro">It may have been cancelled, or it was not sent to you.</p>
        </div>
      </>
    )
  }

  const { request, context, deletedSummary = [], graceDays = 30 } = data
  const name = request.learnerDisplayName || 'your child'
  const first = name.split(/\s+/)[0]

  /* ── Already answered: the scheduled / restore screen ─────────────── */
  if (request.state === DELETION_STATE.SCHEDULED) {
    const on = formatDate(request.scheduledDeleteAt)
    return (
      <>
        <BackRow title={first} to="/family" />
        <div className="lhx-av-card" style={{ textAlign: 'center' }}>
          <div className="pax-del-tick" aria-hidden="true">✓</div>
          <b>Scheduled for deletion</b>
          <p className="lhx-del-intro">
            {first} has been told, and they can bring it back themselves
            {on ? ` until ${on}` : ''}.
          </p>
        </div>

        <div className="lhx-av-card">
          <span className="lhx-del-pill">{graceDays} DAYS LEFT</span>
          <b>{on ? `Deletes permanently on ${on}` : 'Deletes permanently soon'}</b>
          <p className="lhx-del-intro">
            Until then everything is paused, not gone. Their streak is frozen where it was.
          </p>
          <button
            type="button"
            className="lhx-btn lhx-btn-primary lhx-btn-block"
            onClick={restore}
            disabled={busy}
          >
            {busy ? 'Working…' : `Restore ${first}'s account`}
          </button>
        </div>

        {context?.plan && (
          <div className="lhx-del-list lhx-del-list--info">
            <b>Your plan is unchanged</b>
            <p>{context.plan.text}</p>
          </div>
        )}
        {error && <p className="lhx-av-error" role="alert">{error}</p>}
      </>
    )
  }

  /* ── Answered another way ─────────────────────────────────────────── */
  if (request.state !== DELETION_STATE.PENDING_GUARDIAN) {
    const closed = {
      [DELETION_STATE.DECLINED]: `You kept ${first}'s account. They have been told.`,
      [DELETION_STATE.CANCELLED]: `${first} cancelled this request.`,
      [DELETION_STATE.ESCALATED_SUPPORT]: `Our team has taken this one over. Nothing has been deleted.`,
      [DELETION_STATE.COMPLETED]: `This account has been deleted.`,
    }
    return (
      <>
        <BackRow title={first} to="/family" />
        <div className="lhx-av-card">
          <b>Nothing left to decide</b>
          <p className="lhx-del-intro">{closed[request.state] || 'This request has been closed.'}</p>
        </div>
      </>
    )
  }

  /* ── The decision ─────────────────────────────────────────────────── */
  if (confirming) {
    const on = formatDate(Date.now() + graceDays * 24 * 60 * 60 * 1000)
    return (
      <>
        <BackRow title="Approve deletion" onBack={() => setConfirming(false)} />
        <div className="lhx-av-card">
          <b className="lhx-del-danger-title">This one is hard to undo</b>
          <p className="lhx-del-intro">
            {first}&apos;s account will be scheduled for deletion. They will have{' '}
            <b>{graceDays} days</b> to sign in and bring it back
            {on ? <>. After {on} it is permanent.</> : '.'}
          </p>
          <div className="lhx-del-list lhx-del-list--info" style={{ marginTop: 12 }}>
            <b>They will be told</b>
            <p>{first} gets a message saying you agreed, and that they have {graceDays} days to change their mind.</p>
          </div>
        </div>

        <div className="lhx-av-card">
          <p className="lhx-del-intro">
            Hold the button to confirm you are {first}&apos;s guardian and you want this.
          </p>
          <HoldToConfirm
            label={busy ? 'Working…' : 'Hold to approve deletion'}
            onConfirm={() => act('approve')}
            disabled={busy}
          />
          <button
            type="button"
            className="lhx-btn lhx-btn-soft lhx-btn-block"
            onClick={() => setConfirming(false)}
            disabled={busy}
            style={{ marginTop: 10 }}
          >
            Cancel — go back
          </button>
        </div>

        {error && <p className="lhx-av-error" role="alert">{error}</p>}
      </>
    )
  }

  return (
    <>
      <BackRow title={`${first}'s request`} to="/family" />

      <div className="lhx-av-card">
        <b>{name} wants to delete their account</b>
        <p className="lhx-del-intro">
          Requested {request.requestedAt ? formatDate(request.requestedAt) : 'recently'}
        </p>
        {context?.tiles && (
          <div className="pax-del-stats">
            {context.tiles.streakDays != null && (
              <div className="pax-del-stat"><b>{context.tiles.streakDays}</b><span>day streak</span></div>
            )}
            {context.tiles.examReadiness != null && (
              <div className="pax-del-stat"><b>{context.tiles.examReadiness}%</b><span>exam ready</span></div>
            )}
            {context.tiles.daysToExam != null && (
              <div className="pax-del-stat"><b>{context.tiles.daysToExam}</b><span>days to exams</span></div>
            )}
          </div>
        )}
      </div>

      {/* Absent for a child who genuinely is inactive — see decisionContextCore. */}
      {context?.note && (
        <div className="lhx-del-list lhx-del-list--warn">
          <b>Worth a conversation first</b>
          <p>{context.note.text}</p>
        </div>
      )}

      <div className="lhx-del-list lhx-del-list--gone">
        <b>If you approve, this is deleted</b>
        <ul>{deletedSummary.map((line) => <li key={line}>{line}</li>)}</ul>
      </div>

      <div className="lhx-del-list lhx-del-list--kept">
        <b>Kept</b>
        <p>Nothing that identifies {first} stays behind.</p>
      </div>

      {context?.plan && (
        <div className="lhx-del-list lhx-del-list--info">
          <b>Your plan</b>
          <p>{context.plan.text}</p>
        </div>
      )}

      {error && <p className="lhx-av-error" role="alert">{error}</p>}

      <div className="pax-del-actions">
        <button
          type="button"
          className="lhx-btn lhx-btn-soft lhx-btn-block"
          onClick={() => act('park')}
          disabled={busy}
        >
          💬 Talk to {first} first — decide later
        </button>
        <button
          type="button"
          className="lhx-btn lhx-btn-primary lhx-btn-block"
          onClick={() => act('decline')}
          disabled={busy}
        >
          Keep their account
        </button>
        <button
          type="button"
          className="lhx-btn lhx-btn-block pax-del-quiet"
          onClick={() => setConfirming(true)}
          disabled={busy}
        >
          Approve deletion
        </button>
      </div>

      <p className="lhx-del-safe">
        Worried about something behind this request?<br />
        <button type="button" className="lhx-del-link" onClick={() => navigate('/family/account')}>
          Message our team
        </button>
        {' · '}
        <a href="tel:116">Childline Zambia 116</a>
      </p>
    </>
  )
}
