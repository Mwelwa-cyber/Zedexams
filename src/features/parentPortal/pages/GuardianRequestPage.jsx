/**
 * GuardianRequestPage — /for-guardians/request/:requestId
 *
 * Where the link in "your child asked to delete their account" lands. The
 * parent app that used to host this closed, and the email still said "Review
 * the request" — this is the screen that sentence points at.
 *
 * The guardian must be signed in as the account the request was ADDRESSED to.
 * That is not a UI check: `getDeletionRequest` answers anyone else with
 * "not found" and `respondToDeletionRequest` refuses them, so this page
 * decides nothing about who may answer — it only renders what the server
 * returns and sends the guardian's choice back.
 *
 * Three choices, and "decide later" is a real one rather than a way to do
 * nothing: it tells the child their grown-up wants to talk first, and it does
 * NOT stop the seven-day clock. The copy says so, because a guardian who
 * parks a request believing it pauses everything would otherwise be surprised
 * on day eight.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../styles/parentApp.css'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { reportClientError } from '../../../utils/clientErrorReporting'
import {
  getDeletionRequest,
  respondToDeletionRequest,
  cancelDeletionRequest,
} from '../services/guardianActions'
import { CHILDLINE, daysPhrase, requestView, statRows } from '../lib/guardianActionsView'

export default function GuardianRequestPage() {
  const { requestId } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, payload: null, error: null })
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [outcome, setOutcome] = useState(null) // 'approve' | 'decline' | 'park' | 'restore'
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const payload = await getDeletionRequest(requestId)
      setState({ loading: false, payload, error: null })
    } catch (err) {
      reportClientError(err, 'guardianRequest.load')
      setState({ loading: false, payload: null, error: 'We could not open that request just now.' })
    }
  }, [requestId])

  useEffect(() => { load() }, [load])

  async function answer(decision) {
    setBusy(true)
    setActionError('')
    try {
      await respondToDeletionRequest(requestId, decision)
      setOutcome(decision)
      setConfirming(false)
    } catch (err) {
      reportClientError(err, 'guardianRequest.respond')
      // The server's own sentence ("this request was already answered", "sent
      // to a different guardian") is the useful one; fall back to a plain line.
      setActionError(err?.message || 'That did not go through. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    setBusy(true)
    setActionError('')
    try {
      await cancelDeletionRequest(requestId)
      setOutcome('restore')
    } catch (err) {
      reportClientError(err, 'guardianRequest.restore')
      setActionError(err?.message || 'That did not go through. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const { loading, payload, error } = state
  const view = requestView(payload)
  const req = payload?.request
  const child = req?.learnerDisplayName || 'Your child'
  const graceDays = payload?.graceDays
  const waitDays = payload?.guardianResponseDays
  const rows = statRows(payload?.context?.tiles)

  return (
    <div className="lhx pax">
      <div className="lhx-page">
        <SeoHelmet title="Account request · ZedExams" noIndex />
        <div className="pax-top">
          <img className="pax-brand" src="/zedexams-logo.webp" alt="ZedExams" />
          <span className="pax-role-pill">Guardian</span>
        </div>

        {loading ? (
          <div className="lhx-card" style={{ padding: 18 }} aria-busy="true">Loading…</div>
        ) : error ? (
          <div className="lhx-card" style={{ padding: 18 }}>
            <p className="lhx-set-title">Something went wrong</p>
            <p className="lhx-set-desc" style={{ margin: '6px 0 14px' }} role="alert">{error}</p>
            <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" onClick={load}>Try again</button>
          </div>
        ) : outcome ? (
          <div className="lhx-card" style={{ padding: 18 }}>
            <p className="lhx-set-title">
              {outcome === 'approve' && 'You approved the request'}
              {outcome === 'decline' && 'You declined — nothing will be deleted'}
              {outcome === 'park' && 'We told them you want to talk first'}
              {outcome === 'restore' && 'The account is restored'}
            </p>
            <p className="lhx-set-desc" style={{ margin: '6px 0 14px', lineHeight: 1.5 }}>
              {outcome === 'approve' && `${child}'s account will be deleted after ${graceDays ?? 'a few'} days. ${child} can still change their mind until then, and so can you from this link.`}
              {outcome === 'decline' && `${child} has been told. Their account stays exactly as it is.`}
              {outcome === 'park' && `This is not an answer yet. If we do not hear from you within ${waitDays ?? 7} days of the request, our support team will follow up with ${child} directly.`}
              {outcome === 'restore' && `${child}'s deletion is cancelled and everything stays as it was.`}
            </p>
            <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" onClick={() => navigate('/for-guardians')}>Done</button>
          </div>
        ) : view === 'not_found' ? (
          <div className="lhx-card" style={{ padding: 18 }}>
            <p className="lhx-set-title">We could not find this request</p>
            <p className="lhx-set-desc" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
              It may have been sent to a different account. Make sure you are signed in with the
              email address the message was sent to.
            </p>
          </div>
        ) : view === 'decide' ? (
          <>
            <h1 className="pax-greet"><em>{child}</em> asked to delete their account</h1>
            <p className="pax-greet-sub">
              Nothing has been deleted, and nothing will be until you decide.
              {payload?.banner?.daysLeft != null && ` If we do not hear from you ${daysPhrase(payload.banner.daysLeft)}, our support team will follow up with them directly.`}
            </p>

            {rows.length > 0 && (
              <div className="lhx-card" style={{ padding: 16, marginBottom: 14 }}>
                <p className="lhx-set-title">Where they are right now</p>
                {rows.map((r) => (
                  <p key={r.key} className="lhx-set-desc" style={{ margin: '4px 0' }}>
                    {r.label}: <strong>{r.value}</strong>
                  </p>
                ))}
                {payload.context?.note?.text && (
                  <p className="lhx-set-desc" style={{ marginTop: 8, lineHeight: 1.5 }}>{payload.context.note.text}</p>
                )}
                {payload.context?.plan?.text && (
                  <p className="lhx-set-desc" style={{ marginTop: 8, lineHeight: 1.5 }}>{payload.context.plan.text}</p>
                )}
              </div>
            )}

            <div className="lhx-card" style={{ padding: 16, marginBottom: 14 }}>
              <p className="lhx-set-title">If you approve, this goes</p>
              {(payload.deletedSummary || []).map((line) => (
                <p key={line} className="lhx-set-desc" style={{ margin: '4px 0' }}>• {line}</p>
              ))}
              <p className="lhx-set-desc" style={{ marginTop: 8, lineHeight: 1.5 }}>
                {child} would have {graceDays ?? 'a few'} days to change their mind before it is permanent.
              </p>
            </div>

            {actionError && <p className="lhx-set-desc" role="alert" style={{ margin: '0 0 10px' }}>{actionError}</p>}

            {confirming ? (
              <div className="lhx-card" style={{ padding: 16 }}>
                <p className="lhx-set-title">Delete {child}'s account?</p>
                <p className="lhx-set-desc" style={{ margin: '6px 0 12px', lineHeight: 1.5 }}>
                  This starts a {graceDays ?? ''}-day countdown. After that it cannot be undone.
                </p>
                <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" disabled={busy} onClick={() => answer('approve')}>
                  Yes, delete their account
                </button>
                <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" style={{ marginTop: 8 }} disabled={busy} onClick={() => setConfirming(false)}>
                  Go back
                </button>
              </div>
            ) : (
              <>
                <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" disabled={busy} onClick={() => answer('decline')}>
                  Keep their account
                </button>
                <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" style={{ marginTop: 8 }} disabled={busy} onClick={() => setConfirming(true)}>
                  Approve deletion
                </button>
                <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" style={{ marginTop: 8 }} disabled={busy} onClick={() => answer('park')}>
                  Decide later — I want to talk to them first
                </button>
                <p className="pax-note">
                  &ldquo;Decide later&rdquo; tells {child} you want to talk, but it does not pause the
                  {' '}{waitDays ?? 7}-day wait.
                </p>
              </>
            )}
          </>
        ) : view === 'scheduled' ? (
          <div className="lhx-card" style={{ padding: 18 }}>
            <p className="lhx-set-title">{child}'s account is scheduled for deletion</p>
            <p className="lhx-set-desc" style={{ margin: '6px 0 14px', lineHeight: 1.5 }}>
              {payload?.banner?.daysLeft != null ? `It will be deleted ${daysPhrase(payload.banner.daysLeft)}. ` : ''}
              Until then you can cancel it and everything stays as it was.
            </p>
            {actionError && <p className="lhx-set-desc" role="alert" style={{ margin: '0 0 10px' }}>{actionError}</p>}
            {payload?.banner?.canRestore !== false && (
              <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" disabled={busy} onClick={restore}>
                Cancel the deletion
              </button>
            )}
          </div>
        ) : (
          <div className="lhx-card" style={{ padding: 18 }}>
            <p className="lhx-set-title">This request is closed</p>
            <p className="lhx-set-desc" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
              {view === 'declined' && 'You declined it, and the account was kept.'}
              {view === 'cancelled' && 'It was cancelled, and the account was kept.'}
              {view === 'escalated' && 'It has gone to our support team, who will follow up with your child directly.'}
              {view === 'completed' && 'The account has already been deleted.'}
            </p>
          </div>
        )}

        <p className="pax-note" style={{ marginTop: 16 }}>
          If a child is in danger, {CHILDLINE.name} is {CHILDLINE.number}, free from any network.
        </p>
        <div style={{ height: 20 }} />
      </div>
    </div>
  )
}
