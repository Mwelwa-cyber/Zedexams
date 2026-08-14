import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Loader2, Lock, Sparkles, X } from '../../../components/ui/icons'
import { isNativePlatform } from '../../../utils/runtime'
import { markPremiumActionPaid } from '../lib/pendingPremiumAction'
import { resolveInvoicePdfUrl } from '../../../utils/invoices'
import { useAuth } from '../../../contexts/AuthContext'
import { useDataSaver } from '../../../contexts/DataSaverContext'
import { PLANS } from '../../../utils/subscriptionConfig'
import { getUpgradeQuoteForProfile } from '../../../utils/subscriptionUpgrade'
import { capture } from '../../../utils/analytics'
import { friendlyMessage } from '../../../utils/friendlyErrors'
import {
  OPERATORS,
  getUpgradeQuote,
  initiateLencoPayment,
  looksLikeZambianPhone,
  pollLencoStatus,
  resolveOperator,
  submitLencoOtp,
} from '../../../utils/lenco'
import { formatZambianPhoneInput, zambianPhoneDigits } from '../../../utils/phoneFormat'
import Button from '../../../components/ui/Button'
import Icon from '../../../components/ui/Icon'
import NetworkField from './NetworkField'
import PaymentStatusTracker from './PaymentStatusTracker'

const DEFAULT_PLAN_ORDER_BY_PORTAL = {
  learner: ['weekly', 'monthly'],
  teacher: ['pro_monthly', 'pro_yearly'],
  generic: ['weekly', 'monthly'],
}

// Per-portal presentation. `emblem` is the badge glyph in the header circle,
// `chips` is the optional feature-strip under the subtitle, and `popularPlanId`
// flags the plan that gets the "Most popular" ribbon. Everything else about a
// plan (price, features, tagline) still comes from PLANS — this is chrome only.
const PORTAL_COPY = {
  learner: {
    emblem: '✨',
    title: 'Unlock Premium Learning',
    subtitle: 'Unlimited quizzes · exam mode · weakness analysis',
    popularPlanId: 'monthly',
  },
  teacher: {
    emblem: '🦊',
    title: 'Subscribe to Teacher Portal',
    subtitle: 'Unlock premium teacher tools',
    popularPlanId: 'pro_monthly',
  },
  maxUpgrade: {
    emblem: '👑',
    title: 'Upgrade to Max',
    subtitle: 'Unlock unlimited power for serious teaching',
    popularPlanId: 'max_monthly',
    chips: [
      { emoji: '🔥', label: 'Unlimited generations' },
      { emoji: '📦', label: 'Bulk export' },
      { emoji: '⚡', label: 'Priority queue' },
      { emoji: '💬', label: '24/7 support' },
    ],
  },
  generic: {
    emblem: '✨',
    title: 'Upgrade to Premium',
    subtitle: 'Unlock unlimited learning',
  },
}

// Percentage a yearly plan saves against paying its own monthly sibling for the
// same span — i.e. the "N months free" deal — computed from config so the badge
// tracks real pricing and matches the plan's "Save ~17%" copy. Null for
// anything that isn't an annual plan with a monthly sibling.
function yearlySavingsPct(item) {
  if (item?.billing !== 'yearly' || !item?.priceZMW || !item?.durationDays) return null
  const monthly = Object.values(PLANS).find((p) => p.tier === item.tier && p.billing === 'monthly')
  if (!monthly?.priceZMW) return null
  const months = Math.round(item.durationDays / 30)      // 12 for a year
  const paidMonths = item.priceZMW / monthly.priceZMW    // e.g. 1490 / 149 = 10
  if (months <= 0) return null
  const pct = Math.round((1 - paidMonths / months) * 100)
  return pct > 0 ? pct : null
}

function billingUnit(item) {
  if (item?.billing === 'yearly') return '/ year'
  if (item?.billing === 'monthly') return '/ month'
  if (item?.durationDays) return `/ ${item.durationDays} days`
  return ''
}

// Android (Capacitor) builds sell through Google Play Billing ONLY — Play
// policy forbids alternative payment flows for digital goods in the app, so
// the Lenco mobile-money checkout below must never render natively. This
// dispatcher is the single seam: every one of the ~11 open-sites of
// <UpgradeModal /> gets the right checkout with zero call-site edits.
// The internal <Suspense> is load-bearing: most call sites render this
// component with no local boundary, so without it the native branch would
// suspend all the way up to the route-level fallback and blank the page.
const PlayUpgradePanel = lazy(() => import('./PlayUpgradePanel'))

