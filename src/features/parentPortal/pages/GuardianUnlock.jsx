/**
 * GuardianUnlock — /guardian-unlock?t=… The landing page for the link in
 * a guardian's email.
 *
 * `requestGuardianUnlock` has mailed this URL to every guardian since it
 * shipped, and until now the route did not exist: the under-18 paywall's
 * only call to action landed on "Page not found" (PAY-001, item 3).
 *
 * It is deliberately OUTSIDE the parent-app guard. The guardian holding
 * that email may have no ZedExams account at all, so the page first says
 * what the request is — resolved from the token server-side, since the
 * raw token is never stored — and only then asks them to sign in. A link
 * that demands a sign-in before it will say what it is about is a link
 * people close.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../styles/parentApp.css'
import { useAuth } from '../../../contexts/AuthContext'
import { resolveGuardianPayLink } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { describeFeature } from '../lib/parentAppView'
import { ListSkeleton } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

const REASONS = {
  missing: 'This link is incomplete. Open it straight from the message we sent you.',
  unknown: 'We could not find that request. It may have been sent a long time ago.',
  expired: 'This link has expired. Ask your child to send a new one from their app.',
  'already-paid': 'This has already been paid for — everything is unlocked.',
  withdrawn: 'This request is no longer open.',
  // The server caps this endpoint per source IP (it is unauthenticated, and
  // every call with a token-shaped string costs two Firestore reads). It
  // answers with a reason rather than an error so a guardian who has just
  // opened their email sees a sentence and a retry, not a failure page.
  'rate-limited': 'We are busy right now. Give it a minute and open the link again.',
}

export default function GuardianUnlock() {
  const [params] = useSearchParams()
  const token = params.get('t') || ''
  const { currentUser, isParent } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, link: null, error: '' })

  const load = useCallback(async () => {
    setState({ loading: true, link: null, error: '' })
    try {
      const link = await resolveGuardianPayLink(token)
      setState({ loading: false, link, error: '' })
    } catch (err) {
      reportClientError(err, 'guardianUnlock.resolve')
      setState({ loading: false, link: null, error: 'We could not open that link just now.' })
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const { loading, link, error } = state
  const back = { pathname: '/guardian-unlock', search: `?t=${encodeURIComponent(token)}` }

  function goToCheckout() {
    navigate(`/family/plan?child=${link.childUid}&request=${link.requestId}`)
  }

  return (
    <div className="lhx pax">
      <div className="lhx-page">
        <SeoHelmet title="Unlock ZedExams · ZedExams" noIndex />

        <div className="pax-top">
          <img className="pax-brand" src="/zedexams-logo.webp" alt="ZedExams" />
          <span className="pax-role-pill">Guardian</span>
        </div>

        {loading ? (
          <ListSkeleton rows={1} height={180} />
        ) : error ? (
          <div className="lhx-card" style={{ padding: 18 }}>
            <p className="lhx-set-title">Something went wrong</p>
            <p className="lhx-set-desc" style={{ margin: '6px 0 14px' }} role="alert">{error}</p>
            <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" onClick={load}>
              Try again
            </button>
          </div>
        ) : !link?.valid ? (
          <div className="lhx-card" style={{ padding: 18 }}>
            <p className="lhx-set-title">
              {link?.reason === 'already-paid' ? 'Already unlocked 🎉' : 'This link is not open'}
            </p>
            <p className="lhx-set-desc" style={{ margin: '6px 0 14px', lineHeight: 1.5 }}>
              {REASONS[link?.reason] || REASONS.unknown}
            </p>
            <button
              type="button"
              className="lhx-btn lhx-btn-primary lhx-btn-block"
              onClick={() => navigate(currentUser ? '/family' : '/login')}
            >
              {currentUser ? 'Go to my family' : 'Sign in'}
            </button>
          </div>
        ) : (
          <>
            <h1 className="pax-greet">
              <em>{link.childFirstName}</em> asked you to unlock ZedExams
            </h1>
            <p className="pax-greet-sub">
              They want {describeFeature(link.feature)}
              {Number.isFinite(link.priceZMW) ? ` · from K${link.priceZMW}` : ''}.
            </p>

            <div className="lhx-card" style={{ padding: 16, marginBottom: 14 }}>
              <p className="lhx-set-title">What unlocking gives them</p>
              <p className="pax-plan-feature"><span aria-hidden="true">✓</span> Every past paper for their grade</p>
              <p className="pax-plan-feature"><span aria-hidden="true">✓</span> Timed exam mode with full marking</p>
              <p className="pax-plan-feature"><span aria-hidden="true">✓</span> Papers and notes saved for offline</p>
              <p className="lhx-set-desc" style={{ marginTop: 8, lineHeight: 1.5 }}>
                The payment unlocks <strong>{link.childFirstName}'s</strong> account,
                not yours, and the receipt comes to you.
              </p>
            </div>

            {currentUser && isParent ? (
              <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={goToCheckout}>
                Choose a plan
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="lhx-btn lhx-btn-primary lhx-btn-block"
                  onClick={() => navigate('/login', { state: { from: back } })}
                >
                  {currentUser ? 'Switch to a parent account' : 'Sign in to continue'}
                </button>
                <p className="pax-note">
                  {currentUser ?
                    'Paying for a child needs a parent account — the one linked to them.' :
                    'You will need a ZedExams parent account linked to ' +
                    `${link.childFirstName}. It takes a minute, and this link will still be here.`}
                </p>
              </>
            )}

            <p className="pax-note">
              Not expecting this? You can ignore it — nothing happens until you pay,
              and {link.childFirstName} keeps everything they already have either way.
            </p>
          </>
        )}

        <div style={{ height: 20 }} />
      </div>
    </div>
  )
}
