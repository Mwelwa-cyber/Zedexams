import { useState } from 'react'
import { ArrowLeft, Check, Sparkles, X } from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import { PLANS, PAYMENT_DETAILS } from '../../utils/subscriptionConfig'
import { capture } from '../../utils/analytics'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

const DEFAULT_PLAN_ORDER_BY_PORTAL = {
  learner: ['grade7_monthly', 'grade7_termly'],
  teacher: ['pro_monthly', 'pro_yearly'],
  generic: ['grade7_monthly', 'grade7_termly'],
}
const PLAN_BORDER = {
  grade7_monthly: 'border-amber-400 bg-amber-50',
  grade7_termly:  'border-emerald-400 bg-emerald-50',
  monthly:        'border-green-400 bg-green-50',
  termly:         'border-blue-400 bg-blue-50',
  yearly:         'border-purple-400 bg-purple-50',
  pro_monthly:    'border-orange-400 bg-orange-50',
  pro_yearly:     'border-orange-400 bg-orange-50',
  max_monthly:    'border-blue-500 bg-blue-50',
  max_yearly:     'border-blue-500 bg-blue-50',
}
const FALLBACK_BORDER = 'border-orange-400 bg-orange-50'

const PORTAL_COPY = {
  learner: {
    title: 'Grade 7 ECZ Exam Pack',
    subtitle: 'Notes · past papers · quizzes · exam strategy',
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

function buildWhatsAppLink({ plan, email, displayName }) {
  const lines = [
    `Hi, I just paid K${plan.priceZMW} for the ${plan.name} plan 🙏`,
    email ? `Email: ${email}` : null,
    displayName ? `Name: ${displayName}` : null,
    'Sending screenshot now.',
  ].filter(Boolean)
  const number = PAYMENT_DETAILS.contact.whatsapp.replace(/[^\d]/g, '')
  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join('\n'))}`
}

export default function UpgradeModal({ onClose, portal, planIds, defaultPlanId }) {
  const copy = PORTAL_COPY[portal] || PORTAL_COPY.generic
  const { userProfile, currentUser } = useAuth()
  const pendingReferralCredits = Number(userProfile?.referralCredits || 0)

  const defaultOrder =
    DEFAULT_PLAN_ORDER_BY_PORTAL[portal] || DEFAULT_PLAN_ORDER_BY_PORTAL.generic
  const visiblePlanIds = (planIds && planIds.length ? planIds : defaultOrder)
    .filter((id) => PLANS[id])
  const [step, setStep] = useState('plans')
  const [selectedPlanId, setSelectedPlanId] = useState(
    defaultPlanId && visiblePlanIds.includes(defaultPlanId) ? defaultPlanId : null
  )

  const plan = selectedPlanId ? PLANS[selectedPlanId] : null
  const userEmail = userProfile?.email || currentUser?.email || ''

  function handleContinue() {
    if (!plan) return
    setStep('instructions')
    // Audit B2 — capture the intent so we can measure conversion from
    // pricing → instructions page (separate from actual activation,
    // which now happens manually in /admin/payments).
    capture('subscription_intent', {
      planId: selectedPlanId,
      amountZmw: plan.priceZMW ?? null,
      durationDays: plan.durationDays ?? null,
    })
  }

  function handleOpenWhatsApp() {
    if (!plan) return
    capture('subscription_whatsapp_opened', { planId: selectedPlanId })
    const url = buildWhatsAppLink({
      plan,
      email: userEmail,
      displayName: userProfile?.displayName || '',
    })
    window.open(url, '_blank', 'noopener,noreferrer')
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
            {pendingReferralCredits > 0 && (
              <div
                className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
                role="status"
              >
                <p className="font-bold">
                  🎁 {pendingReferralCredits} free month{pendingReferralCredits === 1 ? '' : 's'} from referrals
                </p>
                <p className="text-xs mt-1 text-emerald-800/90">
                  Mention your email when you message us and we'll add
                  {' '}{pendingReferralCredits * 30} bonus day{pendingReferralCredits === 1 ? '' : 's'} when activating.
                </p>
              </div>
            )}
            <div className="grid gap-3 mb-4">
              {visiblePlanIds.map((planId) => {
                const item = PLANS[planId]
                const active = selectedPlanId === planId
                const activeBorder = PLAN_BORDER[planId] || FALLBACK_BORDER
                return (
                  <button
                    key={planId}
                    onClick={() => setSelectedPlanId(planId)}
                    className={`w-full text-left p-4 rounded-2xl border-2 transition-all min-h-0 ${active ? activeBorder + ' ring-2 ring-offset-1 ring-current' : 'border-gray-200 hover:border-gray-300'}`}
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
              Pay via Mobile Money, then confirm on WhatsApp. We activate within 30 minutes.
            </div>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!selectedPlanId}
              onClick={handleContinue}
            >
              {selectedPlanId ? `Continue → Pay K${plan.priceZMW}` : 'Select a Plan'}
            </Button>
          </>}

          {step === 'instructions' && plan && <>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Icon as={ArrowLeft} size="xs" />}
              onClick={() => setStep('plans')}
              className="mb-4 -ml-2"
            >
              Back
            </Button>

            <div className="bg-gradient-to-br from-[#0B1A2C] to-[#1F3A5F] text-white rounded-2xl p-5 mb-5">
              <p className="text-sm text-white/80">{plan.name} · {plan.durationDays} days</p>
              <p className="font-black text-4xl mt-1 text-[#F4E4BC]">K{plan.priceZMW}</p>
              <p className="text-xs text-white/70 mt-1">{plan.tagline}</p>
            </div>

            <h3 className="text-base font-black text-gray-800 mb-3">How to pay</h3>
            <ol className="space-y-3 mb-5">
              {[
                <>Send <strong>K{plan.priceZMW}</strong> via {PAYMENT_DETAILS.mobileMoney.providers} to the number below</>,
                <>Use your <strong>email address</strong> as the reference</>,
                <>Tap the WhatsApp button to send us your confirmation</>,
                <>Receive access within <strong>30 minutes</strong></>,
              ].map((line, i) => (
                <li key={i} className="flex gap-3 text-sm text-gray-700">
                  <span className="flex-shrink-0 grid place-items-center w-7 h-7 rounded-full bg-[#B8860B] text-white text-xs font-black">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed pt-0.5">{line}</span>
                </li>
              ))}
            </ol>

            <div className="bg-[#FAF6EE] border-2 border-dashed border-[#B8860B] rounded-2xl p-4 text-center mb-4">
              <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">
                {PAYMENT_DETAILS.mobileMoney.providers}
              </p>
              <p className="text-2xl font-black text-[#0B1A2C] tracking-wider mt-1">
                {PAYMENT_DETAILS.mobileMoney.displayNumber}
              </p>
              <p className="text-sm font-bold text-[#B8860B] mt-1">
                Amount: K{plan.priceZMW}.00
              </p>
            </div>

            <div className="bg-yellow-50 border-l-4 border-[#B8860B] rounded-r-lg p-3 mb-5 text-sm text-gray-700">
              <strong className="text-gray-900">Reference:</strong>{' '}
              your email{userEmail ? ` (${userEmail})` : ' (e.g. parent@gmail.com)'} so we can activate the right account.
            </div>

            <button
              type="button"
              onClick={handleOpenWhatsApp}
              className="w-full bg-[#25D366] hover:bg-[#1FBE5C] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors"
            >
              <Icon as={Check} size="sm" strokeWidth={2.4} />
              Confirm payment on WhatsApp
            </button>
            <p className="text-center text-xs text-gray-500 mt-3">
              We respond within 30 minutes · 7 days a week
            </p>

            <button
              type="button"
              onClick={onClose}
              className="w-full mt-4 text-sm text-gray-500 hover:text-gray-700 underline"
            >
              I'll do this later
            </button>
          </>}
        </div>
      </div>
    </div>
  )
}
