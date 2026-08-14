import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscriptionReminder } from '../../../hooks/useSubscriptionReminder'
import { upgradePortal, SUB_STATUS } from '../../../utils/subscriptionStatus'
import { isNativePlatform } from '../../../utils/runtime'
import UpgradeModal from '../components/UpgradeModal'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import Button from '../../../components/ui/Button'
import Icon from '../../../components/ui/Icon'
import { ArrowLeft, CheckCircleIcon, Lock, Sparkles, ShieldCheck } from '../../../components/ui/icons'

const STATUS_META = {
  [SUB_STATUS.PRO]:     { label: 'Pro',     tone: 'bg-green-100 text-green-700',  emoji: '⭐' },
  [SUB_STATUS.TRIAL]:   { label: 'Trial',   tone: 'bg-blue-100 text-blue-700',    emoji: '🎁' },
  [SUB_STATUS.EXPIRED]: { label: 'Expired', tone: 'bg-red-100 text-red-700',      emoji: '⏳' },
  [SUB_STATUS.FREE]:    { label: 'Free',    tone: 'bg-amber-100 text-amber-800',  emoji: '✨' },
}

function formatDate(value) {
  if (!value) return null
  const d = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

// What Max adds on top of teacher Pro — drives the "Upgrade to Max" upsell card.
// Kept in sync with the max_monthly features in utils/subscriptionConfig.js.
const MAX_UPGRADE_PERKS = [
  'Unlimited lesson plans, notes & homework',
  'Unlimited assessments & schemes of work',
  '30 generations a day (up from 10)',
  'Bulk export — a whole term in one click',
  'Priority queue when servers are busy',
]

/**
 * My Subscription — every user's home for their plan, benefits, payment status,
 * and the upgrade/renew button. Audience-aware: learners and teachers see their
 * own Pro benefits and check out against the right plan portal.
 *
 * Rendered two ways. Teachers reach it at /teacher/subscription INSIDE
 * TeacherLayout (`inShell`), where the sidebar is the way back and the page
 * owns only its content — so it drops the "Back" link and the full-height
 * page background the shell already provides, and takes the same header
 * treatment as the Settings pages. Learners and admins keep the standalone
 * /my-subscription page, which has no surrounding chrome and therefore still
 * needs its own way back.
 */
export default function MySubscriptionPage({ inShell = false }) {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const {
    status, audience, isPro, isTrial, planType, planLabel, benefits, expiry, daysLeft,
  } = useSubscriptionReminder()
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [showMaxUpgrade, setShowMaxUpgrade] = useState(false)

  const meta = STATUS_META[status] || STATUS_META[SUB_STATUS.FREE]
  const hasAccess = isPro || isTrial
  // Show the REAL tier the user pays for — "Max" must not display as "Pro"
  // just because both resolve to an active (PRO) status. planLabel already
  // resolves to 'Max'/'Pro'/'Trial'/'Expired'/'Free'; STATUS_META only drives
  // the colour + icon. Max gets its own badge emoji.
  const displayLabel = planLabel || meta.label
  const displayEmoji = isPro && planType === 'max' ? '🦅' : meta.emoji
  const expiryLabel = formatDate(expiry)
  const portal = upgradePortal(audience)

  // A teacher on Pro can step up to Max for unlimited generations + bulk export.
  // (Max users and learners — whose tiers don't ladder this way — never see it.)
  const canUpgradeToMax = audience === 'teacher' && isPro && planType === 'pro'

  // Payment status line, derived from the same fields the backend writes.
  const paymentStatus = hasAccess
    ? 'Active'
    : status === SUB_STATUS.EXPIRED
      ? 'Lapsed — renew to reactivate'
      : 'No active subscription'

  // Both Pro and Max are offered in the modal, so keep the button tier-neutral.
  const ctaLabel = status === SUB_STATUS.EXPIRED ? 'Renew' : 'Upgrade'

  return (
    <div className={inShell ? '' : 'min-h-screen theme-bg'}>
      <SeoHelmet
        title="My Subscription"
        path={inShell ? '/teacher/subscription' : '/my-subscription'}
        noIndex
      />
      <div className={`mx-auto max-w-2xl space-y-5 ${inShell ? '' : 'px-4 py-5'}`}>
        {/* Standalone page only: with no sidebar there is nothing else to
            navigate with. Inside the shell the sidebar IS the way back. */}
        {!inShell && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 bg-transparent px-0 text-sm font-black theme-text-muted shadow-none min-h-0 hover:theme-text"
          >
            <Icon as={ArrowLeft} size="sm" /> Back
          </button>
        )}

        <header className={inShell ? 'space-y-1 mb-1' : 'space-y-1'}>
          {/* Inside the teacher shell the sidebar item says "Subscription",
              so the page it opens says the same. The standalone learner page
              has no sidebar to agree with and keeps its own title. */}
          <h1 className={inShell ? 'studio-display text-3xl font-black theme-text' : 'text-2xl font-black theme-text'}>
            {inShell ? 'Subscription' : 'My Subscription'}
          </h1>
          <p className="text-sm font-bold theme-text-muted">
            {audience === 'teacher'
              ? 'Your ZedExams Pro plan for teacher tools.'
              : 'Your ZedExams Pro plan for learning.'}
          </p>
        </header>

        {/* Current plan card */}
        <section className="zx-card rounded-3xl border theme-border theme-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest theme-text-muted">Current plan</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-2xl font-black theme-text">{displayLabel}</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black uppercase ${meta.tone}`}>
                  <span aria-hidden="true">{displayEmoji}</span> {displayLabel}
                </span>
              </div>
            </div>
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl text-white ${
                hasAccess ? 'bg-green-500' : status === SUB_STATUS.EXPIRED ? 'bg-red-500' : 'bg-amber-500'
              }`}
            >
              <Icon as={hasAccess ? ShieldCheck : Lock} size="lg" strokeWidth={2.1} />
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl theme-bg-subtle px-3 py-2.5">
              <dt className="text-[11px] font-black uppercase tracking-wide theme-text-muted">Payment status</dt>
              <dd className="mt-0.5 text-sm font-black theme-text">{paymentStatus}</dd>
            </div>
            <div className="rounded-2xl theme-bg-subtle px-3 py-2.5">
              <dt className="text-[11px] font-black uppercase tracking-wide theme-text-muted">
                {hasAccess && expiryLabel ? 'Renews / expires' : 'Access'}
              </dt>
              <dd className="mt-0.5 text-sm font-black theme-text">
                {hasAccess && expiryLabel
                  ? `${expiryLabel}${daysLeft != null ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}`
                  : hasAccess
                    ? 'Lifetime'
                    : 'Demo / free content only'}
              </dd>
            </div>
          </dl>

          {!hasAccess && (
            <div className="mt-4">
              <Button variant="primary" size="lg" onClick={() => setShowUpgrade(true)}>
                {ctaLabel}
              </Button>
            </div>
          )}
          {hasAccess && status === SUB_STATUS.TRIAL && (
            <div className="mt-4">
              <Button variant="primary" size="lg" onClick={() => setShowUpgrade(true)}>
                Upgrade
              </Button>
            </div>
          )}
          {/* Android + Play-billed subscription: renewal/cancellation lives in
              the Play Store, so link straight there. Web/manual grants keep the
              in-app renew flow above. */}
          {isNativePlatform() && userProfile?.subscriptionProvider === 'google_play' && (
            <div className="mt-4">
              <Button
                variant="secondary"
                size="lg"
                onClick={() =>
                  import('../../../utils/playBilling').then((m) =>
                    m.openPlaySubscriptionManagement(userProfile?.googlePlayProductId))}
              >
                Manage Google Play Subscription
              </Button>
            </div>
          )}
        </section>

        {/* Benefits */}
        <section className="zx-card rounded-3xl border theme-border theme-card p-5 shadow-sm">
          <h2 className="flex items-center gap-1.5 text-base font-black theme-text">
            <Icon as={Sparkles} size="sm" strokeWidth={2.1} className="theme-accent-text" />
            {hasAccess
              ? "What's included in your plan"
              : audience === 'teacher'
                ? 'What ZedExams Pro unlocks for teachers'
                : 'What ZedExams Pro unlocks for learners'}
          </h2>
          <ul className="mt-3 space-y-2">
            {benefits.map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm font-bold theme-text">
                <Icon
                  as={hasAccess ? CheckCircleIcon : Lock}
                  size="sm"
                  strokeWidth={2.1}
                  className={`mt-0.5 flex-shrink-0 ${hasAccess ? 'text-green-500' : 'theme-text-muted'}`}
                />
                <span className={hasAccess ? '' : 'theme-text-muted'}>{b}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Pro → Max upsell (teachers on Pro only) */}
        {canUpgradeToMax && (
          <section className="zx-card rounded-3xl border-2 border-blue-300 bg-blue-50/70 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-blue-700">Get more from ZedExams</p>
                <h2 className="mt-1 flex items-center gap-2 text-lg font-black theme-text">
                  <span aria-hidden="true">🦅</span> Upgrade to Max
                </h2>
                <p className="mt-1 text-sm font-bold theme-text-muted">
                  You're on Pro. Step up to Max for the heaviest teaching weeks.
                </p>
              </div>
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-500 text-white">
                <Icon as={Sparkles} size="lg" strokeWidth={2.1} />
              </div>
            </div>
            <ul className="mt-3 space-y-2">
              {MAX_UPGRADE_PERKS.map((perk) => (
                <li key={perk} className="flex items-start gap-2 text-sm font-bold theme-text">
                  <Icon as={CheckCircleIcon} size="sm" strokeWidth={2.1} className="mt-0.5 flex-shrink-0 text-blue-500" />
                  <span>{perk}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <Button variant="primary" size="lg" onClick={() => setShowMaxUpgrade(true)}>
                Upgrade to Max
              </Button>
            </div>
          </section>
        )}
      </div>

      {showUpgrade && (
        <UpgradeModal
          portal={portal.portal}
          planIds={portal.planIds}
          defaultPlanId={userProfile?.subscriptionPlan && userProfile.subscriptionPlan !== 'free'
            ? userProfile.subscriptionPlan
            : portal.defaultPlanId}
          onClose={() => setShowUpgrade(false)}
        />
      )}

      {showMaxUpgrade && (
        <UpgradeModal
          portal="maxUpgrade"
          planIds={['max_monthly', 'max_yearly']}
          defaultPlanId="max_monthly"
          onClose={() => setShowMaxUpgrade(false)}
        />
      )}
    </div>
  )
}
