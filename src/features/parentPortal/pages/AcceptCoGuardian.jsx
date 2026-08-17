/**
 * AcceptCoGuardian — /family/accept?t=… The other end of a family-sharing
 * invite.
 *
 * It requires a signed-in parent account, and the server additionally
 * requires that the signed-in account's email matches the address the
 * invite was sent to. Both halves matter: an invite is to a PERSON, and a
 * forwarded link that anybody could redeem would make the address on it
 * decorative.
 *
 * The three refusals a parent can actually hit — expired, already used,
 * wrong account — each get their own sentence, because "this invite is
 * not valid" leaves somebody staring at an email that clearly exists.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { acceptCoGuardianInvite } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { BackRow, ListSkeleton } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

export default function AcceptCoGuardian() {
  const [params] = useSearchParams()
  const token = params.get('t') || ''
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState({ status: 'idle', message: '', child: null })

  const accept = useCallback(async () => {
    if (!token) {
      setState({ status: 'error', message: 'This invite link is incomplete. Open it straight from the email.', child: null })
      return
    }
    setState({ status: 'working', message: '', child: null })
    try {
      const res = await acceptCoGuardianInvite(token)
      setState({ status: 'done', message: '', child: res })
    } catch (err) {
      reportClientError(err, 'parentApp.acceptCoGuardianInvite')
      setState({ status: 'error', message: err?.message || 'We could not accept this invite.', child: null })
    }
  }, [token])

  useEffect(() => {
    if (currentUser) accept()
  }, [currentUser, accept])

  return (
    <>
      <SeoHelmet title="Accept invite · ZedExams" noIndex />
      <BackRow title="Family invite" to="/family" />

      {!currentUser ? (
        <div className="lhx-card" style={{ padding: 18 }}>
          <p className="lhx-set-title">Sign in to accept</p>
          <p className="lhx-set-desc" style={{ margin: '6px 0 14px' }}>
            You need a ZedExams parent account, using the same email address the
            invite was sent to. Sign in and we will bring you straight back here.
          </p>
          <button
            type="button"
            className="lhx-btn lhx-btn-primary lhx-btn-block"
            onClick={() => navigate('/login', { state: { from: { pathname: `/family/accept`, search: `?t=${token}` } } })}
          >
            Sign in
          </button>
        </div>
      ) : state.status === 'working' || state.status === 'idle' ? (
        <ListSkeleton rows={1} height={140} />
      ) : state.status === 'done' ? (
        <div className="lhx-card" style={{ padding: 18 }}>
          <p className="lhx-set-title">You are now a guardian for {state.child?.displayName} ✓</p>
          <p className="lhx-set-desc" style={{ margin: '6px 0 14px' }}>
            You can see their progress and weekly reports, approve what they ask
            for, and change what they can use. Billing stays with the parent who
            set the account up.
          </p>
          <Link className="lhx-btn lhx-btn-primary lhx-btn-block" to="/family">
            Go to my family
          </Link>
        </div>
      ) : (
        <div className="lhx-card" style={{ padding: 18 }}>
          <p className="lhx-set-title">We could not accept this invite</p>
          <p className="lhx-set-desc" style={{ margin: '6px 0 14px' }} role="alert">
            {state.message}
          </p>
          <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" onClick={accept}>
            Try again
          </button>
          <p className="pax-note">
            Invites last seven days and work once. If yours has run out, ask the
            parent who sent it to invite you again.
          </p>
        </div>
      )}

      <div style={{ height: 20 }} />
    </>
  )
}
