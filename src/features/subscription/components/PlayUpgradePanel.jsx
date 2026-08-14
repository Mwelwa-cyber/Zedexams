import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Sparkles, X } from '../../../shared/components/icons'
import { useAuth } from '../../../contexts/AuthContext'
import { PLANS } from '../../../utils/subscriptionConfig'
import { resolveSubscriptionStatus } from '../../../utils/subscriptionStatus'
import { resolveNativePlanIds } from '../../../utils/playBillingCatalog'
import {
  classifyPurchaseError,
  fetchPlayProducts,
  openPlaySubscriptionManagement,
  purchasePlaySubscription,
  restorePlayPurchases,
  verifyPlayPurchases,
} from '../../../utils/playBilling'
import { capture } from '../../../utils/analytics'
import Button from '../../../shared/components/Button'
import Icon from '../../../shared/components/Icon'

// Android replacement for the Lenco checkout inside UpgradeModal. Google Play
// policy: digital subscriptions in the app sell through Google Play Billing
// ONLY — no mobile-money copy, no ZMW price literals (Play's own localized
// priceString is displayed instead), no external payment links.
//
// phase machine: loading → plans → purchasing → verifying → success | error
//                (+ restoring, and a terminal `managed` panel when the user
//                already has an active subscription)

const PORTAL_COPY = {
  learner: {
    title: 'Unlock Premium Learning',
    subtitle: 'Unlimited quizzes · exam mode · weakness analysis',
  },
  teacher: {
    title: 'Subscribe to Teacher Portal',
    subtitle: 'Unlock premium teacher tools',
  },
  maxUpgrade: {
    title: 'Upgrade to Max',
    subtitle: 'Unlimited generations · bulk export · priority queue',
  },
  generic: {
    title: 'Upgrade to Premium',
    subtitle: 'Unlock unlimited learning',
  },
}

const PLAN_BORDER = {
  weekly: 'border-amber-400 bg-amber-50',
  monthly: 'border-green-400 bg-green-50',
  pro_monthly: 'border-orange-400 bg-orange-50',
  pro_yearly: 'border-orange-400 bg-orange-50',
  max_monthly: 'border-blue-500 bg-blue-50',
  max_yearly: 'border-blue-500 bg-blue-50',
}
const FALLBACK_BORDER = 'border-orange-400 bg-orange-50'

