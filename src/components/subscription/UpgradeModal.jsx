import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, CheckCircleIcon, CreditCard, Sparkles, X } from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import { PLANS, PAYMENT_DETAILS } from '../../utils/subscriptionConfig'
import { initiateMomoPayment, pollMomoPayment } from '../../utils/momoPayments'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

const planOrder = ['monthly', 'termly', 'yearly']
const planBorder = {
  monthly: 'border-green-400 bg-green-50',
  termly: 'border-blue-400 bg-blue-50',
  yearly: 'border-purple-400 bg-purple-50',
}
const SUBSCRIPTION_PENDING_MESSAGE =
  'Subscription not yet activated. If you have already paid, please refresh or contact support.'

function toFriendlyPaymentMessage(message, fallback = 'The payment did not complete this time.') {
  const text = String(message || '').trim()
  if (!text) return fallback
  return /subscription key|api key|access denied|authenticate with mtn/i.test(text)
    ? SUBSCRIPTION_PENDING_MESSAGE
    : text
}

const PORTAL_COPY = {
  learner: {
    title: 'Subscribe to Learner Portal',
    subtitle: 'Unlock the learner dashboard, quizzes, lessons & exams',
  },
  teacher: {
    title: 'Subscribe to Teacher Portal',
    subtitle: 'Unlock premium teacher tools',
  },
  generic: {
    title: 'Upgrade to Premium',
    subtitle: 'Unlock unlimited learning',
  },
}

