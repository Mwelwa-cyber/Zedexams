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
 *
 * ── On Android this screen sells through Google Play ────────────────
 *
 * It did not, and that was a Play policy breach as well as a wrong
 * price: the ZMW figures and the whole mobile-money form rendered inside
 * the Capacitor shell exactly as they do on the web. Play's terms are
 * that a digital subscription sold in the app is sold through Play
 * Billing only — no alternative payment method, and no price literal of
 * our own, because Play's purchase sheet quotes the buyer's own currency
 * (US dollars for most accounts) and a "K50" beside it is simply a
 * different number for the same thing.
 *
 * So the native branch prints no kwacha, offers no network picker, and
 * hands over to `UpgradeModal`, which is already the Play surface
 * everywhere else in the product (it routes to PlayUpgradePanel on
 * native). The marketing pages made the same call — see Plans.jsx's
 * `native` branches, whose "Via Google Play" wording this follows so a
 * parent meets one phrase rather than two.
 *
 * The one real difference between the two platforms, stated on the
 * screen rather than glossed: a Play purchase is made on the GUARDIAN's
 * Google account, so it activates on the guardian and then cascades to
 * every child with an approved link to them (functions/
 * guardianEntitlement.js). The web path names a single beneficiary. Both
 * unlock the child; only one of them can be aimed.
 */
import { Suspense, lazy, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PLANS as CHECKOUT_PLANS } from '../../../engines/payment-engine/subscriptionConfig'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'
import { isNativePlatform } from '../../../utils/runtime'
import useGuardianChildren from '../hooks/useGuardianChildren'
import { can } from '../../../utils/guardianRoles'
import { firstNameOf } from '../lib/parentAppView'
import GuardianCheckout from '../components/GuardianCheckout'
import { BackRow, Empty, ListSkeleton } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

/**
 * Lazy, and through the subscription FRONT DOOR rather than at
 * PlayUpgradePanel directly — a feature may import another feature's
 * index and may not reach past it (`test:import-boundaries`). Lazy
 * because the web build never mounts it, and importing it eagerly would
 * put the whole Lenco upgrade modal into this route's chunk for every
 * browser that will never open it.
 */
const UpgradeModal = lazy(() =>
  import('../../subscription').then((m) => ({ default: m.UpgradeModal })),
)

/** The rungs offered here, in the prototype's order. */
const OFFERED = ['weekly', 'monthly', 'day_pass', 'term_pass']
const HEADLINE = ['weekly', 'monthly']

/**
 * What Google Play can actually sell (`PLAY_SUBS` in playBillingCatalog).
 * The one-off passes are not Play products, so on Android they are not
 * offered at all — a rung a buyer can tap and not buy is worse than a
 * shorter list.
 */
const NATIVE_OFFERED = ['weekly', 'monthly']

export default function ParentPlan() {
  const [params] = useSearchParams()
  const online = useNetworkStatus()
  const { loading, children } = useGuardianChildren()
  const native = isNativePlatform()

  const requestedChild = params.get('child')
  const guardianRequestId = params.get('request') || null

  const [selectedChild, setSelectedChild] = useState(requestedChild || '')
  const [planId, setPlanId] = useState('monthly')
  const [playOpen, setPlayOpen] = useState(false)

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

  // On Android the rung has to be one Play sells; `monthly` is the
  // default and is one, but a deep link or a stale tab could leave a
  // one-off pass selected on a screen that no longer offers it.
  const nativePlanId = NATIVE_OFFERED.includes(planId) ? planId : 'monthly'

  return (
    <>
      <SeoHelmet title="Plans · ZedExams" noIndex />
      <BackRow
        title="Go Premium"
        subtitle={
          native ? 'What a plan covers, and what it costs on Google Play' :
            child ? `For ${childName}` : 'What each plan costs and covers'
        }
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
          {/* A child picker only makes sense where the payment can name a
              beneficiary. A Play purchase covers every linked child, so
              asking which one would be asking a question the platform
              gives us no way to honour. */}
          {!native && payableChildren.length > 1 && (
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
              {/* No kwacha inside the Play shell — see the header. Play's
                  own sheet quotes the buyer's currency, and printing a
                  second figure here would contradict it. */}
              {native ? (
                <>
                  <p className="pax-plan-price pax-plan-price-native">Via Google Play</p>
                  <p className="pax-plan-per">
                    {planId === 'monthly' ? 'billed monthly' : 'billed weekly'}
                  </p>
                </>
              ) : (
                <>
                  <p className="pax-plan-price">K{plan.priceZMW}</p>
                  <p className="pax-plan-per">per {planId === 'monthly' ? 'month' : 'week'}</p>
                </>
              )}
              {plan.features.map((f) => (
                <p className="pax-plan-feature" key={f}><span aria-hidden="true">✓</span> {f}</p>
              ))}
            </section>
          )}

          {/* The one-off passes are Lenco-only: they have no Google Play
              product, so on Android they are not offered rather than
              being offered and failing. */}
          {!native && (
            <>
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
            </>
          )}

          {native ? (
            <>
              <button
                type="button"
                className="lhx-btn lhx-btn-primary lhx-btn-block"
                disabled={online === false}
                onClick={() => setPlayOpen(true)}
              >
                Subscribe with Google Play
              </button>
              <p className="pax-note">
                🔒 Billed by Google Play in your own currency. Google shows
                you the exact amount before anything is charged.
              </p>
              {playOpen && (
                <Suspense fallback={null}>
                  <UpgradeModal
                    portal="learner"
                    planIds={NATIVE_OFFERED}
                    defaultPlanId={nativePlanId}
                    onClose={() => setPlayOpen(false)}
                  />
                </Suspense>
              )}
            </>
          ) : plan && child ? (
            <GuardianCheckout
              plan={plan}
              childUid={child.childUid}
              childName={childName}
              guardianRequestId={guardianRequestId}
              disabled={online === false}
            />
          ) : null}

          <p className="pax-note">
            {native ?
              // Accurate about what a Play purchase does, rather than
              // repeating the web sentence. It activates on the account
              // that bought it and then unlocks every child with an
              // approved link — see functions/guardianEntitlement.js.
              `This subscribes your own account and unlocks ${
                payableChildren.length === 1 ? `${childName}'s` : 'every linked child’s'
              } learning with it. Manage or cancel it any time in Google Play.` :
              `One plan covers one child. Paying here unlocks ${childName}'s account —
               not yours — and the receipt comes to you.`}
          </p>
        </>
      )}

      <div style={{ height: 12 }} />
      <Link className="lhx-btn lhx-btn-soft lhx-btn-block" to="/family">Back to my family</Link>
      <div style={{ height: 20 }} />
    </>
  )
}
