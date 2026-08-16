import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscriptionReminder } from '../../../hooks/useSubscriptionReminder'
import { useTeacherUsage } from '../../../hooks/useTeacherUsage'
import { resolveTeacherPlan, PLAN_LABELS, DAILY_LIMITS } from '../../../engines/payment-engine/teacherPlans'
import { PLAN_PRICES } from '../../../config/teacherPlanPricing'
import { upgradePortal } from '../../../engines/payment-engine/subscriptionStatus'
import { isNativePlatform } from '../../../utils/runtime'
import { UpgradeModal } from '../../subscription'
import { InvoicesCard, PaymentHistoryCard } from '../../learnerDashboard'
import SettingsDetailShell from '../components/SettingsDetailShell'

function formatDate(value) {
  if (!value) return null
  const d = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

// Plan + usage + billing, kept calm (no gauges — the dashboard has those).
// Reuses the subscription hooks + the self-hiding invoice/payment-history
// cards; the modal is the same Lenco checkout every other surface uses.
export default function SubscriptionPanel() {
  const { userProfile, currentUser } = useAuth()
  const { audience, expiry, daysLeft } = useSubscriptionReminder()
  const usage = useTeacherUsage(currentUser?.uid)
  const [showUpgrade, setShowUpgrade] = useState(false)

  const plan = resolveTeacherPlan(userProfile)
  const planLabel = PLAN_LABELS[plan] || 'Free'
  const price = PLAN_PRICES[plan]
  // Android: no ZMW price literals (Google Play shows its own price) and a
  // direct link to Play subscription management for Play-billed plans.
  const native = isNativePlatform()
  const expiryLabel = formatDate(expiry)
  const portal = upgradePortal(audience)
  const data = usage?.data
  const totalUsed = data ? Object.values(data.used).reduce((s, n) => s + n, 0) : 0

  return (
    <SettingsDetailShell rowId="subscription">
      <section className="tset-section">
        <h2 className="tset-section__title">Current plan</h2>
        <div className="tset-usage-row">
          <p className="tset-usage-row__label">Plan</p>
          <p className="tset-usage-row__value">
            {planLabel}
            {!native && plan !== 'free' && price?.monthly > 0 && <small> · K{price.monthly}/month</small>}
          </p>
        </div>
        {expiryLabel && (
          <div className="tset-usage-row">
            <p className="tset-usage-row__label">Renews / expires</p>
            <p className="tset-usage-row__value" style={{ fontSize: 13 }}>
              {expiryLabel}
              {Number.isFinite(daysLeft) && daysLeft >= 0 && <small> · {daysLeft} days left</small>}
            </p>
          </div>
        )}
        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="tset-btn" onClick={() => setShowUpgrade(true)}>
            {plan === 'free' ? 'Upgrade' : plan === 'pro' ? 'Upgrade to Max' : 'Manage plan'}
          </button>
          {native && userProfile?.subscriptionProvider === 'google_play' && (
            <button
              type="button"
              className="tset-btn"
              onClick={() =>
                import('../../../utils/playBilling').then((m) =>
                  m.openPlaySubscriptionManagement(userProfile?.googlePlayProductId))}
            >
              Manage Google Play Subscription
            </button>
          )}
        </div>
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Usage this month</h2>
        {!data ? (
          <p className="tset-section__hint" style={{ margin: 0 }}>Loading…</p>
        ) : (
          <>
            <div className="tset-usage-row">
              <p className="tset-usage-row__label">Generations used</p>
              <p className="tset-usage-row__value">{totalUsed}</p>
            </div>
            <div className="tset-usage-row">
              <p className="tset-usage-row__label">Daily allowance</p>
              <p className="tset-usage-row__value">
                {data.today} <small>of {DAILY_LIMITS[plan] ?? data.daily} today</small>
              </p>
            </div>
            {data.credits > 0 && (
              <div className="tset-usage-row">
                <p className="tset-usage-row__label">Top-up credits</p>
                <p className="tset-usage-row__value">{data.credits}</p>
              </div>
            )}
            <div className="tset-usage-row">
              <p className="tset-usage-row__label">Monthly reset in</p>
              <p className="tset-usage-row__value">
                {data.resetDays} <small>day{data.resetDays === 1 ? '' : 's'}</small>
              </p>
            </div>
          </>
        )}
      </section>

      {/* Billing history — both cards self-hide when the account has none. */}
      <div style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
        <InvoicesCard />
        <PaymentHistoryCard />
      </div>

      {showUpgrade && (
        <UpgradeModal
          portal={plan === 'pro' ? 'maxUpgrade' : portal.portal}
          planIds={plan === 'pro' ? ['max_monthly', 'max_yearly'] : portal.planIds}
          defaultPlanId={plan === 'pro' ? 'max_monthly' : portal.defaultPlanId}
          onClose={() => setShowUpgrade(false)}
        />
      )}
    </SettingsDetailShell>
  )
}
