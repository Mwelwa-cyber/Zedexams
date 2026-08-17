/**
 * ParentPlan — /family/plan. The price list, on the side of the app
 * where prices belong.
 *
 * The paywall's rule is that an under-18 learner is never shown a price
 * (see src/services/entitlements): they tap a lock, their guardian gets
 * a message, and the figure appears HERE. So this screen exists to make
 * the offer legible to the adult deciding — what each rung costs, what
 * it covers, and which child asked.
 *
 * ── What this screen does NOT do, and why it says so ────────────────
 *
 * It does not take the payment. A guardian paying for a child needs the
 * money to credit the CHILD's account, and that does not exist yet:
 * `subscriptionActivation` credits `pay.userId`, the payer, and nothing
 * anywhere writes a beneficiary onto a payment. Wiring it touches
 * initiation, activation, invoices, the upgrade quote, the Lenco webhook,
 * Play Billing and the lifecycle sweeps — every one of which currently
 * assumes payer and beneficiary are the same person, and each of which
 * fails as "somebody paid and nobody was credited" if it is missed.
 *
 * A Pay button that credited the parent's own account would look like it
 * worked and would leave the child exactly as locked as before, so there
 * isn't one. The screen says what to do instead.
 */
import { Link, useSearchParams } from 'react-router-dom'
import { PLANS } from '../../../engines/payment-engine/subscriptionConfig'
import useGuardianChildren from '../hooks/useGuardianChildren'
import { firstNameOf } from '../lib/parentAppView'
import { BackRow } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

/** The rungs a guardian is offered, in the prototype's order. */
const CYCLES = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
]
const PASSES = ['day_pass', 'term_pass']

export default function ParentPlan() {
  const [params] = useSearchParams()
  const childUid = params.get('child')
  const { children } = useGuardianChildren()
  const child = children.find((c) => c.childUid === childUid)
  const childName = firstNameOf(child?.displayName)

  return (
    <>
      <SeoHelmet title="Plans · ZedExams" noIndex />
      <BackRow
        title="Plans"
        subtitle={childName ? `${childName} asked to unlock` : 'What each plan costs and covers'}
        to="/family"
      />

      {CYCLES.map((cycle) => {
        const plan = PLANS[cycle.id]
        if (!plan) return null
        return (
          <section className="pax-plan" key={cycle.id}>
            {cycle.id === 'monthly' && <span className="pax-plan-badge">Best value</span>}
            <p style={{ fontWeight: 900, fontSize: 15, marginBottom: 6 }}>
              ZedExams Premium · {plan.name}
            </p>
            <p className="pax-plan-price">K{plan.priceZMW}</p>
            <p className="pax-plan-per">
              per {cycle.id === 'monthly' ? 'month' : 'week'}
            </p>
            {plan.features.map((f) => (
              <p className="pax-plan-feature" key={f}><span aria-hidden="true">✓</span> {f}</p>
            ))}
          </section>
        )
      })}

      <h2 className="lhx-set-head">One-off passes</h2>
      <div className="pax-passes">
        {PASSES.map((id) => {
          const plan = PLANS[id]
          if (!plan) return null
          return (
            <div className="pax-pass" key={id}>
              <b>K{plan.priceZMW}</b>
              <small>{plan.name}</small>
            </div>
          )
        })}
      </div>

      <div className="lhx-card" style={{ padding: 16 }}>
        <p className="lhx-set-title">How to pay for {childName || 'your child'}</p>
        <p className="lhx-set-desc" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
          Paying from a parent account does not credit a child's account yet —
          the payment would unlock <em>your</em> account instead, which would
          leave {childName || 'your child'} exactly as locked as before. So we
          have not put a Pay button here that would do that.
        </p>
        <p className="lhx-set-desc" style={{ margin: '10px 0 0', lineHeight: 1.5 }}>
          For now, the payment has to be made from {childName || 'the child'}'s
          own account, on their device — everything they need is under
          Settings → Subscription there. We are building the family payment,
          and it is the next thing on this screen.
        </p>
      </div>

      <p className="pax-note">
        🔒 Payments run through Lenco — MTN and Airtel mobile money, in kwacha.
        <br />
        Prices are per account and shown in ZMW.
      </p>

      <div style={{ height: 12 }} />
      <Link className="lhx-btn lhx-btn-soft lhx-btn-block" to="/family">
        Back to my family
      </Link>
      <div style={{ height: 20 }} />
    </>
  )
}
