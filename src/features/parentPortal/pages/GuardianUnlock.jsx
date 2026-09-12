/**
 * GuardianUnlock — /guardian-unlock?t=… The landing page for the link in
 * a guardian's email or WhatsApp message.
 *
 * `requestGuardianUnlock` has mailed this URL to every guardian since it
 * shipped, and until now the route did not exist: the under-18 paywall's
 * only call to action landed on "Page not found" (PAY-001, item 3).
 *
 * It is deliberately OUTSIDE the parent-app guard. The guardian holding
 * that link may have no ZedExams account at all, so the page first says
 * what the request is — resolved from the token server-side, since the
 * raw token is never stored — and only then asks them to sign in. A link
 * that demands a sign-in before it will say what it is about is a link
 * people close.
 *
 * ── Paying no longer needs a PARENT account, just an account ──────────
 *
 * This used to send a signed-in guardian on to `/family/plan`, which is
 * gated on `isParent` plus a CONFIRMED family-code link — the exact
 * two-step, two-account dance (register as a parent, then wait for the
 * child to say yes to a code) that a guardian arriving from a one-time pay
 * link should never have to complete. `guardianBillingAuth`'s rule 4 now
 * lets a still-open, unexpired request token authorise the payment on its
 * own, so this page can put the checkout right here: any signed-in,
 * verified ZedExams account — parent, teacher, or the guardian's own
 * learner account, whatever they already had lying around — may complete
 * it directly. `/family/plan` still exists for the fuller parent-portal
 * experience (ongoing plan management, several linked children); this is
 * the fast path for "I just want to pay for the thing my child asked for".
 *
 * The ANDROID path is untouched: Play Billing purchases happen through the
 * Play Store on the device that owns the purchasing Google account, and a
 * link opened from WhatsApp or email lands in the system browser, not
 * inside the Capacitor shell — so `isNativePlatform()` here still routes to
 * `/family/plan`, which already knows how to choose the Play rail.
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
  const { currentUser, needsEmailVerification } = useAuth()
  const online = useNetworkStatus()
  const native = isNativePlatform()
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, link: null, error: '' })
  const [paid, setPaid] = useState(false)

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

            {!paid && (
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
            )}

            {!currentUser ? (
              <>
                <button
                  type="button"
                  className="lhx-btn lhx-btn-primary lhx-btn-block"
                  onClick={() => navigate('/login', { state: { from: back } })}
                >
                  Sign in or create an account
                </button>
                <p className="pax-note">
                  Any ZedExams account works — you do not need to be linked to{' '}
                  {link.childFirstName} first. It takes a minute, and this link will
                  still be here when you come back.
                </p>
              </>
            ) : native ? (
              // Play Billing purchases happen on the device that owns the
              // purchasing Google account, through the Play Store UI — this
              // page just hands off to the screen that already knows how to
              // start that rail.
              <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={goToCheckout}>
                Choose a plan
              </button>
            ) : needsEmailVerification ? (
              <div className="lhx-card" style={{ padding: 16 }}>
                <p className="lhx-set-title">Verify your email to pay</p>
                <p className="lhx-set-desc" style={{ margin: '6px 0 14px', lineHeight: 1.5 }}>
                  You are signed in, but this account's email address is not verified
                  yet — that is required before a payment can go through.
                </p>
                <button
                  type="button"
                  className="lhx-btn lhx-btn-primary lhx-btn-block"
                  onClick={() => navigate('/verify-email', { state: { from: back } })}
                >
                  Verify my email
                </button>
              </div>
            ) : plan ? (
              <GuardianCheckout
                plan={plan}
                childUid={link.childUid}
                childName={link.childFirstName}
                guardianRequestId={link.requestId}
                disabled={online === false}
                onPaid={() => setPaid(true)}
              />
            ) : (
              // No resolvable checkout plan on this (likely very old) request
              // record — fall back to the fuller flow rather than a dead end.
              <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={goToCheckout}>
                Choose a plan
              </button>
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
