// Premium — the subscription detail view. Polished pricing cards that mirror the
// teacher upgrade modal (icon chip, price, headline features, "Most popular"
// ribbon), plus the full benefit list. Paid cards open the same Lenco checkout
// modal, pre-selected. Prices + features come from PLANS so the cards never
// drift from checkout.

import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscription } from '../../../hooks/useSubscription'
import { PLANS } from '../../../engines/payment-engine/subscriptionConfig'
import { UpgradeModal } from '../../subscription'
import { Panel, Section, Btn, Note } from '../components/ui'

const PLAN_CARDS = [
  {
    id: 'free',
    planId: null,
    icon: '🐢',
    name: 'Free',
    tagline: 'The basics to get going',
    priceLabel: 'K0',
    unit: 'forever',
    feats: ['Demo quizzes (one per subject)', 'Basic results', 'Practice mode only'],
  },
  {
    id: 'weekly',
    planId: 'weekly',
    icon: PLANS.weekly.badge,
    name: PLANS.weekly.name,
    tagline: PLANS.weekly.tagline,
    priceLabel: `K${PLANS.weekly.priceZMW}`,
    unit: '/ week',
    feats: PLANS.weekly.features.slice(0, 3),
  },
  {
    id: 'monthly',
    planId: 'monthly',
    icon: PLANS.monthly.badge,
    name: PLANS.monthly.name,
    tagline: PLANS.monthly.tagline,
    priceLabel: `K${PLANS.monthly.priceZMW}`,
    unit: '/ month',
    feats: PLANS.monthly.features.slice(0, 3),
    popular: true,
  },
]

// The headline benefits the mockup lists — what Premium unlocks.
const PREMIUM_BENEFITS = [
  'Unlimited quizzes',
  'Unlimited past papers',
  'Unlimited AI Tutor',
  'Unlimited AI Explanations',
  'Unlimited worksheets',
  'Performance analytics',
  'Priority AI',
  'Offline downloads',
  'No ads',
]

export default function PremiumPanel({ section }) {
  const { userProfile } = useAuth()
  const { tierLabel, isPremium } = useSubscription()

  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradePlanId, setUpgradePlanId] = useState(null)

  const currentPlan = !isPremium ? 'free' : (userProfile?.subscriptionPlan || 'monthly')

  const openUpgrade = (planId) => {
    setUpgradePlanId(planId || null)
    setShowUpgrade(true)
  }

  return (
    <Panel section={section}>
      <Section title="Your plan" hint="Pick the plan that fits how you study.">
        <div className="lset-plans" style={{ marginBottom: 14 }}>
          {PLAN_CARDS.map((p) => {
            const on = currentPlan === p.id
            const clickable = !!p.planId && !on
            return (
              <button
                key={p.id}
                type="button"
                className={`lset-plan${on ? ' lset-plan--on' : ''}${p.popular ? ' lset-plan--popular' : ''}`}
                disabled={!clickable}
                aria-pressed={on}
                onClick={clickable ? () => openUpgrade(p.planId) : undefined}
              >
                {p.popular && <span className="lset-plan__ribbon">✦ Most popular</span>}
                <div className="lset-plan__head">
                  <span className="lset-plan__icon" aria-hidden="true">{p.icon}</span>
                  <span>
                    <span className="lset-plan__name">{p.name}</span>
                    <span className="lset-plan__tagline">{p.tagline}</span>
                  </span>
                </div>
                <div>
                  <span className="lset-plan__price">{p.priceLabel}</span>
                  <span className="lset-plan__unit">{p.unit}</span>
                </div>
                <ul className="lset-plan__feats">
                  {p.feats.map((f) => <li key={f} className="lset-plan__feat">{f}</li>)}
                </ul>
                {on && <div className="lset-plan__current">✓ Current plan</div>}
              </button>
            )
          })}
        </div>
        {!isPremium && <Btn onClick={() => openUpgrade('monthly')}>Upgrade to unlock everything</Btn>}
        {isPremium && (
          <Note tone="accent">You're on <strong>{tierLabel}</strong>. Manage renewal and receipts under My Account.</Note>
        )}
      </Section>

      <Section title="Everything you unlock" hint="Premium removes every limit and turns on the smart tools.">
        <ul className="lset-plan__feats" style={{ gap: 8 }}>
          {PREMIUM_BENEFITS.map((b) => <li key={b} className="lset-plan__feat">{b}</li>)}
        </ul>
      </Section>

      {showUpgrade && (
        <UpgradeModal
          portal="learner"
          defaultPlanId={upgradePlanId || userProfile?.subscriptionPlan}
          onClose={() => { setShowUpgrade(false); setUpgradePlanId(null) }}
        />
      )}
    </Panel>
  )
}
