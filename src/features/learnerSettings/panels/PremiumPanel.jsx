// Premium — the Go Premium screen, to the prototype's view-plans upper half:
// the Weekly/Monthly cycle toggle, the gradient price card with its feature
// list, and the K5 day / K120 term pass tiles. Every price is read from the
// checkout catalogue (subscriptionConfig PLANS) so this screen can never
// disagree with what Lenco charges; tapping any plan opens the existing
// UpgradeModal checkout pre-selected — the payment flow itself is not
// duplicated here.
//
// Two of the prototype card's rows are deliberately absent:
//   • "No ads" — ZedExams shows no ads on ANY plan, so listing it as a
//     Premium benefit implies the free plan has them (owner ruling).
//   • "Notes read aloud by Zed (Monthly only)" — the reader's Listen button
//     is free on every plan and gated by nothing, so selling it as a
//     monthly-only Premium feature would be false twice over.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscription } from '../../../hooks/useSubscription'
import { PLANS } from '../../../engines/payment-engine/subscriptionConfig'
import { mayShowPrice } from '../../../services/entitlements/planState'
import { UpgradeModal } from '../../subscription'
import { Panel, Section, Note } from '../components/ui'

// The two billing cycles the big card switches between. Prices come off the
// checkout catalogue at render time — never hard-coded here.
const CYCLES = [
  { id: 'weekly', label: 'Weekly', per: 'per week' },
  { id: 'monthly', label: 'Monthly', per: 'per month' },
]

// Everything on the ladder this screen can sell, so the checkout the taps
// open offers the same rungs the tiles do.
const LADDER_PLAN_IDS = ['day_pass', 'weekly', 'monthly', 'term_pass']

// What the card promises. Each row maps to something the app actually gates:
// past-paper access beyond the free set, timed exam mode + auto-marking of
// papers beyond the free set, offline downloads, and the daily Ask Zed quota.
const CARD_FEATURES = [
  'All past papers — every year, no limits',
  'Timed exam mode + full marking & review',
  'Save papers & notes for offline',
  'More Ask Zed help every day',
]

// What Premium unlocks (the full list, below the card).
const PREMIUM_BENEFITS = [
  'Unlimited quizzes',
  'Unlimited past papers',
  'Unlimited AI Tutor',
  'Unlimited AI Explanations',
  'Unlimited worksheets',
  'Performance analytics',
  'Priority AI',
  'Offline downloads',
]

export default function PremiumPanel({ section }) {
  const { userProfile } = useAuth()
  const { tierLabel, isPremium } = useSubscription()

  const [cycle, setCycle] = useState('monthly')
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradePlanId, setUpgradePlanId] = useState(null)

  const activeCycle = CYCLES.find((c) => c.id === cycle) || CYCLES[1]
  const cyclePlan = PLANS[activeCycle.id]

  const openUpgrade = (planId) => {
    setUpgradePlanId(planId || null)
    setShowUpgrade(true)
  }

  // A price is never shown to a child. `mayShowPrice` fails closed — a learner
  // is under-18 unless the profile positively says otherwise — and the
  // `!!userProfile` prefix is load-bearing: mayShowPrice reads a MISSING
  // profile as an anonymous visitor, which is right for a public marketing
  // page and wrong on a learner's own settings screen. Same shape as
  // AccountPanel.jsx.
  //
  // The panel is reachable from the settings nav, so it renders the hand-off
  // rather than nothing: a blank screen a child can navigate to is its own
  // defect, and /ask-a-grown-up is where the request actually goes.
  if (!userProfile || !mayShowPrice(userProfile)) {
    return (
      <Panel section={section}>
        <Section
          title="Plans"
          hint="A grown-up looks after plans and payments for your account."
        >
          <Note tone="accent">
            Ask a grown-up if you need more. They can unlock everything for you.
          </Note>
          <Link className="lset-btn lset-btn--gold" to="/ask-a-grown-up">
            Ask a grown-up
          </Link>
        </Section>
      </Panel>
    )
  }

  return (
    <Panel section={section}>
      <Section
        title="Go Premium"
        hint={isPremium
          ? `You're on ${tierLabel}.`
          : "You're on the Free plan — pick how you'd like to unlock everything."}
      >
        {/* Weekly / Monthly cycle toggle */}
        <div className="lset-go-cycle" role="group" aria-label="Billing cycle">
          {CYCLES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cycle === c.id ? 'is-on' : ''}
              aria-pressed={cycle === c.id}
              onClick={() => setCycle(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* The price card. The "Best value" badge appears only on Monthly —
            it would be a false claim pinned to the Weekly price. */}
        <div className="lset-go-card">
          {cycle === 'monthly' && <span className="lset-go-badge">Best value</span>}
          <div className="lset-go-name">ZedExams Premium</div>
          <div className="lset-go-price">K{cyclePlan.priceZMW}</div>
          <div className="lset-go-per">{activeCycle.per}</div>
          <ul className="lset-go-feats">
            {CARD_FEATURES.map((f) => (
              <li key={f} className="lset-go-feat"><span aria-hidden="true">✓</span> {f}</li>
            ))}
          </ul>
          <button
            type="button"
            className="lset-go-cta"
            onClick={() => openUpgrade(activeCycle.id)}
          >
            Get Premium — K{cyclePlan.priceZMW} {activeCycle.per}
          </button>
        </div>

        {/* The two passes beside the subscription: one day, whole term. */}
        <div className="lset-go-passes">
          <button type="button" className="lset-go-pass" onClick={() => openUpgrade('day_pass')}>
            <b>K{PLANS.day_pass.priceZMW}</b>
            <small>Day pass</small>
          </button>
          <button type="button" className="lset-go-pass" onClick={() => openUpgrade('term_pass')}>
            <b>K{PLANS.term_pass.priceZMW}</b>
            <small>Whole term</small>
          </button>
        </div>

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
          planIds={LADDER_PLAN_IDS}
          defaultPlanId={upgradePlanId || userProfile?.subscriptionPlan}
          onClose={() => { setShowUpgrade(false); setUpgradePlanId(null) }}
        />
      )}
    </Panel>
  )
}