export default function UpgradeModal({ onClose, portal }) {
  const copy = PORTAL_COPY[portal] || PORTAL_COPY.generic
  const { refreshProfile } = useAuth()
  const [step, setStep] = useState('plans')
  const [selectedPlanId, setSelectedPlanId] = useState(null)
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState('')
  const [paymentId, setPaymentId] = useState('')
  const mountedRef = useRef(true)

  const plan = selectedPlanId ? PLANS[selectedPlanId] : null

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function handlePay() {
    if (!plan) {
      setError('Choose a plan first.')
      return
    }
    if (!phone.trim()) {
      setError('Enter your MTN mobile money number.')
      return
    }

    setError('')
    setStatusText('')
    setSubmitting(true)
    setStep('processing')

    try {
      const started = await initiateMomoPayment({
        planId: selectedPlanId,
        phoneNumber: phone.trim(),
      })

      if (!mountedRef.current) return

      setPaymentId(started.paymentId || '')
      setStatusText(started.message || 'Approve the payment on your phone.')

      const finalStatus = await pollMomoPayment(started.paymentId, {
        onUpdate: (update) => {
          if (!mountedRef.current) return
          setStatusText(update.message || 'Waiting for MTN confirmation…')
        },
      })

      if (!mountedRef.current) return

      if (finalStatus.status === 'successful') {
        await refreshProfile?.()
        setStatusText(finalStatus.message || 'Payment received.')
        setStep('success')
      } else if (finalStatus.status === 'pending') {
        setStatusText(finalStatus.message || 'Still waiting for MTN confirmation.')
      } else {
        setError(toFriendlyPaymentMessage(finalStatus.reason, 'Payment was not approved.'))
        setStep('failed')
      }
    } catch (err) {
      if (!mountedRef.current) return
      console.error(err)
      setError(toFriendlyPaymentMessage(err.message, 'Could not start the MTN payment.'))
      setStep('failed')
    }

    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg my-4 overflow-hidden animate-scale-in">
        <div className="bg-gradient-to-r from-yellow-400 to-orange-400 p-5 text-center relative">
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

        <div className="p-5">
          {step === 'plans' && <>
            <div className="grid gap-3 mb-4">
              {planOrder.map((planId) => {
                const item = PLANS[planId]
                const active = selectedPlanId === planId
                return (
                  <button
                    key={planId}
                    onClick={() => setSelectedPlanId(planId)}
                    className={`w-full text-left p-4 rounded-2xl border-2 transition-all min-h-0 ${active ? planBorder[planId] + ' ring-2 ring-offset-1 ring-current' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-black text-gray-800 text-lg">{item.badge} {item.name}</span>
                        <span className="ml-2 text-gray-500 text-sm">{item.tagline}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-2xl text-gray-800">K{item.priceZMW}</div>
                        <div className="text-xs text-gray-500">ZMW</div>
                      </div>
                    </div>
                    {active && (
                      <ul className="mt-3 space-y-1">
                        {item.features.map((feature) => (
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
            <div className="bg-gray-50 rounded-2xl p-3 mb-4 text-sm text-gray-500 text-center">
              Approve the MTN prompt on your phone and your account unlocks automatically.
            </div>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!selectedPlanId}
              onClick={() => selectedPlanId && setStep('pay')}
            >
              {selectedPlanId ? `Continue → Pay K${plan.priceZMW}` : 'Select a Plan'}
            </Button>
          </>}

          {step === 'pay' && plan && <>
            <Button variant="ghost" size="sm" leadingIcon={<Icon as={ArrowLeft} size="xs" />} onClick={() => setStep('plans')} className="mb-4 -ml-2">Back</Button>
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4 mb-4 text-center">
              <p className="text-gray-700 font-bold">You will pay</p>
              <p className="text-4xl font-black text-green-700 my-1">K{plan.priceZMW} ZMW</p>
              <p className="text-gray-500 text-sm">{plan.name} plan · {plan.durationDays} days</p>
            </div>
            <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-4 mb-4">
              <p className="text-xs text-green-700 font-bold uppercase tracking-wider mb-1">Payment method</p>
              <p className="text-2xl font-black text-green-800">{PAYMENT_DETAILS.MTN.name}</p>
              <p className="text-xs text-gray-500 mt-2">Use the MTN number that should receive the approval prompt. We send the Request to Pay from the server.</p>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Your MTN number *</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="096 XXX XXXX"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:border-green-500 focus:outline-none"
                />
              </div>
            </div>
            {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl p-3 mb-3">{error}</p>}
            <Button variant="primary" size="lg" fullWidth loading={submitting} onClick={handlePay}>
              {submitting ? 'Starting payment…' : 'Pay with MTN'}
            </Button>
            <p className="text-center text-xs text-gray-400 mt-3">You will receive an approval prompt on your phone.</p>
          </>}

          {step === 'processing' && plan && (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-yellow-50 text-yellow-700 animate-bounce">
                <Icon as={CreditCard} size="xl" strokeWidth={2.1} />
              </div>
              <h3 className="text-2xl font-black text-gray-800 mb-2">Approve the Prompt</h3>
              <p className="text-gray-600 mb-4">{statusText || 'We are waiting for MTN to confirm your payment.'}</p>
              <div className="bg-yellow-50 border-2 border-yellow-200 rounded-2xl p-4 mb-4 text-sm text-yellow-800">
                <p className="font-bold mb-1">{plan.name} plan · K{plan.priceZMW}</p>
                <p>{phone}</p>
                {paymentId && <p className="mt-2 text-xs break-all text-yellow-700">Ref: {paymentId}</p>}
              </div>
              <Button variant="secondary" size="lg" fullWidth onClick={onClose}>Close</Button>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-green-50 text-green-700">
                <Icon as={CheckCircleIcon} size="xl" strokeWidth={2.1} />
              </div>
              <h3 className="text-2xl font-black text-gray-800 mb-2">Payment Successful!</h3>
              <p className="text-gray-600 mb-4">Your <strong>{plan?.name}</strong> plan is active now.</p>
              <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4 mb-4 text-sm text-green-800">
                <p className="font-bold mb-1">Account activated</p>
                <p>{statusText || 'You now have full subscription access.'}</p>
              </div>
              <Button variant="primary" size="lg" fullWidth onClick={onClose}>Back to Dashboard</Button>
            </div>
          )}

          {step === 'failed' && (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-red-50 text-red-700">
                <Icon as={AlertTriangle} size="xl" strokeWidth={2.1} />
              </div>
              <h3 className="text-2xl font-black text-gray-800 mb-2">Payment Not Completed</h3>
              <p className="text-gray-600 mb-4">{error || 'The payment did not complete this time.'}</p>
              <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4 mb-4 text-sm text-green-800">
                <p className="font-bold mb-1">Need help?</p>
                <p>WhatsApp <a href={`https://wa.me/${PAYMENT_DETAILS.contact.whatsapp.replace(/\s+/g, '')}`} className="font-black underline" target="_blank" rel="noopener noreferrer">{PAYMENT_DETAILS.contact.whatsapp}</a></p>
              </div>
              <div className="flex gap-3">
                <Button variant="primary" size="lg" className="flex-1" onClick={() => setStep('pay')}>Try Again</Button>
                <Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>Close</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