export default function UpgradeModal(props) {
  if (isNativePlatform()) {
    return (
      <Suspense fallback={null}>
        <PlayUpgradePanel {...props} />
      </Suspense>
    )
  }
  return <LencoUpgradeModal {...props} />
}

// payState machine: idle → starting → (otp | processing) → success | failed
function LencoUpgradeModal({ onClose, portal, planIds, defaultPlanId }) {
  const copy = PORTAL_COPY[portal] || PORTAL_COPY.generic
  const { userProfile, currentUser } = useAuth()
  const { dataSaver } = useDataSaver()
  const navigate = useNavigate()
  const location = useLocation()
  const pendingReferralCredits = Number(userProfile?.referralCredits || 0)

  const defaultOrder =
    DEFAULT_PLAN_ORDER_BY_PORTAL[portal] || DEFAULT_PLAN_ORDER_BY_PORTAL.generic
  const visiblePlanIds = (planIds && planIds.length ? planIds : defaultOrder)
    .filter((id) => PLANS[id])
  const popularPlanId = copy.popularPlanId && visiblePlanIds.includes(copy.popularPlanId)
    ? copy.popularPlanId
    : null
  const [step, setStep] = useState('plans')
  const [selectedPlanId, setSelectedPlanId] = useState(
    defaultPlanId && visiblePlanIds.includes(defaultPlanId) ? defaultPlanId : null
  )

  // ── Checkout state ──────────────────────────────────────────────
  const method = 'mobile_money'
  const [phone, setPhone] = useState('')
  const [operator, setOperator] = useState('')
  const [operatorTouched, setOperatorTouched] = useState(false)
  const [otp, setOtp] = useState('')
  const [paymentId, setPaymentId] = useState(null)
  const [payState, setPayState] = useState('idle')
  const [error, setError] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  // Visual stage of the pending screen: 'waiting' (check your phone) →
  // 'verifying' (after "I have approved"). Purely presentational — the poll
  // + webhook confirm regardless of which stage is on screen.
  const [approvalStage, setApprovalStage] = useState('waiting')
  const [checkingStatus, setCheckingStatus] = useState(false)
  // "View receipt" on the success screen: idle | loading | missing (the PDF
  // is generated asynchronously after activation, so it may not exist yet).
  const [receiptState, setReceiptState] = useState('idle')

  // Server-authoritative price for the checkout screen. The client mirror
  // (getUpgradeQuoteForProfile) paints instantly as a placeholder; the
  // getUpgradeQuote callable then confirms the amount + renewal date, and
  // handlePay echoes the displayed amount back so the server refuses to
  // charge anything else (code 'quote-changed').
  const [serverQuote, setServerQuote] = useState(null)
  const [quoteState, setQuoteState] = useState('idle') // idle|loading|ready|error
  const [quoteNotice, setQuoteNotice] = useState('')
  const [quoteAttempt, setQuoteAttempt] = useState(0)

  // Abort token so an in-flight poll stops if the modal unmounts.
  const pollAbortRef = useRef({ aborted: false })
  useEffect(() => {
    const token = pollAbortRef.current
    return () => { token.aborted = true }
  }, [])

  // Fetch the authoritative quote whenever the checkout opens, the plan
  // changes, or the buyer retries after a network error. Responses are keyed
  // by planId (see quoteForPlan) so a stale response for a previously
  // selected plan can never misprice the current one.
  useEffect(() => {
    if (step !== 'checkout' || !selectedPlanId) return undefined
    let cancelled = false
    setQuoteState('loading')
    setQuoteNotice('')
    getUpgradeQuote(selectedPlanId)
      .then((q) => {
        if (cancelled) return
        setServerQuote(q)
        setQuoteState('ready')
      })
      .catch(() => { if (!cancelled) setQuoteState('error') })
    return () => { cancelled = true }
  }, [step, selectedPlanId, quoteAttempt])

  // Funnel analytics: fire once per checkout entry when the number first
  // becomes valid, and when a supported network is first detected. The
  // number itself is never captured.
  const numberEnteredRef = useRef(false)
  const networkDetectedRef = useRef(false)
  useEffect(() => {
    if (step !== 'checkout') {
      numberEnteredRef.current = false
      networkDetectedRef.current = false
      return
    }
    if (phoneValid && !numberEnteredRef.current) {
      numberEnteredRef.current = true
      capture('lenco_number_entered', { planId: selectedPlanId })
    }
    if (phoneValid && detectedOperator && !networkDetectedRef.current) {
      networkDetectedRef.current = true
      capture('lenco_network_detected', { planId: selectedPlanId, operator: detectedOperator })
    }
  })

  const plan = selectedPlanId ? PLANS[selectedPlanId] : null

  // Pro → Max upgrade pricing: the server charges only the prorated difference
  // for the days left and keeps the current renewal date. The client mirror
  // paints instantly; once the server quote for THIS plan lands it wins.
  const upgradeQuote = selectedPlanId ? getUpgradeQuoteForProfile(userProfile, selectedPlanId) : null
  const clientIsUpgrade = !!upgradeQuote?.isUpgrade
  const clientPrice = clientIsUpgrade ? upgradeQuote.amountZMW : (plan?.priceZMW ?? 0)
  const quoteForPlan = serverQuote?.planId === selectedPlanId ? serverQuote : null
  const isUpgrade = quoteForPlan ? !!quoteForPlan.isUpgrade : clientIsUpgrade
  const effectivePrice = quoteForPlan ? Number(quoteForPlan.amountZMW) : clientPrice
  const daysRemaining = Number(quoteForPlan ? quoteForPlan.daysRemaining : upgradeQuote?.daysRemaining) || 0
  const renewalDate = quoteForPlan?.renewalDate
    ? new Date(quoteForPlan.renewalDate)
    : (clientIsUpgrade ? upgradeQuote.expiry : null)
  const renewalDateLabel = renewalDate && !Number.isNaN(renewalDate.getTime())
    ? renewalDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : null

  const userEmail = userProfile?.email || currentUser?.email || ''
  const phoneValid = looksLikeZambianPhone(phone)
  const detectedOperator = resolveOperator({ phone, operator, operatorTouched })
  const busy = payState === 'starting' || payState === 'processing' || payState === 'verifying'
  const isYearly = plan?.billing === 'yearly'

  function handleContinue() {
    if (!plan) return
    setStep('checkout')
    capture('subscription_intent', {
      planId: selectedPlanId,
      amountZmw: effectivePrice ?? null,
      durationDays: plan.durationDays ?? null,
      isUpgrade,
    })
  }

  function resolveTerminal(status) {
    if (status === 'successful') {
      setPayState('success')
      capture('lenco_payment_succeeded', { planId: selectedPlanId, method })
      return true
    }
    if (status === 'failed') {
      setPayState('failed')
      setError('The mobile-money provider did not confirm the payment. No money was taken — you can try again.')
      capture('lenco_payment_failed', { planId: selectedPlanId, method })
      return true
    }
    return false
  }

  async function beginPolling(ref, { maxAttempts = 40 } = {}) {
    setPayState('processing')
    setTimedOut(false)
    const final = await pollLencoStatus(ref, {
      maxAttempts,
      signal: pollAbortRef.current,
      onTick: (status) => { if (status === 'successful' || status === 'failed') resolveTerminal(status) },
    })
    if (pollAbortRef.current.aborted) return
    if (!resolveTerminal(final)) {
      // Still pending after the poll window — the webhook will finish it.
      setTimedOut(true)
    }
  }

  // Timeout screen's "Check payment status": one short re-poll of the SAME
  // transaction — never a new payment.
  async function handleCheckStatus() {
    if (!paymentId || checkingStatus) return
    setCheckingStatus(true)
    try {
      await beginPolling(paymentId, { maxAttempts: 4 })
    } finally {
      setCheckingStatus(false)
    }
  }

  // Confirmed cancel from the pending screen: stop the poll and close. The
  // payment doc stays pending server-side — if the buyer already approved on
  // the phone, the webhook (or Till) still activates them, and reopening the
  // checkout resumes this same reference via the duplicate-initiation guard.
  function handleCancelPending() {
    pollAbortRef.current.aborted = true
    capture('lenco_payment_cancelled', { planId: selectedPlanId, via: 'pending-screen' })
    onClose()
  }

  // Success screen's "Continue to my work": return the teacher to the exact
  // route the paywall interrupted (if this checkout was reached from one and
  // they've since navigated away — e.g. via "Compare plans" → /pricing).
  // The studio's own draft system restores the form; the profile snapshot
  // (AuthContext onSnapshot) has already refreshed the plan, so the gate
  // that blocked them no longer fires. The record is stamped 'paid' (not
  // consumed) so PostUpgradeContinuation can show the pick-up-where-you-
  // left-off card inside the studio — that card consumes it.
  function handleReturnToWork() {
    const action = markPremiumActionPaid()
    const here = location.pathname + location.search
    const navigated = !!(action?.sourceRoute && action.sourceRoute !== here)
    capture('paywall_return_to_work', {
      tool: action?.tool || null,
      reason: action?.reason || null,
      navigated,
    })
    if (navigated) navigate(action.sourceRoute)
    onClose()
  }

  // The receipt PDF is generated + emailed asynchronously after activation;
  // open it when it's ready, otherwise reassure that it's on its way.
  async function handleViewReceipt() {
    if (receiptState === 'loading') return
    setReceiptState('loading')
    const uid = currentUser?.uid
    const url = uid && paymentId
      ? await resolveInvoicePdfUrl(`invoices/${uid}/${paymentId}.pdf`)
      : null
    if (url) {
      setReceiptState('idle')
      window.open(url, '_blank', 'noopener')
    } else {
      setReceiptState('missing')
    }
  }

  async function handlePay() {
    if (!plan || busy) return
    // The button is disabled until these hold; belt-and-braces for keyboard
    // submission paths.
    if (!phoneValid) { setError('Enter a valid Zambian mobile number, e.g. 0977 740 465.'); return }
    if (!detectedOperator) { setError('Please choose your mobile money operator.'); return }
    setError('')
    setQuoteNotice('')

    setPayState('starting')
    capture('lenco_payment_initiated', { planId: selectedPlanId, method })
    try {
      const payload = {
        planId: selectedPlanId,
        method,
        // Spaces are display-only — submit the bare digits.
        phone: zambianPhoneDigits(phone),
        operator: detectedOperator,
        // Echo the displayed amount; the server refuses to charge a different
        // one and returns the fresh quote instead (code 'quote-changed').
        expectedAmountZMW: effectivePrice,
      }

      const res = await initiateLencoPayment(payload)
      setPaymentId(res.paymentId)

      if (resolveTerminal(res.status)) return
      if (res.requiresOtp || res.status === 'otp-required') {
        setPayState('otp')
        return
      }
      // res.reused means a prompt for this exact purchase is already live on
      // the phone (double-tap / reopened checkout) — no second charge was
      // created; we simply resume waiting on the existing one.
      await beginPolling(res.paymentId)
    } catch (err) {
      if (err?.details?.code === 'quote-changed') {
        // The price moved between display and charge (e.g. a day boundary
        // changed the prorated days-remaining). Nothing was charged — show
        // the updated amount and let the teacher confirm again.
        setServerQuote({ planId: selectedPlanId, ...err.details })
        setQuoteState('ready')
        setQuoteNotice('Your amount has been updated — we recalculated it using your current subscription period. Review it below before paying.')
        setPayState('idle')
        capture('lenco_quote_changed', { planId: selectedPlanId })
        return
      }
      setPayState('failed')
      setError(friendlyMessage(err, 'Could not start the payment. Please try again.'))
      capture('lenco_payment_failed', { planId: selectedPlanId, method, reason: 'initiate_error' })
    }
  }

  async function handleSubmitOtp() {
    if (!paymentId || !otp.trim() || busy) return
    setError('')
    setPayState('verifying')
    try {
      const res = await submitLencoOtp({ paymentId, otp: otp.trim() })
      if (resolveTerminal(res.status)) return
      if (res.requiresOtp || res.status === 'otp-required') {
        setPayState('otp')
        setError('That code was not accepted. Please re-enter it.')
        return
      }
      await beginPolling(paymentId)
    } catch (err) {
      setPayState('otp')
      setError(friendlyMessage(err, 'The code could not be verified. Please try again.'))
    }
  }

  function resetCheckout() {
    setPayState('idle')
    setError('')
    setOtp('')
    setPaymentId(null)
    setTimedOut(false)
    setApprovalStage('waiting')
    setCheckingStatus(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl my-4 max-h-[92vh] flex flex-col overflow-hidden animate-scale-in">
        {step === 'plans' && (
          <>
            {/* ── Header ─────────────────────────────────────────── */}
            <div className="relative shrink-0 bg-gradient-to-b from-orange-100 via-orange-50 to-white px-6 pt-6 pb-5 text-center">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close upgrade dialog"
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 min-h-0 p-1 bg-transparent shadow-none"
              >
                <Icon as={X} size="md" />
              </button>
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-500 text-2xl shadow-lg shadow-orange-500/30">
                {copy.emblem
                  ? <span aria-hidden="true">{copy.emblem}</span>
                  : <Icon as={Sparkles} size="lg" className="text-white" />}
              </div>
              <h2 className="text-2xl font-black text-gray-900">{copy.title}</h2>
              <p className="text-sm text-gray-500 mt-1">{copy.subtitle}</p>
              {copy.chips?.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
                  {copy.chips.map((c) => (
                    <span key={c.label} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600">
                      <span aria-hidden="true">{c.emoji}</span>{c.label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── Plan picker ────────────────────────────────────── */}
            {/* pt-4 keeps the "Most popular" ribbon (which pokes -top-2.5 above
                its card) clear of this scroll container's overflow clip. */}
            <div className="px-6 pt-4 pb-6 overflow-y-auto flex-1">
              {pendingReferralCredits > 0 && (
                <div
                  className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
                  role="status"
                >
                  <p className="font-bold">
                    🎁 {pendingReferralCredits} free month{pendingReferralCredits === 1 ? '' : 's'} from referrals
                  </p>
                  <p className="text-xs mt-1 text-emerald-800/90">
                    We add {pendingReferralCredits * 30} bonus day{pendingReferralCredits === 1 ? '' : 's'} automatically
                    when your payment completes.
                  </p>
                </div>
              )}

              <div className="grid gap-3 mb-4">
                {visiblePlanIds.map((planId) => {
                  const item = PLANS[planId]
                  const active = selectedPlanId === planId
                  const isPopular = planId === popularPlanId
                  const cardQuote = getUpgradeQuoteForProfile(userProfile, planId)
                  const cardPrice = cardQuote.isUpgrade ? cardQuote.amountZMW : item.priceZMW
                  const savings = yearlySavingsPct(item)
                  const showCalendar = isYearlyCard(item) && !dataSaver
                  return (
                    <button
                      key={planId}
                      onClick={() => setSelectedPlanId(planId)}
                      aria-pressed={active}
                      className={`relative w-full text-left p-4 pt-5 rounded-2xl border-2 transition-all min-h-0 ${
                        active
                          ? 'border-orange-400 bg-orange-50/50 ring-2 ring-orange-200'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      {isPopular && (
                        <span className="absolute -top-2.5 left-4 inline-flex items-center gap-1 rounded-full bg-indigo-500 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
                          <Icon as={Sparkles} size="xs" className="text-white" strokeWidth={2.2} />
                          Most popular
                        </span>
                      )}

                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-lg"
                            aria-hidden="true"
                          >
                            {item.badge || '⭐'}
                          </span>
                          <span>
                            <span className="block font-black text-gray-900 text-base leading-tight">{item.name}</span>
                            <span className="block text-gray-500 text-xs">{item.tagline}</span>
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-black text-2xl text-gray-900 leading-none">K{cardPrice}</div>
                          <div className="mt-0.5 text-xs text-gray-400">
                            {cardQuote.isUpgrade ? <s>K{item.priceZMW}</s> : billingUnit(item) || 'ZMW'}
                          </div>
                        </div>
                      </div>

                      {cardQuote.isUpgrade && (
                        <p className="mt-2.5 text-xs text-gray-500">
                          Upgrade now — pay only the difference for your {cardQuote.daysRemaining} remaining day
                          {cardQuote.daysRemaining === 1 ? '' : 's'}.{' '}
                          <span className="font-semibold text-gray-600">Your renewal date stays the same.</span>
                        </p>
                      )}

                      <div className="relative mt-3">
                        {item.features?.length > 0 && (
                          <ul
                            className={`grid gap-x-4 gap-y-1.5 ${
                              showCalendar
                                ? 'grid-cols-1 sm:pr-28'
                                : 'grid-cols-1 sm:grid-cols-2'
                            }`}
                          >
                            {item.features.map((feature) => (
                              <li key={feature} className="flex items-start gap-1.5 text-xs text-gray-700">
                                <Icon as={Check} size="xs" strokeWidth={2.4} className="mt-0.5 shrink-0 text-green-500" />
                                <span>{feature}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Calendar illustration + savings ribbon on annual plans */}
                        {showCalendar && (
                          <div className="pointer-events-none absolute -bottom-1 right-1 hidden sm:block">
                            <div className="relative">
                              <img
                                src="/images/upgrade-calendar.webp"
                                alt=""
                                aria-hidden="true"
                                className="h-14 w-auto drop-shadow-sm"
                                loading="lazy"
                              />
                              {savings != null && (
                                <span className="absolute -bottom-1 -left-3 flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-[11px] font-black text-white shadow-md">
                                  −{savings}%
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="mb-4 flex items-center gap-2.5 rounded-2xl bg-gray-50 px-4 py-3 text-center">
                <Icon as={Lock} size="sm" className="shrink-0 text-gray-400" />
                <p className="text-xs text-gray-500 text-left">
                  <span className="font-semibold text-gray-600">Secure payments with Lenco Mobile Money.</span>{' '}
                  You&apos;ll receive a receipt after payment.
                </p>
              </div>

              <Button
                variant="primary"
                size="lg"
                fullWidth
                disabled={!selectedPlanId}
                onClick={handleContinue}
                trailingIcon={selectedPlanId ? <Icon as={ArrowRight} size="sm" /> : undefined}
              >
                {selectedPlanId ? 'Continue to Payment' : 'Select a plan'}
              </Button>
            </div>
          </>
        )}

        {step === 'checkout' && plan && (
          <>
            {/* ── Header with wallet illustration ────────────────── */}
            <div className="relative shrink-0 bg-gradient-to-b from-orange-100 via-orange-50 to-white px-6 pt-4 pb-5 text-center">
              <button
                type="button"
                onClick={() => { if (!busy) { resetCheckout(); setStep('plans') } }}
                disabled={busy}
                className="absolute top-4 left-4 inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-40 min-h-0 p-1 bg-transparent shadow-none"
              >
                <Icon as={ArrowLeft} size="xs" /> Back
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close upgrade dialog"
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 min-h-0 p-1 bg-transparent shadow-none"
              >
                <Icon as={X} size="md" />
              </button>

              {!dataSaver && (
                <img
                  src="/images/upgrade-wallet.webp"
                  alt=""
                  aria-hidden="true"
                  className="mx-auto mt-2 h-24 w-auto drop-shadow-sm"
                  loading="lazy"
                />
              )}
              <h2 className="mt-2 text-2xl font-black text-gray-900">
                {isUpgrade ? 'Complete your upgrade' : 'Complete your payment'}
              </h2>
              <p className="mt-1 flex flex-wrap items-center justify-center gap-2 text-sm text-gray-500">
                <span>{isUpgrade ? "You're upgrading to" : "You're subscribing to"} <span className="font-semibold text-gray-700">{plan.name}</span></span>
                {isYearly && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                    <Icon as={Sparkles} size="xs" strokeWidth={2.2} /> 2 months free
                  </span>
                )}
              </p>
            </div>

            <div className="px-6 pb-6 overflow-y-auto flex-1">
              {/* ── Amount summary card ──────────────────────────── */}
              <div className="rounded-2xl bg-gradient-to-br from-[#0d1526] to-[#1c2c48] text-white p-5 mb-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-white/60">Amount to pay</p>
                    <p className="mt-1 font-black text-4xl leading-none text-[#F6E7C1]">
                      K{effectivePrice}
                      {isUpgrade && (
                        <span className="ml-2 align-middle text-base font-bold text-white/40 line-through">K{plan.priceZMW}</span>
                      )}
                    </p>
                    <p className="mt-2 text-xs text-white/70">
                      {isUpgrade && renewalDateLabel
                        ? `One-off charge for the ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left. Renews on ${renewalDateLabel}.`
                        : `${plan.durationDays} days of full access${renewalDateLabel ? ` · until ${renewalDateLabel}` : `. ${plan.tagline}`}`}
                    </p>
                    {quoteState === 'loading' && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/50">
                        <Icon as={Loader2} size="xs" className="animate-spin" /> Confirming price…
                      </p>
                    )}
                    {quoteState === 'error' && (
                      <p className="mt-1.5 text-[11px] text-amber-300" role="alert">
                        We could not confirm the price.{' '}
                        <button
                          type="button"
                          onClick={() => setQuoteAttempt((n) => n + 1)}
                          className="font-semibold text-amber-200 underline min-h-0 p-0 bg-transparent shadow-none"
                        >
                          Try again
                        </button>
                      </p>
                    )}
                  </div>

                  {isUpgrade && renewalDateLabel && (
                    <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4 sm:block sm:shrink-0 sm:border-0 sm:pt-0 sm:text-right">
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
                        <Icon as={Lock} size="xs" /> No extra days added
                      </span>
                      <div className="text-right sm:mt-3">
                        <p className="text-[11px] uppercase tracking-wider text-white/50">Your renewal date</p>
                        <p className="text-sm font-bold text-white">{renewalDateLabel}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Success: return the teacher to their work ───── */}
              {payState === 'success' && (
                <div className="text-center py-4">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
                    <Icon as={Check} size="lg" strokeWidth={2.6} />
                  </div>
                  <h3 className="text-xl font-black text-gray-800">Payment successful! 🎉</h3>
                  <p className="text-sm text-gray-700 mt-1 font-semibold">
                    Your {plan.name} plan is now active.
                  </p>
                  <p className="text-sm text-gray-600 mt-1.5">
                    Your work has been preserved — you can continue from where you stopped.
                  </p>

                  <dl className="mt-4 rounded-2xl bg-orange-50/70 border border-orange-100 px-4 py-3 text-sm text-left">
                    <div className="flex justify-between gap-3 py-0.5">
                      <dt className="text-gray-500">Plan</dt>
                      <dd className="font-semibold text-gray-800">{plan.name}</dd>
                    </div>
                    <div className="flex justify-between gap-3 py-0.5">
                      <dt className="text-gray-500">Amount paid</dt>
                      <dd className="font-semibold text-gray-800">K{effectivePrice}</dd>
                    </div>
                    {renewalDateLabel && (
                      <div className="flex justify-between gap-3 py-0.5">
                        <dt className="text-gray-500">{isUpgrade ? 'Renews on' : 'Active until'}</dt>
                        <dd className="font-semibold text-gray-800">{renewalDateLabel}</dd>
                      </div>
                    )}
                    {zambianPhoneDigits(phone) && (
                      <div className="flex justify-between gap-3 py-0.5">
                        <dt className="text-gray-500">Paid from</dt>
                        <dd className="font-semibold text-gray-800">
                          {`${zambianPhoneDigits(phone).slice(0, 4)} ••• ${zambianPhoneDigits(phone).slice(7)}`}
                        </dd>
                      </div>
                    )}
                  </dl>

                  {userEmail && (
                    <p className="mt-3 rounded-xl bg-gray-50 px-4 py-2.5 text-xs text-gray-600">
                      Receipt sent to <span className="font-semibold">{userEmail}</span>
                    </p>
                  )}

                  <Button variant="primary" size="lg" fullWidth className="mt-4" onClick={handleReturnToWork}>
                    Continue to my work
                  </Button>
                  <button
                    type="button"
                    onClick={handleViewReceipt}
                    disabled={receiptState === 'loading'}
                    className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:border-gray-400 disabled:opacity-60"
                  >
                    {receiptState === 'loading'
                      ? <span className="flex items-center justify-center gap-2"><Icon as={Loader2} size="sm" className="animate-spin" /> Fetching receipt…</span>
                      : 'View receipt'}
                  </button>
                  {receiptState === 'missing' && (
                    <p className="mt-2 text-xs text-gray-500" role="status">
                      Your receipt is still being prepared — it will be emailed to you shortly.
                    </p>
                  )}
                </div>
              )}

              {/* ── Pending lifecycle: check phone → verifying → timeout ── */}
              {payState === 'processing' && (
                <PaymentStatusTracker
                  stage={approvalStage}
                  timedOut={timedOut}
                  checking={checkingStatus}
                  phoneDisplay={phone}
                  reference={paymentId}
                  operatorLabel={OPERATORS.find((op) => op.id === detectedOperator)?.label || ''}
                  amountZMW={effectivePrice}
                  onApproved={() => setApprovalStage('verifying')}
                  onCheckStatus={handleCheckStatus}
                  onCancelPayment={handleCancelPending}
                />
              )}

              {/* ── OTP entry ───────────────────────────────────── */}
              {payState === 'otp' && (
                <div>
                  <h3 className="text-base font-black text-gray-800 mb-2">Enter the verification code</h3>
                  <p className="text-sm text-gray-600 mb-3">
                    We sent a one-time code to your phone. Enter it to authorise the payment.
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="123456"
                    className="w-full border-2 border-gray-200 focus:border-orange-400 rounded-xl px-3 py-2.5 text-lg tracking-widest text-center focus:outline-none mb-3"
                  />
                  {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
                  <Button variant="primary" size="lg" fullWidth disabled={!otp.trim()} onClick={handleSubmitOtp}>
                    Verify &amp; pay K{effectivePrice}
                  </Button>
                </div>
              )}

              {payState === 'verifying' && (
                <div className="text-center py-6">
                  <Icon as={Loader2} size="lg" className="mx-auto animate-spin text-orange-500" />
                  <p className="text-sm text-gray-600 mt-3">Verifying your code…</p>
                </div>
              )}

              {/* ── Failed / declined ───────────────────────────── */}
              {payState === 'failed' && (
                <div className="text-center py-4">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
                    <Icon as={X} size="lg" strokeWidth={2.4} />
                  </div>
                  <h3 className="text-lg font-black text-gray-800">Payment was not completed</h3>
                  <p className="text-sm text-gray-600 mt-1">{error || 'Something went wrong. Please try again.'}</p>
                  <div className="mt-5 space-y-2">
                    <Button variant="primary" size="lg" fullWidth onClick={resetCheckout}>
                      Try again
                    </Button>
                    <button
                      type="button"
                      onClick={() => { resetCheckout(); setPhone('') }}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:border-gray-400"
                    >
                      Use a different number
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="w-full rounded-xl px-3 py-2 text-[13px] font-medium text-gray-500 hover:text-gray-800 bg-transparent shadow-none"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* ── Payment form (idle / starting) ──────────────── */}
              {(payState === 'idle' || payState === 'starting') && (
                <>
                  {quoteNotice && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
                      {quoteNotice}
                    </div>
                  )}
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <label htmlFor="mm-number" className="text-sm font-bold text-gray-800">
                      Pay with your mobile money
                    </label>
                    <img
                      src="/images/mobile-money-networks.jpg"
                      alt="Airtel Money, MTN Mobile Money and Zamtel Money accepted"
                      className="h-6 w-auto object-contain"
                      loading="lazy"
                    />
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
                        Mobile money number
                      </label>
                      <div className="relative">
                        <span
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base"
                          aria-hidden="true"
                        >
                          📱
                        </span>
                        <input
                          id="mm-number"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          maxLength={12}
                          value={phone}
                          onChange={(e) => setPhone(formatZambianPhoneInput(e.target.value))}
                          placeholder="0977 740 465"
                          aria-invalid={phone !== '' && !phoneValid}
                          className={`w-full border-2 rounded-xl pl-9 pr-3 py-2.5 text-base focus:outline-none ${
                            phone === '' || phoneValid ? 'border-gray-200 focus:border-orange-400' : 'border-red-300 focus:border-red-500'
                          }`}
                        />
                      </div>
                      {phone !== '' && !phoneValid && (
                        <p className="mt-1 text-xs text-red-600" role="alert">
                          Enter a valid Zambian mobile number, e.g. 0977 740 465.
                        </p>
                      )}
                    </div>
                    <NetworkField
                      phone={phone}
                      operator={operator}
                      operatorTouched={operatorTouched}
                      onSelect={(id) => { setOperator(id); setOperatorTouched(true) }}
                    />
                  </div>

                  <p className="mt-3 text-sm text-gray-500">
                    You will receive a prompt on your phone to approve this payment.
                  </p>

                  {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    className="mt-4"
                    disabled={busy || !phoneValid || !detectedOperator}
                    onClick={handlePay}
                  >
                    {payState === 'starting'
                      ? <span className="flex items-center justify-center gap-2"><Icon as={Loader2} size="sm" className="animate-spin" /> Starting…</span>
                      : `Pay K${effectivePrice}`}
                  </Button>
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-gray-400">
                    <Icon as={Lock} size="xs" />
                    Secured by Lenco · {userEmail || 'your account'} will receive a receipt
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Annual plans carry the calendar illustration + savings ribbon.
function isYearlyCard(item) {
  return item?.billing === 'yearly'
}
