/**
 * GuardianUnlock — /guardian-unlock?t=… The landing page for the link in
 * a guardian's email or WhatsApp message.
 *
 * It is OUTSIDE every guard and needs NO account. The one-time token in the
 * URL is the credential: the page first says what the request is (resolved
 * from the token server-side — the raw token is never stored), and the parent
 * then types their own mobile-money number and approves the prompt on their
 * phone. The plan, the amount and the child's account are all read from the
 * stored request by `guardianLinkPay*` (functions/guardianUnlock/
 * linkPayment.js); this page cannot influence them.
 *
 * Before 2026-10 this asked the guardian to sign in or register first, and
 * `/register` no longer offers a parent role, so the link demanded an account
 * that could not be made.
 *
 * ── Inside the Android app ─────────────────────────────────────────────
 *
 * Play Billing is the only payment method allowed there and this build must
 * not name or offer another, so when the page is somehow opened inside the
 * Capacitor shell (the emailed link normally opens in the system browser) it
 * keeps its previous behaviour and hands a signed-in user to the screen that
 * starts the Play rail. Nothing on the native branch mentions mobile money.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../styles/parentApp.css'
import { useAuth } from '../../../contexts/AuthContext'
import { resolveGuardianPayLink } from '../services/parentApp'
import { makeGuardianLinkApi } from '../services/guardianLinkPay'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { describeFeature } from '../lib/parentAppView'
import { ListSkeleton } from '../components/ParentPrimitives'
import GuardianCheckout from '../components/GuardianCheckout'
import { PLANS as CHECKOUT_PLANS } from '../../../engines/payment-engine/subscriptionConfig'
import { isNativePlatform } from '../../../utils/runtime'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'
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
  const { currentUser } = useAuth()
  const online = useNetworkStatus()
  const native = isNativePlatform()
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, link: null, error: '' })
  const [paid, setPaid] = useState(false)
  const linkApi = useMemo(() => makeGuardianLinkApi(token), [token])

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

  // The plan the child's request quoted, resolved from the SAME id both the
  // checkout and the server's own re-check (guardianBillingAuth) key off —
  // `link.planId` is `guardianRequests.planId`, which is a checkout plan id
  // ("term_pass"), not the ladder id it happens to share a spelling with. A
  // request minted before this field existed (or a corrupted one) falls back
  // to the fuller `/family/plan` flow rather than rendering a broken button.
  const plan = link?.valid ? CHECKOUT_PLANS[link.planId] : null

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
              onClick={() => navigate(native ? (currentUser ? '/family' : '/login') : '/')}
            >
              {native ? (currentUser ? 'Go to my family' : 'Sign in') : 'Go to ZedExams'}
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

            {!paid && (
              <div className="lhx-card" style={{ padding: 16, marginBottom: 14 }}>
                <p className="lhx-set-title">What unlocking gives them</p>
                <p className="pax-plan-feature"><span aria-hidden="true">✓</span> Every past paper for their grade</p>
                <p className="pax-plan-feature"><span aria-hidden="true">✓</span> Timed exam mode with full marking</p>
                <p className="pax-plan-feature"><span aria-hidden="true">✓</span> Papers and notes saved for offline</p>
                <p className="lhx-set-desc" style={{ marginTop: 8, lineHeight: 1.5 }}>
                  The payment unlocks <strong>{link.childFirstName}'s</strong> account,
                  not yours. You do not need a ZedExams account.
                </p>
              </div>
            )}

            {native ? (
              // INSIDE the Android app nothing here names or offers any
              // payment method: Play Billing is the only one allowed there.
              // This branch is unchanged from before the web path lost its
              // login — it still hands a signed-in user to the screen that
              // starts the Play rail. (The emailed link normally opens in the
              // system browser, so the web branch below is the usual one.)
              !currentUser ? (
                <button
                  type="button"
                  className="lhx-btn lhx-btn-primary lhx-btn-block"
                  onClick={() => navigate('/login', { state: { from: back } })}
                >
                  Sign in
                </button>
              ) : (
                <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={goToCheckout}>
                  Choose a plan
                </button>
              )
            ) : plan ? (
              // The web page needs NO account. The one-time token in the URL
              // is the credential; the server reads the plan, the amount and
              // the child's account from the stored request, so this only
              // collects the parent's own mobile-money number.
              <GuardianCheckout
                plan={plan}
                childUid={link.childUid}
                childName={link.childFirstName}
                guardianRequestId={link.requestId}
                disabled={online === false}
                onPaid={() => setPaid(true)}
                api={linkApi}
              />
            ) : (
              // A (very old) request with no resolvable plan. Better a plain
              // sentence than a checkout that cannot charge anything.
              <div className="lhx-card" style={{ padding: 16 }}>
                <p className="lhx-set-title">We cannot take this payment</p>
                <p className="lhx-set-desc" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
                  This request is missing its plan. Ask {link.childFirstName} to send a new one from their app.
                </p>
              </div>
            )}

            {!paid && (
              <p className="pax-note">
                Not expecting this? You can ignore it — nothing happens until you pay,
                and {link.childFirstName} keeps everything they already have either way.
              </p>
            )}
          </>
        )}

        <div style={{ height: 20 }} />
      </div>
    </div>
  )
}