function formatExpiry(value) {
  if (!value) return null
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

export default function PlayUpgradePanel({ onClose, portal, planIds, defaultPlanId }) {
  const copy = PORTAL_COPY[portal] || PORTAL_COPY.generic
  const { currentUser, userProfile } = useAuth()

  const subStatus = resolveSubscriptionStatus(userProfile)
  const alreadyActive = subStatus.isPro

  const nativePlanIds = resolveNativePlanIds(planIds, portal).filter((id) => PLANS[id])

  const [phase, setPhase] = useState(alreadyActive ? 'managed' : 'loading')
  const [products, setProducts] = useState([])
  const [selectedPlanId, setSelectedPlanId] = useState(
    defaultPlanId && nativePlanIds.includes(defaultPlanId) ? defaultPlanId : null
  )
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(null) // { kind: 'load'|'purchase'|'verify'|'wrong_user', message }

  // The purchase we still owe the backend a verification for. Retry re-sends
  // THIS token — it never re-launches the purchase sheet.
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
      const items = await fetchPlayProducts(nativePlanIds)
      if (!mountedRef.current) return
      if (!items.length) {
        setError({ kind: 'load', message: 'Subscriptions are not available right now. Please try again shortly.' })
        setPhase('error')
        return
      }
      setProducts(items)
      setSelectedPlanId((current) => (
        current && items.some((item) => item.planId === current)
          ? current
          : items[0]?.planId || null
      ))
      setPhase('plans')
    } catch {
      if (!mountedRef.current) return
      setError({ kind: 'load', message: 'Could not load subscriptions from Google Play. Check your connection and try again.' })
      setPhase('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativePlanIds.join(',')])

  useEffect(() => {
    if (!alreadyActive) loadProducts()
  }, [alreadyActive, loadProducts])

  const busy = phase === 'purchasing' || phase === 'verifying' || phase === 'restoring'
  const selectedProduct = products.find((p) => p.planId === selectedPlanId) || null

  async function runVerify(source) {
    if (!purchaseRef.current) return
    setPhase('verifying')
    setError(null)
    try {
      const data = await verifyPlayPurchases({ purchases: [purchaseRef.current], source })
      if (!mountedRef.current) return
      const result = (data?.results || [])[0] || {}
      if (result.status === 'active') {
        purchaseRef.current = { ...purchaseRef.current, expiryTime: result.expiryTime, planId: result.planId }
        setPhase('success')
        capture('play_purchase_succeeded', { planId: result.planId || selectedPlanId })
        return
      }
      // wrong_user: token already granted to another account (replay guard).
      // account_mismatch: the purchase was stamped with a different account's
      // id (issue #1596 enforcement). Both mean "not this account" — same UX.
      if (result.status === 'wrong_user' || result.status === 'account_mismatch') {
        setError({
          kind: 'wrong_user',
          message: 'This purchase is linked to a different ZedExams account. Sign in with the account that made it, or contact support.',
        })
        setPhase('error')
        return
      }
      setError({ kind: 'verify', message: '' })
      setPhase('error')
      capture('play_verify_failed', { planId: selectedPlanId, status: result.status || 'unknown' })
    } catch (err) {
      if (!mountedRef.current) return
      // failed-precondition = the server said OUR config is broken (bad SA
      // secret / Play Console linkage) — retrying can't succeed until an
      // admin fixes it, so the dialog must not pretend a retry will.
      const config = err?.code === 'functions/failed-precondition'
      setError({ kind: 'verify', config, message: '' })
      setPhase('error')
      // Record the callable's HttpsError code/message/reason, not just a bare
      // 'request-error'. A thrown verification failure (bad/absent SA secret,
      // Play Developer API 401/403, or App Check rejection) is otherwise
      // indistinguishable in analytics from a transient network blip — every
      // cause collapses to the same 'request-error' with no way to tell them
      // apart without a server-log dive. `errorReason` carries the config
      // stage (sa-json-missing / token-fetch-failed / play-api-rejected / …)
      // the server pins in HttpsError details.
      capture('play_verify_failed', {
        planId: selectedPlanId,
        status: 'request-error',
        errorCode: err?.code || '',
        errorReason: err?.details?.reason || '',
        errorMessage: String(err?.message || '').slice(0, 300),
      })
    }
  }

  async function handleBuy() {
    if (!selectedPlanId || busy) return
    setNotice('')
    setError(null)
    setPhase('purchasing')
    capture('play_purchase_initiated', { planId: selectedPlanId })
    try {
      const purchase = await purchasePlaySubscription(selectedPlanId, currentUser?.uid)
      purchaseRef.current = purchase
      await runVerify('purchase')
    } catch (err) {
      if (!mountedRef.current) return
      const kind = classifyPurchaseError(err)
      if (kind === 'not-completed') {
        // Covers user-cancel AND already-owned (the plugin can't tell them
        // apart) — hence the restore hint instead of an error screen.
        setPhase('plans')
        setNotice('The purchase didn’t complete — you have not been charged. Already subscribed on this Google account? Tap "Restore purchases".')
        capture('play_purchase_cancelled', { planId: selectedPlanId })
      } else if (kind === 'pending') {
        setPhase('plans')
        setNotice('Google Play is still processing your payment. Your access unlocks automatically once it completes — no need to buy again.')
      } else {
        setError({
          kind: 'purchase',
          message: kind === 'unavailable'
            ? 'Google Play billing isn’t available on this device. Make sure the Play Store is installed and signed in.'
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
      const data = await verifyPlayPurchases({ purchases, source: 'restore' })
      if (!mountedRef.current) return
      const active = (data?.results || []).find((r) => r.status === 'active')
      if (active) {
        purchaseRef.current = { productId: active.productId, expiryTime: active.expiryTime, planId: active.planId }
        setPhase('success')
        capture('play_restore_succeeded', { planId: active.planId })
      } else {
        setPhase('plans')
        setNotice('No active subscription found to restore on this Google account.')
      }
    } catch {
      if (!mountedRef.current) return
      setPhase('plans')
      setNotice('Could not restore purchases. Please try again.')
    }
  }

  function handleErrorAction() {
    if (!error) return
    if (error.kind === 'verify') runVerify('purchase')
    else if (error.kind === 'load') loadProducts()
    else if (error.kind === 'purchase') { setError(null); setPhase('plans') }
    else onClose()
  }

  const successPlan = PLANS[purchaseRef.current?.planId] || PLANS[selectedPlanId] || null
  const successExpiry = formatExpiry(purchaseRef.current?.expiryTime)

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg my-4 max-h-[90vh] flex flex-col overflow-hidden animate-scale-in">
        <div className="bg-gradient-to-r from-yellow-400 to-orange-400 p-5 text-center relative shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upgrade dialog"
            className="absolute top-3 right-4 text-white/80 hover:text-white min-h-0 p-1 bg-transparent shadow-none"
          >
            <Icon as={X} size="md" />
          </button>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-white">
            <Icon as={Sparkles} size="lg" strokeWidth={2.1} />
          </div>
          <h2 className="text-2xl font-black text-white">{copy.title}</h2>
          <p className="text-white/90 text-sm mt-1">{copy.subtitle}</p>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {/* ── Already subscribed → manage, don't double-sell ──────── */}
          {phase === 'managed' && (
            <div className="text-center py-2">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600">
                <Icon as={Check} size="lg" strokeWidth={2.4} />
              </div>
              <h3 className="text-lg font-black text-gray-800">
                You&rsquo;re on {subStatus.planLabel}
              </h3>
              <p className="text-sm text-gray-600 mt-2">
                {userProfile?.subscriptionProvider === 'google_play'
                  ? `Your subscription renews through Google Play${formatExpiry(subStatus.expiry) ? ` — current period ends ${formatExpiry(subStatus.expiry)}` : ''}.`
                  : `Your current plan was purchased on zedexams.com and stays active${formatExpiry(subStatus.expiry) ? ` until ${formatExpiry(subStatus.expiry)}` : ''}. To change or renew it, visit zedexams.com in a browser.`}
              </p>
              {userProfile?.subscriptionProvider === 'google_play' && (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  className="mt-5"
                  onClick={() => openPlaySubscriptionManagement(userProfile?.googlePlayProductId)}
                >
                  Manage Google Play Subscription
                </Button>
              )}
              <Button variant="primary" size="lg" fullWidth className="mt-3" onClick={onClose}>
                Done
              </Button>
            </div>
          )}

          {/* ── Loading products ─────────────────────────────────────── */}
          {phase === 'loading' && (
            <div className="text-center py-8">
              <Icon as={Loader2} size="lg" className="mx-auto animate-spin text-[#B8860B]" />
              <p className="text-sm text-gray-600 mt-3">Loading subscriptions from Google Play…</p>
            </div>
          )}

          {/* ── Plan cards ───────────────────────────────────────────── */}
          {phase === 'plans' && (
            <>
              {notice && (
                <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700" role="status">
                  {notice}
                </div>
              )}
              <div className="grid gap-3 mb-4">
                {products.map((product) => {
                  const item = PLANS[product.planId]
                  if (!item) return null
                  const active = selectedPlanId === product.planId
                  const activeBorder = PLAN_BORDER[product.planId] || FALLBACK_BORDER
                  const features = (item.features || []).filter((f) => !/K\d/.test(f))
                  return (
                    <button
                      key={product.planId}
                      onClick={() => setSelectedPlanId(product.planId)}
                      className={`w-full text-left p-4 rounded-2xl border-2 transition-all min-h-0 ${active ? activeBorder + ' ring-2 ring-offset-1 ring-current' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-black text-gray-800 text-lg">{item.badge} {item.name}</span>
                          <span className="ml-2 text-gray-500 text-sm">{item.tagline}</span>
                        </div>
                        <div className="text-right">
                          <div className="font-black text-xl text-gray-800">{product.priceString}</div>
                          <div className="text-xs text-gray-500">via Google Play</div>
                        </div>
                      </div>
                      {features.length > 0 && (
                        <ul className="mt-3 space-y-1">
                          {features.map((feature) => (
                            <li key={feature} className="text-sm text-gray-700 flex items-center gap-2">
                              <Icon as={Check} size="sm" strokeWidth={2.1} className="text-green-500" />
                              {feature}
                            </li>
                          ))}
                        </ul>
                      )}
                    </button>
                  )
                })}
              </div>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                disabled={!selectedProduct}
                onClick={handleBuy}
              >
                {selectedProduct
                  ? `Subscribe with Google Play · ${selectedProduct.priceString}`
                  : 'Select a Plan'}
              </Button>
              <button
                type="button"
                onClick={handleRestore}
                className="mt-3 w-full text-center text-sm font-bold text-[#B8860B] bg-transparent shadow-none min-h-0"
              >
                Restore purchases
              </button>
            </>
          )}

          {/* ── Purchasing (Play sheet is up) ────────────────────────── */}
          {phase === 'purchasing' && (
            <div className="text-center py-8">
              <Icon as={Loader2} size="lg" className="mx-auto animate-spin text-[#B8860B]" />
              <h3 className="text-base font-black text-gray-800 mt-3">Complete your purchase</h3>
              <p className="text-sm text-gray-600 mt-1">
                Finish the payment in the Google Play window.
              </p>
            </div>
          )}

          {/* ── Verifying with our server ────────────────────────────── */}
          {(phase === 'verifying' || phase === 'restoring') && (
            <div className="text-center py-8">
              <Icon as={Loader2} size="lg" className="mx-auto animate-spin text-[#B8860B]" />
              <p className="text-sm text-gray-600 mt-3">
                {phase === 'restoring' ? 'Checking your Google Play purchases…' : 'Confirming your purchase…'}
              </p>
            </div>
          )}

          {/* ── Success ──────────────────────────────────────────────── */}
          {phase === 'success' && (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
                <Icon as={Check} size="lg" strokeWidth={2.6} />
              </div>
              <h3 className="text-xl font-black text-gray-800">Subscription active 🎉</h3>
              <p className="text-sm text-gray-600 mt-1">
                {successPlan ? `Your ${successPlan.name} plan is active` : 'Your plan is active'}
                {successExpiry ? ` — current period ends ${successExpiry}` : ''}.
                A receipt is on its way to your email.
              </p>
              <Button variant="primary" size="lg" fullWidth className="mt-5" onClick={onClose}>
                Start learning
              </Button>
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────── */}
          {phase === 'error' && (
            <div className="text-center py-4">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
                <Icon as={X} size="lg" strokeWidth={2.4} />
              </div>
              <h3 className="text-lg font-black text-gray-800">
                {error?.kind === 'verify'
                  ? (error?.config ? 'Payment received — we’re on it' : 'Payment received — verification pending')
                  : 'Something went wrong'}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {error?.kind === 'verify'
                  ? (error?.config
                    ? 'Google Play confirmed your payment, but a problem on our side is stopping us from confirming it. Our team has been alerted automatically. You won’t be charged twice — your access unlocks on its own once this is fixed, and if we can’t confirm within 3 days Google refunds you automatically.'
                    : 'Google Play confirmed your payment but we couldn’t verify it with our server. Tap retry — you won’t be charged again. It also completes automatically next time you open the app.')
                  : (error?.message || 'Please try again.')}
              </p>
              {error?.kind !== 'wrong_user' && (
                <Button variant="primary" size="lg" fullWidth className="mt-5" onClick={handleErrorAction}>
                  {error?.kind === 'verify' ? 'Retry verification' : 'Try again'}
                </Button>
              )}
              <Button
                variant={error?.kind === 'wrong_user' ? 'primary' : 'ghost'}
                size={error?.kind === 'wrong_user' ? 'lg' : 'sm'}
                fullWidth
                className="mt-3"
                onClick={onClose}
              >
                Close
              </Button>
            </div>
          )}

          {phase !== 'managed' && (
            <p className="text-center text-[11px] text-gray-400 mt-4">
              Billed securely through Google Play · manage or cancel anytime in the Play Store
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
