/**
 * ParentPlayCheckout — the Android half of /family/plan.
 *
 * Same screen, same decision, same money: a guardian chooses a plan for a
 * linked child and pays for it. What changes on Android is only WHO takes
 * the payment. Google Play policy requires digital subscriptions sold
 * inside the app to go through Play Billing, so this replaces
 * `GuardianCheckout`'s mobile-money form when `isNativePlatform()`.
 *
 * ── The three things this component must never contain ──────────────
 *
 *   1. **No ZMW price literals.** Every figure comes from Play's own
 *      localized `priceString`. We do not set the Play price and must not
 *      quote one beside it; a card reading "K50" over a sheet charging
 *      something else is the complaint we would deserve.
 *   2. **No steering.** No mention of Lenco, mobile money, Airtel, MTN,
 *      the website, or "cheaper on the web". Anti-steering rules apply in
 *      Zambia and this is the surface they apply to.
 *   3. **No cancel button.** A Play subscription can only be cancelled in
 *      Play. A cancel control here would be both a rejection reason and a
 *      refund-dispute generator — `ParentPlanStatus` renders the manage
 *      link instead.
 *
 * ── The child is named, and the child is verified ───────────────────
 *
 * `childUid` travels to `verifyGooglePlayPurchase` as `beneficiaryUid`,
 * where the server re-authorises it against its own read of `parentLinks`
 * before crediting anybody. This component sending it is a REQUEST. The
 * obfuscated account id bound to the purchase is the PARENT's uid, not
 * the child's — the parent is the buyer, and Google records the buyer.
 *
 * ── Passes are not short subscriptions ──────────────────────────────
 *
 * A day or term pass is a one-time Play product: it does not renew, Play
 * offers no manage screen for it, and the card says so. Presenting one
 * with a renewal date it will never have is how a parent ends up
 * expecting a charge that never comes, or fearing one that never was.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  classifyPurchaseError,
  fetchPlayProducts,
  purchasePlayProduct,
  restorePlayPurchases,
  verifyPlayPurchases,
} from '../../../utils/playBilling'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { capture } from '../../../utils/analytics'

/**
 * The rungs offered to a guardian on Android, in the same order the web
 * screen lists them. A rung Play has not returned is simply absent — a
 * partial catalogue still lets a parent buy.
 */
const OFFERED = ['weekly', 'monthly', 'day_pass', 'term_pass']

