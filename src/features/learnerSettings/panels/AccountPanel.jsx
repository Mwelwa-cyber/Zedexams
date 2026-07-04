// Account panel — subscription, account overview, data export, delete account.
// Real wiring throughout: subscription from useSubscription + UpgradeModal,
// data export builds a JSON blob from the live profile, delete runs the real
// deleteMyAccount cloud path.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscription } from '../../../hooks/useSubscription'
import { deleteMyAccount } from '../../../utils/accountService'
import { PLANS } from '../../../utils/subscriptionConfig'
import UpgradeModal from '../../../components/subscription/UpgradeModal'
import InvoicesCard from '../../../components/dashboard/InvoicesCard'
import PaymentHistoryCard from '../../../components/dashboard/PaymentHistoryCard'
import { Panel, Section, Btn, Note, Field, TextInput } from '../components/ui'

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts?.toDate?.() ?? new Date(ts)
  if (Number.isNaN(d?.getTime?.())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Polished pricing cards that mirror the teacher upgrade modal — icon chip,
// price, a couple of headline features and a "Most popular" ribbon. Paid cards
// open the same Lenco checkout modal, pre-selected to that plan. Prices +
// features come straight from PLANS so the cards never drift from checkout.
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

export default function AccountPanel({ section, pushToast }) {
  const { userProfile, currentUser } = useAuth()
  const { tierLabel, isPremium } = useSubscription()
  const navigate = useNavigate()

  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradePlanId, setUpgradePlanId] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Highlight the card that matches the learner's live plan. Non-premium →
  // Free; premium learners on a plan outside these three (e.g. a grade pack)
  // still see them, just without a "current" flag.
  const currentPlan = !isPremium ? 'free' : (userProfile?.subscriptionPlan || 'monthly')

  const openUpgrade = (planId) => {
    setUpgradePlanId(planId || null)
    setShowUpgrade(true)
  }

  // Rough storage figure from the one learner-controlled blob we store.
  const storageKb = useMemo(() => {
    const photo = userProfile?.avatarPhotoUrl || ''
    return Math.max(1, Math.round((photo.length * 0.75) / 1024))
  }, [userProfile?.avatarPhotoUrl])

  const downloadData = () => {
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        account: { email: currentUser?.email, uid: currentUser?.uid },
        profile: userProfile || {},
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `zedexams-my-data-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      pushToast?.('success', 'Your data download has started.')
    } catch {
      pushToast?.('error', 'Could not prepare your data. Please try again.')
    }
  }

  const canDelete = confirmText.trim().toUpperCase() === 'DELETE'
  const handleDelete = async () => {
    if (!canDelete || deleting) return
    setDeleting(true)
    try {
      await deleteMyAccount()
      pushToast?.('success', 'Your account and data have been permanently deleted.')
      navigate('/', { replace: true })
    } catch {
      pushToast?.('error', 'We could not delete your account. Please try again or contact support.')
      setDeleting(false)
    }
  }

  return (
    <Panel section={section}>
      {/* Subscription */}
      <Section title="Your subscription" hint="Pick the plan that fits how you study.">
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
          <Note tone="accent">You're on <strong>{tierLabel}</strong>. Manage renewal and receipts below.</Note>
        )}
      </Section>

      {/* Account overview */}
      <Section title="Account" hint="Details tied to your ZedExams account.">
        <div className="lset-grid">
          <Field label="Login email" htmlFor="lset-acct-email">
            <TextInput id="lset-acct-email" value={currentUser?.email ?? ''} disabled />
          </Field>
          <Field label="Plan"><TextInput value={isPremium ? tierLabel : 'Free'} disabled /></Field>
          <Field label="Member since"><TextInput value={fmtDate(userProfile?.createdAt)} disabled /></Field>
          <Field label="Storage used" hint="Your avatar and saved items"><TextInput value={`${storageKb} KB`} disabled /></Field>
        </div>
      </Section>

      <InvoicesCard />
      <PaymentHistoryCard />

      {/* Data & privacy */}
      <Section title="Your data" hint="Download a copy of your information or review your privacy choices.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Btn variant="ghost" onClick={downloadData}>⬇ Download my data</Btn>
          <Btn variant="ghost" onClick={() => navigate('/settings?section=privacy')}>Privacy settings</Btn>
        </div>
      </Section>

      {/* Danger zone */}
      <Section title="Delete account" hint="Permanently delete your ZedExams account and personal data. This cannot be undone.">
        <Note tone="danger">
          Deleting removes your profile, results, saved content, class memberships and subscription records tied to{' '}
          <strong>{currentUser?.email || 'your account'}</strong>. You'll be signed out immediately.
        </Note>
        {!confirming ? (
          <div style={{ marginTop: 14 }}>
            <Btn variant="danger" onClick={() => setConfirming(true)}>Delete my account</Btn>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <Field label="Type DELETE to confirm" htmlFor="lset-del">
              <TextInput id="lset-del" value={confirmText} onChange={setConfirmText} placeholder="DELETE" disabled={deleting} />
            </Field>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              <Btn variant="danger" onClick={handleDelete} disabled={!canDelete} loading={deleting}>Permanently delete</Btn>
              <Btn variant="ghost" onClick={() => { setConfirming(false); setConfirmText('') }} disabled={deleting}>Cancel</Btn>
            </div>
          </div>
        )}
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
