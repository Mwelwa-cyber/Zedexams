/**
 * ParentPlanStatus — what /family/plan shows a guardian who is ALREADY
 * paying, instead of a Buy button.
 *
 * ── Why a Buy button here is a bug, not a redundancy ────────────────
 *
 * The two rails cannot see each other. A parent who pays on the web in
 * the morning and opens the Android app in the evening is a parent who
 * will pay again — and on Play that second purchase renews itself every
 * month until somebody notices. The server refuses the grant (see
 * functions/shared/billing/crossRailCore.js, which this screen shares),
 * but a refusal after Google has taken the money is a refund, a support
 * conversation, and a customer who was only trying to pay us.
 *
 * So the rule is: if this household is already covered, there is no
 * purchase UI. Just what they have, and how to change it.
 *
 * ── Cancel is branched by SOURCE, and the Play branch has none ──────
 *
 * A Google Play subscription can only be cancelled in Google Play. An
 * in-app cancel button for a Play buyer would do nothing, which is both a
 * Play rejection reason and a reliable way to generate a refund dispute
 * from somebody who believed they had cancelled. Play buyers get a deep
 * link into Play; web buyers keep the in-app control.
 *
 * A one-time PASS gets neither. There is nothing to cancel and nothing
 * to manage — it runs out on its own — and offering "Manage in Google
 * Play" for one sends a parent to a screen that will not list it.
 */
import { Link } from 'react-router-dom'
import { isNativePlatform } from '../../../utils/runtime'
import { RAIL, railOfProvider } from '../../../utils/crossRail'
import { planRenewsOnPlay } from '../../../utils/playBillingCatalog'

function formatDate(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function ParentPlanStatus({ child }) {
  const rail = railOfProvider(child?.subscriptionProvider)
  const until = formatDate(child?.premiumExpiresAt)
  const name = child?.firstName || 'your child'
  // A cascaded grant has no rail of its own — it is the shadow of a
  // payment made for a sibling — so it is described without a manage
  // control rather than being pointed at one that would not find it.
  const cascaded = child?.subscriptionProvider === 'guardian_cascade'
  const renews = rail === RAIL.PLAY ? planRenewsOnPlay(child?.subscriptionPlan) : false

  return (
    <div className="lhx-card" style={{ padding: 16 }}>
      <p className="lhx-set-title">{name} is on Premium ✅</p>
      <p className="lhx-set-desc" style={{ marginTop: 6, lineHeight: 1.5 }}>
        {until
          ? renews
            ? `Renews on ${until}.`
            : `Full access until ${until}.`
          : 'Full access is open on their account.'}
        {cascaded && ' This came from a plan you bought for another child in the family.'}
      </p>

      {rail === RAIL.PLAY && (
        <>
          <p className="lhx-set-desc" style={{ marginTop: 10, lineHeight: 1.5 }}>
            {renews
              ? 'This plan is billed through Google Play.'
              : 'This was a one-off purchase through Google Play — it does not renew, ' +
                'and there is nothing to cancel.'}
          </p>
          {/* Only a renewing subscription has a Play manage screen. Sending
              a pass buyer there lands them somewhere their purchase is not
              listed, which reads as the purchase having gone missing. */}
          {renews && (
            isNativePlatform() ? (
              <button
                type="button"
                className="lhx-btn lhx-btn-soft lhx-btn-block"
                onClick={() => import('../../../utils/playBilling')
                  .then((m) => m.openPlaySubscriptionManagement(child?.subscriptionPlan))}
              >
                Manage in Google Play
              </button>
            ) : (
              // On the web there is no Play plugin to call, but the same
              // truth holds: this plan can only be changed in Play. A
              // plain link is honest; an in-app cancel would not be.
              <a
                className="lhx-btn lhx-btn-soft lhx-btn-block"
                href="https://play.google.com/store/account/subscriptions"
                target="_blank"
                rel="noopener noreferrer"
              >
                Manage in Google Play
              </a>
            )
          )}
        </>
      )}

      {rail === RAIL.LENCO && !isNativePlatform() && (
        <>
          <p className="lhx-set-desc" style={{ marginTop: 10, lineHeight: 1.5 }}>
            A ZedExams plan does not renew itself — you paid for the period you
            chose, and nothing is taken after it ends.
          </p>
          <Link className="lhx-btn lhx-btn-soft lhx-btn-block" to="/family/account/billing">
            See payments and receipts
          </Link>
        </>
      )}

      {/* Inside the Android app, a plan bought on the web must not be
          described in terms of the payment method that bought it — that
          is steering copy. What a parent needs here is only that it is
          handled elsewhere. */}
      {rail === RAIL.LENCO && isNativePlatform() && (
        <p className="lhx-set-desc" style={{ marginTop: 10, lineHeight: 1.5 }}>
          This plan was set up outside the app and does not renew
          automatically. Nothing further is needed.
        </p>
      )}
    </div>
  )
}
