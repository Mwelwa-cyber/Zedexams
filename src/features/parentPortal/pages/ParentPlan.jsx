/**
 * ParentPlan — /family/plan. The price list and the checkout, on the side
 * of the app where prices belong.
 *
 * The paywall's rule is that an under-18 learner is never shown a price
 * (see src/services/entitlements): they tap a lock, their guardian gets a
 * message, and the figure appears HERE. So this screen makes the offer
 * legible to the adult deciding — what each rung costs, what it covers,
 * and which child it is for — and then takes the payment.
 *
 * ── Which account the money credits ────────────────────────────────
 *
 * The child's. Every initiation carries `beneficiaryUid`, the server
 * authorises that pairing against `parentLinks` before charging, and
 * `subscriptionActivation` grants to the beneficiary rather than the
 * payer. That was not true until PAY-001 — a payment credited whoever
 * paid — which is why this screen showed prices and no Pay button for as
 * long as it did.
 *
 * A guardian purchase is never an upgrade, so the price shown is always
 * the plan's full price; there is no prorated quote to refresh.
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PLANS as CHECKOUT_PLANS } from '../../../engines/payment-engine/subscriptionConfig'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'
import useGuardianChildren from '../hooks/useGuardianChildren'
import { can } from '../../../utils/guardianRoles'
import { firstNameOf } from '../lib/parentAppView'
import GuardianCheckout from '../components/GuardianCheckout'
import { BackRow, Empty, ListSkeleton } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

/** The rungs offered here, in the prototype's order. */
const OFFERED = ['weekly', 'monthly', 'day_pass', 'term_pass']
const HEADLINE = ['weekly', 'monthly']

export default function ParentPlan() {
  const [params] = useSearchParams()
  const online = useNetworkStatus()
  const { loading, children } = useGuardianChildren()

  const requestedChild = params.get('child')
  const guardianRequestId = params.get('request') || null

  const [selectedChild, setSelectedChild] = useState(requestedChild || '')
  const [planId, setPlanId] = useState('monthly')

  // Only children this guardian may actually pay for. A co-guardian can
  // approve and control but not buy, and the server refuses them — so
  // offering them a Pay button would be a button that fails.
  const payableChildren = useMemo(
    () => children.filter((c) => can(c.role, 'manageBilling')),
    [children],
  )

  const child = payableChildren.find((c) => c.childUid === (selectedChild || requestedChild))
    || payableChildren[0]
    || null
  const childName = firstNameOf(child?.displayName) || 'your child'
  const plan = CHECKOUT_PLANS[planId]

  return (
    <>
      <SeoHelmet title="Plans · ZedExams" noIndex />
      <BackRow
        title="Go Premium"
        subtitle={child ? `For ${childName}` : 'What each plan costs and covers'}
        to="/family"
      />

      {loading ? (
        <ListSkeleton rows={2} height={140} />
      ) : payableChildren.length === 0 ? (
        <Empty icon="👪">
          {children.length > 0 ?
            'Only the account owner can pay for a child. Ask the guardian who set the account up.' :
            'Link a child first — then you can unlock ZedExams for them here.'}
        </Empty>
      ) : (
        <>
          {payableChildren.length > 1 && (
            <>
              <h2 className="lhx-set-head">Who is this for?</h2>
              <div className="pax-pay-methods" role="radiogroup" aria-label="Choose a child">
                {payableChildren.map((c) => (
                  <button
                    type="button"
                    key={c.childUid}
                    role="radio"
                    aria-checked={c.childUid === child?.childUid}
                    className={`pax-pay ${c.childUid === child?.childUid ? 'is-selected' : ''}`}
                    onClick={() => setSelectedChild(c.childUid)}
                  >
                    {firstNameOf(c.displayName)}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="pax-cycle" role="tablist" aria-label="Billing period">
            {HEADLINE.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={planId === id}
                className={planId === id ? 'is-on' : ''}
                onClick={() => setPlanId(id)}
              >
                {CHECKOUT_PLANS[id].name}
              </button>
            ))}
          </div>

          {HEADLINE.includes(planId) && plan && (
            <section className="pax-plan">
              {planId === 'monthly' && <span className="pax-plan-badge">Best value</span>}
              <p style={{ fontWeight: 900, fontSize: 15, marginBottom: 6 }}>
                ZedExams Premium · {plan.name}
              </p>
              <p className="pax-plan-price">K{plan.priceZMW}</p>
              <p className="pax-plan-per">per {planId === 'monthly' ? 'month' : 'week'}</p>
              {plan.features.map((f) => (
                <p className="pax-plan-feature" key={f}><span aria-hidden="true">✓</span> {f}</p>
              ))}
            </section>
          )}

          <h2 className="lhx-set-head">Or a one-off pass</h2>
          <div className="pax-passes">
            {OFFERED.filter((id) => !HEADLINE.includes(id)).map((id) => {
              const p = CHECKOUT_PLANS[id]
              if (!p) return null
              return (
                <button
                  type="button"
                  key={id}
                  className={`pax-pass ${planId === id ? 'is-selected' : ''}`}
                  aria-pressed={planId === id}
                  onClick={() => setPlanId(id)}
                >
                  <b>K{p.priceZMW}</b>
                  <small>{p.name}</small>
                </button>
              )
            })}
          </div>

          {plan && child && (
            <GuardianCheckout
              plan={plan}
              childUid={child.childUid}
              childName={childName}
              guardianRequestId={guardianRequestId}
              disabled={online === false}
            />
          )}

          <p className="pax-note">
            One plan covers one child. Paying here unlocks {childName}'s account —
            not yours — and the receipt comes to you.
          </p>
        </>
      )}

      <div style={{ height: 12 }} />
      <Link className="lhx-btn lhx-btn-soft lhx-btn-block" to="/family">Back to my family</Link>
      <div style={{ height: 20 }} />
    </>
  )
}
