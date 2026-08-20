/**
 * FamilySharing — /family/sharing/:childUid. More than one guardian on
 * one child.
 *
 * The screen's job is to make the OWNER/CO-GUARDIAN line legible before
 * anybody accepts anything: both see everything and both act day to day,
 * only the owner moves money or deletes the account. The invite email
 * says the same thing in the same words, because a recipient who has to
 * accept to find out what they are accepting has not consented to it.
 *
 * Every button here is also gated server-side by the same capability
 * (`manageGuardians`); the disabled state is a courtesy, not the control.
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'
import { getGuardianChildDetail, inviteCoGuardian, removeCoGuardian } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { can, describeRole } from '../../../utils/guardianRoles'
import { firstNameOf } from '../lib/parentAppView'
import { Avatar, BackRow, ErrorRetry, ListSkeleton } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

const CAN_DO = [
  { yes: true, text: "See every child's progress and reports" },
  { yes: true, text: 'Approve unlock and friend requests' },
  { yes: true, text: 'Change what a child can do — live challenges, study time' },
  { yes: false, text: 'Manage billing or delete the account (owner only)' },
]

export default function FamilySharing() {
  const { childUid } = useParams()
  const { userProfile } = useAuth()
  const online = useNetworkStatus()
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [inviteError, setInviteError] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await getGuardianChildDetail(childUid)
      setState({ loading: false, error: null, data })
    } catch (err) {
      reportClientError(err, 'parentApp.getGuardianChildDetail')
      setState({ loading: false, error: err?.message || 'We could not load this.', data: null })
    }
  }, [childUid])

  useEffect(() => { load() }, [load])

  const { loading, error, data } = state
  const name = firstNameOf(data?.displayName) || 'your child'
  const isOwner = can(data?.role, 'manageGuardians')

  async function invite(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setInviteError('')
    setNotice('')
    try {
      const res = await inviteCoGuardian(childUid, email.trim())
      setEmail('')
      setNotice(res?.sent ?
        'Invite sent ✓ They can accept from their email.' :
        'Invite created, but we could not send the email. Ask them to check ' +
        'later, or try again.')
      await load()
    } catch (err) {
      reportClientError(err, 'parentApp.inviteCoGuardian')
      setInviteError(err?.message || 'We could not send that invite.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(parentUid) {
    setBusy(true)
    setNotice('')
    try {
      await removeCoGuardian({ childUid, parentUid })
      await load()
    } catch (err) {
      reportClientError(err, 'parentApp.removeCoGuardian')
      setNotice(err?.message || 'We could not remove that guardian.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SeoHelmet title="Family sharing · ZedExams" noIndex />
      <BackRow title="Family sharing" to={`/family/child/${childUid}`} />

      {loading ? (
        <ListSkeleton rows={3} height={70} />
      ) : error ? (
        <ErrorRetry message={error} onRetry={load} />
      ) : (
        <>
          <p className="lhx-set-desc" style={{ margin: '0 4px 16px' }}>
            Add another parent or guardian to help look after {name}. Everyone
            sees progress and can approve requests — only the owner manages
            billing.
          </p>

          <h2 className="lhx-set-head">Guardians</h2>
          <div className="lhx-set-group">
            {(data.guardians || []).map((g, i) => (
              <div className="pax-cg" key={g.parentUid}>
                <Avatar
                  name={g.isYou ? userProfile?.displayName : g.displayName}
                  index={i}
                  size="sm"
                />
                <span className="pax-cg-main">
                  <span className="pax-cg-name">
                    {g.isYou ? (userProfile?.displayName || 'You') : (g.displayName || 'A guardian')}
                  </span>
                  <span className="pax-cg-role">
                    {g.isYou ? 'you' : describeRole(g.role).toLowerCase()}
                  </span>
                </span>
                <span className={`pax-tag ${g.role === 'owner' ? 'pax-tag-owner' : 'pax-tag-pending'}`}>
                  {describeRole(g.role)}
                </span>
                {isOwner && !g.isYou && g.role !== 'owner' && (
                  <button
                    type="button"
                    className="lhx-btn lhx-btn-soft lhx-btn-sm"
                    disabled={busy || online === false}
                    onClick={() => remove(g.parentUid)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          {isOwner ? (
            <>
              <h2 className="lhx-set-head">Invite a co-guardian</h2>
              <form className="lhx-card" style={{ padding: 15 }} onSubmit={invite}>
                <label className="lhx-set-title" htmlFor="pax-cg-email">Their email address</label>
                <input
                  id="pax-cg-email"
                  className="pax-field"
                  style={{ marginTop: 8 }}
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setInviteError('') }}
                  placeholder="e.g. dad@example.com"
                  autoComplete="email"
                  aria-invalid={inviteError ? true : undefined}
                />
                <button
                  type="submit"
                  className="lhx-btn lhx-btn-primary lhx-btn-block"
                  disabled={busy || online === false || !email.trim()}
                >
                  {busy ? 'Sending…' : 'Send invite'}
                </button>
                {inviteError && <p className="lhx-error-text" role="alert">{inviteError}</p>}
                {notice && <p className="pax-note" role="status">{notice}</p>}
              </form>
            </>
          ) : (
            <p className="pax-note">
              Only the account owner can invite or remove guardians.
            </p>
          )}

          <h2 className="lhx-set-head">What a co-guardian can do</h2>
          <div className="lhx-set-group lhx-gz-pad">
            {CAN_DO.map((row) => (
              <p className="pax-cando" key={row.text}>
                <span className={row.yes ? 'pax-cando-yes' : 'pax-cando-no'} aria-hidden="true">
                  {row.yes ? '✓' : '✗'}
                </span>
                {row.text}
              </p>
            ))}
          </div>

          <div style={{ height: 20 }} />
        </>
      )}
    </>
  )
}