export default function ParentPlayCheckout({
  childUid,
  childName,
  guardianRequestId,
  disabled,
  onPaid,
}) {
  const { currentUser } = useAuth()

  // loading → plans → purchasing → verifying → success | error (+ restoring)
  const [phase, setPhase] = useState('loading')
  const [products, setProducts] = useState([])
  const [selectedPlanId, setSelectedPlanId] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(null)

  // The purchase we still owe the backend a verification for. Retry
  // re-sends THIS token — it never re-launches the purchase sheet, which
  // would be a second charge for one intent.
  const purchaseRef = useRef(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const loadProducts = useCallback(async () => {
    setPhase('loading')
    setError(null)
    try {
      const items = await fetchPlayProducts(OFFERED)
      if (!mountedRef.current) return
      if (!items.length) {
        setError({
          kind: 'load',
          message: 'Plans are not available from Google Play right now. Please try again shortly.',
        })
        setPhase('error')
        return
      }
      setProducts(items)
      setSelectedPlanId((current) => (
        current && items.some((i) => i.planId === current) ? current : items[0].planId
      ))
      setPhase('plans')
    } catch (err) {
      if (!mountedRef.current) return
      reportClientError(err, 'parentPlayCheckout.load')
      setError({
        kind: 'load',
        message: 'Could not load plans from Google Play. Check your connection and try again.',
      })
      setPhase('error')
    }
  }, [])

  useEffect(() => { loadProducts() }, [loadProducts])

  const busy = phase === 'purchasing' || phase === 'verifying' || phase === 'restoring'
  const selected = products.find((p) => p.planId === selectedPlanId) || null

  const runVerify = useCallback(async (source) => {
    if (!purchaseRef.current) return
    setPhase('verifying')
    setError(null)
    try {
      const data = await verifyPlayPurchases({
        purchases: [purchaseRef.current],
        source,
        // Credits the child rather than the payer — re-checked server-side.
        beneficiaryUid: childUid,
        guardianRequestId: guardianRequestId || undefined,
      })
      if (!mountedRef.current) return
      const result = (data?.results || [])[0] || {}
      if (result.status === 'active') {
        setPhase('success')
        capture('guardian_play_purchase_succeeded', { planId: result.planId || selectedPlanId })
        onPaid?.()
        return
      }
      if (result.status === 'wrong_user' || result.status === 'account_mismatch') {
        setError({
          kind: 'wrong_user',
          message: 'This purchase is linked to a different ZedExams account. ' +
            'Sign in with the account that made it, or contact support.',
        })
        setPhase('error')
        return
      }
      setError({
        kind: 'verify',
        message: 'We could not confirm that purchase yet. Tap to try again — ' +
          'you have not been charged twice.',
      })
      setPhase('error')
      capture('guardian_play_verify_failed', {
        planId: selectedPlanId, status: result.status || 'unknown',
      })
    } catch (err) {
      if (!mountedRef.current) return
      reportClientError(err, 'parentPlayCheckout.verify')
      // failed-precondition = the server said OUR config is broken. Retrying
      // cannot succeed until an admin fixes it, so do not promise it will.
      const config = err?.code === 'functions/failed-precondition'
      setError({
        kind: 'verify',
        config,
        message: config
          ? 'Purchases are temporarily unavailable. Our team has been alerted — ' +
            'please try again later.'
          : 'We could not reach ZedExams to confirm that purchase. ' +
            'Tap to try again — your payment is safe.',
      })
      setPhase('error')
      capture('guardian_play_verify_failed', {
        planId: selectedPlanId,
        status: 'request-error',
        errorCode: err?.code || '',
        errorReason: err?.details?.reason || '',
      })
    }
  }, [childUid, guardianRequestId, onPaid, selectedPlanId])

  async function handleBuy() {
    if (!selectedPlanId || busy || disabled) return
    setNotice('')
    setError(null)
    setPhase('purchasing')
    capture('guardian_play_purchase_initiated', { planId: selectedPlanId })
    try {
      // The PARENT's uid binds the purchase — they are the buyer.
      const purchase = await purchasePlayProduct(selectedPlanId, currentUser?.uid)
      purchaseRef.current = purchase
      await runVerify('purchase')
    } catch (err) {
      if (!mountedRef.current) return
      const kind = classifyPurchaseError(err)
      if (kind === 'not-completed') {
        // Covers user-cancel AND already-owned — the plugin cannot tell
        // them apart, hence the restore hint rather than an error screen.
        setPhase('plans')
        setNotice('The purchase didn’t complete — you have not been charged. ' +
          'Already bought this on this Google account? Tap “Restore purchases”.')
        capture('guardian_play_purchase_cancelled', { planId: selectedPlanId })
      } else if (kind === 'pending') {
        setPhase('plans')
        setNotice(`Google Play is still processing your payment. ${childName}’s ` +
          'account unlocks automatically once it completes — no need to buy again.')
      } else {
        setError({
          kind: 'purchase',
          message: kind === 'unavailable'
            ? 'Google Play billing isn’t available on this device. ' +
              'Make sure the Play Store is installed and signed in.'
            : 'The purchase could not be started. Please try again.',
        })
        setPhase('error')
      }
    }
  }

  async function handleRestore() {
    if (busy) return
    setNotice('')
    setError(null)
    setPhase('restoring')
    try {
      const purchases = await restorePlayPurchases()
      if (!mountedRef.current) return
      if (!purchases.length) {
        setPhase('plans')
        setNotice('No previous purchases were found on this Google account.')
        return
      }
      // A restore names no child: it enumerates whatever this Google
      // account owns and cannot know who each purchase was for. The
      // server credits the payer and the plan reaches every linked child
      // through the family cascade.
      const data = await verifyPlayPurchases({ purchases, source: 'restore' })
      if (!mountedRef.current) return
      const active = (data?.results || []).find((r) => r.status === 'active')
      if (active) {
        purchaseRef.current = { productId: active.productId, planId: active.planId }
        setPhase('success')
        capture('guardian_play_restore_succeeded', { planId: active.planId })
        onPaid?.()
      } else {
        setPhase('plans')
        setNotice('No active plan found to restore on this Google account.')
      }
    } catch (err) {
      if (!mountedRef.current) return
      reportClientError(err, 'parentPlayCheckout.restore')
      setPhase('plans')
      setNotice('Could not restore purchases. Please try again.')
    }
  }

  if (phase === 'success') {
    return (
      <div className="lhx-card" style={{ padding: 16 }} role="status">
        <p className="lhx-set-title">{childName} is unlocked 🎉</p>
        <p className="lhx-set-desc" style={{ marginTop: 6, lineHeight: 1.5 }}>
          Everything is open on {childName}’s account now. Their streak, XP and
          badges are exactly where they left them.
        </p>
      </div>
    )
  }

  if (phase === 'error' && error) {
    return (
      <div className="lhx-card" style={{ padding: 16 }}>
        <p className="lhx-set-title">We hit a snag</p>
        <p className="lhx-set-desc" style={{ marginTop: 6, lineHeight: 1.5 }} role="alert">
          {error.message}
        </p>
        {/* A config failure cannot be retried into success, so it is not
            offered as one. Every other kind can. */}
        {!error.config && (
          <button
            type="button"
            className="lhx-btn lhx-btn-primary lhx-btn-block"
            onClick={() => {
              if (error.kind === 'verify') runVerify('purchase')
              else if (error.kind === 'load') loadProducts()
              else { setError(null); setPhase('plans') }
            }}
          >
            Try again
          </button>
        )}
      </div>
    )
  }

  if (phase === 'loading') {
    return (
      <p className="pax-note" role="status">Loading plans from Google Play…</p>
    )
  }

  return (
    <>
      <h2 className="lhx-set-head">Choose a plan</h2>
      <div className="pax-passes" role="radiogroup" aria-label="Choose a plan">
        {products.map((p) => (
          <button
            type="button"
            key={p.planId}
            role="radio"
            aria-checked={p.planId === selectedPlanId}
            className={`pax-pass ${p.planId === selectedPlanId ? 'is-selected' : ''}`}
            onClick={() => setSelectedPlanId(p.planId)}
            disabled={busy}
          >
            {/* Play's own localized price — never a ZMW literal. */}
            <b>{p.priceString}</b>
            <small>{p.title || p.planId}</small>
            <small>{p.renews ? 'Renews automatically' : 'One-off — does not renew'}</small>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="lhx-btn lhx-btn-primary lhx-btn-block"
        onClick={handleBuy}
        disabled={disabled || busy || !selected}
      >
        {phase === 'purchasing' ? 'Opening Google Play…'
          : phase === 'verifying' ? 'Confirming your purchase…'
            : selected ? `Continue · unlock for ${childName}` : 'Choose a plan'}
      </button>

      <button
        type="button"
        className="lhx-btn lhx-btn-soft lhx-btn-block"
        onClick={handleRestore}
        disabled={busy}
      >
        {phase === 'restoring' ? 'Restoring…' : 'Restore purchases'}
      </button>

      <p className="pax-note" role="status">
        {notice || (selected?.renews
          ? `Billed securely through Google Play. This unlocks ${childName}’s account, not yours. ` +
            'Manage or cancel any time in Google Play.'
          : `Billed securely through Google Play. This unlocks ${childName}’s account, not yours.`)}
      </p>
    </>
  )
}
