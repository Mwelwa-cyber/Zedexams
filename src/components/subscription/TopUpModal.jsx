import { useEffect, useRef, useState } from 'react'
import { Check, CreditCard, Loader2, Sparkles, X } from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import { capture } from '../../utils/analytics'
import {
  OPERATORS,
  detectOperator,
  initiateLencoPayment,
  looksLikeZambianPhone,
  pollLencoStatus,
  submitLencoOtp,
} from '../../utils/lenco'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

// One-off pay-per-generation top-up. Server-authoritative price + grant live
// in functions/plans.js (topup_generation, K25, +1 generationCredits) and
// functions/subscriptionActivation.js. The label here is display-only — the
// initiate callable resolves the real amount from the plan id, never the
// client. On success the credit lands via the same idempotent activation path
// as a subscription; AuthContext's user-doc snapshot picks it up so the next
// Generate proceeds without a reload.
export const TOPUP_PLAN_ID = 'topup_generation'
export const TOPUP_PRICE_ZMW = 25

// payState machine: idle → starting → (otp | processing) → success | failed
export default function TopUpModal({ onClose, feature }) {
  const { userProfile, currentUser } = useAuth()
  const userEmail = userProfile?.email || currentUser?.email || ''

  const [method, setMethod] = useState('mobile_money') // 'mobile_money' | 'card'
  const [phone, setPhone] = useState('')
  const [operator, setOperator] = useState('')
  const [operatorTouched, setOperatorTouched] = useState(false)
  const [card, setCard] = useState({ number: '', expiry: '', cvv: '', name: '' })
  const [otp, setOtp] = useState('')
  const [paymentId, setPaymentId] = useState(null)
  const [payState, setPayState] = useState('idle')
  const [error, setError] = useState('')
  const [timedOut, setTimedOut] = useState(false)

  const pollAbortRef = useRef({ aborted: false })
  useEffect(() => {
    const token = pollAbortRef.current
    return () => { token.aborted = true }
  }, [])

  const phoneValid = looksLikeZambianPhone(phone)
  const detectedOperator = operatorTouched ? operator : (detectOperator(phone) || operator)
  const busy = payState === 'starting' || payState === 'processing' || payState === 'verifying'

  function resolveTerminal(status) {
    if (status === 'successful') {
      setPayState('success')
      capture('topup_payment_succeeded', { method, feature: feature || null })
      return true
    }
    if (status === 'failed') {
      setPayState('failed')
      setError('The payment did not go through. No money was taken — please try again.')
      capture('topup_payment_failed', { method, feature: feature || null })
      return true
    }
    return false
  }

  async function beginPolling(ref) {
    setPayState('processing')
    setTimedOut(false)
    const final = await pollLencoStatus(ref, {
      signal: pollAbortRef.current,
      onTick: (status) => { if (status === 'successful' || status === 'failed') resolveTerminal(status) },
    })
    if (pollAbortRef.current.aborted) return
    if (!resolveTerminal(final)) setTimedOut(true)
  }

  async function handlePay() {
    if (busy) return
    setError('')
    const operatorToSend = detectedOperator

    if (method === 'mobile_money') {
      if (!phoneValid) { setError('Enter a valid Zambian mobile number, e.g. 0977 740 465.'); return }
      if (!operatorToSend) { setError('Please choose your mobile money operator.'); return }
    } else {
      const digits = card.number.replace(/\s+/g, '')
      const [mm, yy] = card.expiry.split('/').map((s) => (s || '').trim())
      if (digits.length < 12 || !mm || !yy || card.cvv.length < 3) {
        setError('Enter a valid card number, expiry (MM/YY) and CVV.'); return
      }
    }

    setPayState('starting')
    capture('topup_payment_initiated', { method, feature: feature || null })
    try {
      const payload = method === 'mobile_money'
        ? { planId: TOPUP_PLAN_ID, method, phone, operator: operatorToSend }
        : (() => {
          const [mm, yy] = card.expiry.split('/').map((s) => (s || '').trim())
          return {
            planId: TOPUP_PLAN_ID,
            method,
            card: {
              number: card.number.replace(/\s+/g, ''),
              expiryMonth: mm,
              expiryYear: yy,
              cvv: card.cvv.trim(),
              name: card.name.trim(),
            },
          }
        })()

      const res = await initiateLencoPayment(payload)
      setPaymentId(res.paymentId)

      if (res.authorization?.url || res.authorization?.redirectUrl) {
        window.open(res.authorization.url || res.authorization.redirectUrl, '_blank', 'noopener,noreferrer')
      }

      if (resolveTerminal(res.status)) return
      if (res.requiresOtp || res.status === 'otp-required') { setPayState('otp'); return }
      await beginPolling(res.paymentId)
    } catch (err) {
      setPayState('failed')
      setError(err?.message || 'Could not start the payment. Please try again.')
      capture('topup_payment_failed', { method, reason: 'initiate_error' })
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
      setError(err?.message || 'The code could not be verified. Please try again.')
    }
  }

  function resetCheckout() {
    setPayState('idle')
    setError('')
    setOtp('')
    setPaymentId(null)
    setTimedOut(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md my-4 overflow-hidden animate-scale-in">
        <div className="bg-gradient-to-r from-orange-400 to-orange-500 p-5 text-center relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close top-up dialog"
            className="absolute top-3 right-4 text-white/80 hover:text-white min-h-0 p-1 bg-transparent shadow-none"
          >
            <Icon as={X} size="md" />
          </button>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-white">
            <Icon as={Sparkles} size="lg" strokeWidth={2.1} />
          </div>
          <h2 className="text-2xl font-black text-white">One extra generation</h2>
          <p className="text-white/90 text-sm mt-1">
            Pay K{TOPUP_PRICE_ZMW} for one more {feature || 'generation'} — no subscription, no commitment.
          </p>
        </div>

        <div className="p-5">
          <div className="bg-gradient-to-br from-[#0B1A2C] to-[#1F3A5F] text-white rounded-2xl p-5 mb-5">
            <p className="text-sm text-white/80">One extra generation · any tool</p>
            <p className="font-black text-4xl mt-1 text-[#F4E4BC]">K{TOPUP_PRICE_ZMW}</p>
            <p className="text-xs text-white/70 mt-1">
              Adds a single credit to your account. Use it now or whenever you next hit a limit.
            </p>
          </div>

          {/* ── Success ─────────────────────────────────────────── */}
          {payState === 'success' && (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
                <Icon as={Check} size="lg" strokeWidth={2.6} />
              </div>
              <h3 className="text-xl font-black text-gray-800">Credit added 🎉</h3>
              <p className="text-sm text-gray-600 mt-1">
                You&apos;ve got one extra generation. Close this and press Generate again — it&apos;ll go straight
                through. A receipt is on its way to your email.
              </p>
              <Button variant="primary" size="lg" fullWidth className="mt-5" onClick={onClose}>
                Back to generating
              </Button>
            </div>
          )}

          {/* ── Processing / waiting ────────────────────────────── */}
          {payState === 'processing' && (
            <div className="text-center py-6">
              <Icon as={Loader2} size="lg" className="mx-auto animate-spin text-[#B8860B]" />
              <h3 className="text-base font-black text-gray-800 mt-3">
                {method === 'mobile_money' ? 'Approve the prompt on your phone' : 'Processing your card…'}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {method === 'mobile_money'
                  ? 'Check your phone for a Mobile Money prompt and enter your PIN. Keep this page open and your credit is added automatically.'
                  : 'Hang tight — this can take up to a minute. Keep this page open and your credit is added automatically once your bank confirms.'}
              </p>
              {timedOut && (
                <p className="text-xs text-gray-500 mt-3">
                  Still waiting… you can safely close this — we&apos;ll add your credit and email a receipt as soon as
                  the payment confirms.
                </p>
              )}
            </div>
          )}

          {/* ── OTP entry ───────────────────────────────────────── */}
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
                className="w-full border-2 border-gray-200 focus:border-[#B8860B] rounded-xl px-3 py-2.5 text-lg tracking-widest text-center focus:outline-none mb-3"
              />
              {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
              <Button variant="primary" size="lg" fullWidth disabled={!otp.trim()} onClick={handleSubmitOtp}>
                Verify &amp; pay K{TOPUP_PRICE_ZMW}
              </Button>
            </div>
          )}

          {payState === 'verifying' && (
            <div className="text-center py-6">
              <Icon as={Loader2} size="lg" className="mx-auto animate-spin text-[#B8860B]" />
              <p className="text-sm text-gray-600 mt-3">Verifying your code…</p>
            </div>
          )}

          {/* ── Failed ──────────────────────────────────────────── */}
          {payState === 'failed' && (
            <div className="text-center py-4">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
                <Icon as={X} size="lg" strokeWidth={2.4} />
              </div>
              <h3 className="text-lg font-black text-gray-800">Payment not completed</h3>
              <p className="text-sm text-gray-600 mt-1">{error || 'Something went wrong. Please try again.'}</p>
              <Button variant="primary" size="lg" fullWidth className="mt-5" onClick={resetCheckout}>
                Try again
              </Button>
            </div>
          )}

          {/* ── Payment form (idle / starting) ──────────────────── */}
          {(payState === 'idle' || payState === 'starting') && (
            <>
              <div className="grid grid-cols-2 gap-2 mb-4 p-1 bg-gray-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setMethod('mobile_money')}
                  className={`py-2.5 rounded-lg text-sm font-bold transition-colors ${method === 'mobile_money' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
                >
                  📱 Mobile Money
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('card')}
                  className={`py-2.5 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-1.5 ${method === 'card' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
                >
                  <Icon as={CreditCard} size="xs" /> Card
                </button>
              </div>

              {method === 'mobile_money' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
                      Mobile money number
                    </label>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="0977 740 465"
                      className={`w-full border-2 rounded-xl px-3 py-2.5 text-base focus:outline-none ${
                        phone === '' || phoneValid ? 'border-gray-200 focus:border-[#B8860B]' : 'border-red-300 focus:border-red-500'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
                      Network
                    </label>
                    <select
                      value={detectedOperator || ''}
                      onChange={(e) => { setOperator(e.target.value); setOperatorTouched(true) }}
                      className="w-full border-2 border-gray-200 focus:border-[#B8860B] rounded-xl px-3 py-2.5 text-base focus:outline-none bg-white"
                    >
                      <option value="">Select your network…</option>
                      {OPERATORS.map((op) => (
                        <option key={op.id} value={op.id}>{op.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
                      Card number
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      value={card.number}
                      onChange={(e) => setCard((c) => ({ ...c, number: e.target.value }))}
                      placeholder="1234 5678 9012 3456"
                      className="w-full border-2 border-gray-200 focus:border-[#B8860B] rounded-xl px-3 py-2.5 text-base focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Expiry</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        value={card.expiry}
                        onChange={(e) => setCard((c) => ({ ...c, expiry: e.target.value }))}
                        placeholder="MM/YY"
                        className="w-full border-2 border-gray-200 focus:border-[#B8860B] rounded-xl px-3 py-2.5 text-base focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">CVV</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        value={card.cvv}
                        onChange={(e) => setCard((c) => ({ ...c, cvv: e.target.value.replace(/[^\d]/g, '') }))}
                        placeholder="123"
                        className="w-full border-2 border-gray-200 focus:border-[#B8860B] rounded-xl px-3 py-2.5 text-base focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Name on card</label>
                    <input
                      type="text"
                      autoComplete="cc-name"
                      value={card.name}
                      onChange={(e) => setCard((c) => ({ ...c, name: e.target.value }))}
                      placeholder="As shown on the card"
                      className="w-full border-2 border-gray-200 focus:border-[#B8860B] rounded-xl px-3 py-2.5 text-base focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="mt-4"
                disabled={busy}
                onClick={handlePay}
              >
                {payState === 'starting'
                  ? <span className="flex items-center justify-center gap-2"><Icon as={Loader2} size="sm" className="animate-spin" /> Starting…</span>
                  : `Pay K${TOPUP_PRICE_ZMW}`}
              </Button>
              <p className="text-center text-[11px] text-gray-400 mt-3">
                Secured by Lenco · {userEmail || 'your account'} will receive a receipt
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
