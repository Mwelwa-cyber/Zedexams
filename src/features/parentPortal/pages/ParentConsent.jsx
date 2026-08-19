/**
 * ParentConsent — /family/account/consent. What this guardian has
 * approved for each child, and how to take it back.
 *
 * `/child-safety` — the published standards page named in the Play
 * Console declaration — tells guardians they may "view, change and delete
 * a child's data". Until this screen there was nowhere in the product
 * that honoured the first two: consent was granted by clicking a link in
 * an email and then existed only as a Firestore field nobody could see.
 * A published promise with no surface behind it is the one kind of gap a
 * regulator reads back to you.
 *
 * ── Withdrawing is not a soft toggle, and the screen says so ────────
 *
 * Consent is the lawful basis for processing the child's data, so
 * withdrawing it suspends the account and schedules its deletion — the
 * same outcome as the emailed "this wasn't me", through the same shared
 * record (functions/guardianConsent/consentRecord.js). That is a real
 * consequence, so it is stated in full and confirmed before the call,
 * and the screen says plainly that re-approving within the 30 days
 * brings the account back. A destructive control people are afraid to
 * touch is not a control they have.
 *
 * Owner-only. The server refuses a co-guardian (`deleteChild`); the
 * disabled state here is a courtesy so nobody presses a button that
 * apologises.
 */

import { useState } from 'react'
import useGuardianChildren from '../hooks/useGuardianChildren'
import { setGuardianConsent } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { can } from '../../../utils/guardianRoles'
import { consentViaLabel, consentView, firstNameOf, sortChildren } from '../lib/parentAppView'
import { Avatar, BackRow, Empty, ErrorRetry, ListSkeleton } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

function formatDate(ms) {
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function ParentConsent() {
  const { loading, error, children, reload } = useGuardianChildren()
  const [busy, setBusy] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [failure, setFailure] = useState('')

  const ordered = sortChildren(children)

  async function decide(childUid, decision) {
    if (busy) return
    setBusy(childUid)
    setFailure('')
    try {
      await setGuardianConsent(childUid, decision)
      setConfirming(null)
      await reload()
    } catch (err) {
      reportClientError(err, 'parentApp.setGuardianConsent')
      setFailure(err?.message || 'We could not save that just now. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <SeoHelmet title="Guardian consent · ZedExams" noIndex />
      <BackRow
        title="Guardian consent"
        subtitle="What you have approved, per child"
        to="/family/account"
      />

      {failure && (
        <div className="lhx-error" role="alert">
          <p className="lhx-error-text">{failure}</p>
        </div>
      )}

      {loading ? (
        <ListSkeleton rows={2} height={110} />
      ) : error ? (
        <ErrorRetry message={error} onRetry={reload} />
      ) : ordered.length === 0 ? (
        <Empty icon="📝" action={{ label: 'Add a child', to: '/family/children' }}>
          Consent records appear here once you have linked a child.
        </Empty>
      ) : (
        ordered.map((child, i) => {
          const view = consentView(child.consent)
          const isOwner = can(child.role, 'deleteChild')
          const via = consentViaLabel(child.consent?.via)
          const decidedAt = formatDate(child.consent?.decidedAt)
          const name = firstNameOf(child.displayName) || 'your child'

          return (
            <div className="lhx-card" style={{ padding: 16 }} key={child.childUid}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={child.displayName} index={i} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 900, fontSize: 15 }}>{name}</p>
                  <p className="lhx-set-desc">
                    {[decidedAt, via].filter(Boolean).join(' · ') || 'No decision recorded'}
                  </p>
                </div>
                <span className={`pax-status pax-status-${view.tone}`}>{view.label}</span>
              </div>

              <p className="lhx-set-desc" style={{ marginTop: 10 }}>{view.detail}</p>

              {!isOwner ? (
                <p className="lhx-set-desc" style={{ marginTop: 10 }}>
                  Only the guardian who set this account up can change consent.
                </p>
              ) : confirming === child.childUid ? (
                <div style={{ marginTop: 12 }}>
                  <p className="lhx-set-desc">
                    Withdrawing consent suspends {name}&rsquo;s account straight away
                    and deletes it after 30 days. Approving again within those 30
                    days brings it back.
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      className="lhx-btn lhx-btn-soft lhx-btn-sm"
                      onClick={() => setConfirming(null)}
                      disabled={busy === child.childUid}
                    >
                      Keep it
                    </button>
                    <button
                      type="button"
                      className="lhx-btn lhx-btn-sm lhx-set-danger"
                      onClick={() => decide(child.childUid, 'withdrawn')}
                      disabled={busy === child.childUid}
                    >
                      {busy === child.childUid ? 'Withdrawing…' : 'Withdraw consent'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {view.canGrant && (
                    <button
                      type="button"
                      className="lhx-btn lhx-btn-primary lhx-btn-sm"
                      onClick={() => decide(child.childUid, 'granted')}
                      disabled={busy === child.childUid}
                    >
                      {busy === child.childUid ? 'Saving…' : 'Approve this account'}
                    </button>
                  )}
                  {view.canWithdraw && (
                    <button
                      type="button"
                      className="lhx-btn lhx-btn-soft lhx-btn-sm"
                      onClick={() => setConfirming(child.childUid)}
                    >
                      Withdraw consent
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}

      <p className="pax-note">
        You can also ask us to send you everything we hold about your child, or
        to delete it, at support@zedexams.com.
      </p>
      <div style={{ height: 20 }} />
    </>
  )
}
