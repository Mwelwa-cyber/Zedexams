/**
 * ApprovalFeed — the amber "Needs your approval" card on Home.
 *
 * Two things about the buttons, both of which are the point of the
 * screen rather than details of it:
 *
 *   1. **Review, not Approve.** A premium request is a request for
 *      money, and the parent decides it on the plan screen where the
 *      price and what it covers are visible. A one-tap Approve here
 *      would be a one-tap purchase.
 *   2. **Decline is real and quiet.** It marks the request declined
 *      server-side and tells the child "not right now" with no reason
 *      attached — the app does not put words in a parent's mouth.
 *
 * The child's progress travels with the request (the server built it
 * when the child asked), so a parent deciding sees how their child is
 * doing before they decide. That is the whole design of the ask.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from './ParentPrimitives'
import { agoInDays, describeRequest, firstNameOf } from '../lib/parentAppView'
import { declineGuardianApproval } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'

export default function ApprovalFeed({ approvals, onChange, disabled }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  if (!approvals || approvals.length === 0) return null

  async function decline(request) {
    setBusy(request.id)
    setError('')
    try {
      await declineGuardianApproval(request.id)
      onChange?.()
    } catch (err) {
      reportClientError(err, 'parentApp.declineGuardianApproval')
      setError(err?.message || 'We could not save that. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="pax-req-card" aria-labelledby="pax-approvals">
      <h2 className="pax-req-head" id="pax-approvals">
        🔔 Needs your approval ({approvals.length})
      </h2>
      {approvals.map((request, i) => {
        const name = firstNameOf(request.childName) || 'Your child'
        const when = agoInDays(request.createdAt, Date.now())
        return (
          <div className="pax-req-row" key={request.id}>
            <Avatar name={request.childName} index={i} size="sm" />
            <span className="pax-req-text">
              <b>{name} is asking to unlock</b>
              <small>
                {describeRequest(request)}
                {when ? ` · asked ${when}` : ''}
              </small>
            </span>
            <span className="pax-req-actions">
              <button
                type="button"
                className="lhx-btn lhx-btn-primary lhx-btn-sm"
                disabled={disabled || busy === request.id}
                onClick={() => navigate(`/family/plan?child=${request.childUid}&request=${request.id}`)}
              >
                Review
              </button>
              <button
                type="button"
                className="lhx-btn lhx-btn-soft lhx-btn-sm"
                disabled={disabled || busy === request.id}
                onClick={() => decline(request)}
              >
                Not now
              </button>
            </span>
          </div>
        )
      })}
      {error && <p className="lhx-error-text" role="alert">{error}</p>}
    </section>
  )
}
