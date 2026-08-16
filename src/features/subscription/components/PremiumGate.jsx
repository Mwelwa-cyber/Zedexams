import { useState } from 'react'
import { Lock, Sparkles, X } from '../../../shared/components/icons'
import { useSubscription } from '../../../hooks/useSubscription'
import { PLANS } from '../../../engines/payment-engine/subscriptionConfig'
import { isNativePlatform } from '../../../utils/runtime'
import { lockedFeature } from '../lib/lockedFeature'
import Button from '../../../shared/components/Button'
import Icon from '../../../shared/components/Icon'

// Friendly names for the locked-feature modal so the heading reads
// "Exam mode is part of ZedExams Pro" rather than "This feature is…".
const FEATURE_LABELS = {
  examMode: 'Exam mode',
  weaknessAnalysis: 'Weakness analysis',
}

// ── PremiumGate — locks a feature behind full access ─────────────────────────
export default function PremiumGate({ feature, children }) {
  const { canAccessFullContent, canUseExamMode, canUseWeaknessAnalysis } = useSubscription()

  const allowed = feature === 'examMode'           ? canUseExamMode
    : feature === 'weaknessAnalysis'               ? canUseWeaknessAnalysis
    : canAccessFullContent

  if (allowed) return children

  // Open the shared, audience-aware locked-feature modal ("This feature is
  // part of ZedExams Pro. Upgrade to continue.") instead of a bare checkout.
  function openLock() {
    lockedFeature.show({ feature: FEATURE_LABELS[feature] })
  }

  return (
    <div onClick={openLock} className="cursor-pointer select-none relative">
      <div className="opacity-40 pointer-events-none">{children}</div>
      <div className="absolute inset-0 flex items-center justify-center theme-card/80 backdrop-blur-[1px] rounded-2xl">
        <div className="text-center px-4">
          <Icon as={Lock} size="lg" className="mx-auto mb-1 theme-text-muted" />
          <p className="font-black theme-text text-sm">ZedExams Pro</p>
          <p className="theme-accent-text font-bold text-xs underline mt-0.5">Upgrade to unlock</p>
        </div>
      </div>
    </div>
  )
}

// ── AccessBadge — replaces the old AttemptCounter ────────────────────────────
// Shows the user's current access level with an upgrade prompt for demo users.
export function AccessBadge({ onUpgradeClick }) {
  const { accessBadge, isDemoOnly } = useSubscription()

  const colorMap = {
    green:  { bg: 'bg-success-subtle border',  text: 'text-success',  border: 'var(--success-fg)' },
    blue:   { bg: 'bg-info-subtle border',     text: 'text-info',     border: 'var(--info-fg)'    },
    yellow: { bg: 'bg-warning-subtle border',  text: 'text-warning',  border: 'var(--warning-fg)' },
    gray:   { bg: 'theme-bg-subtle border theme-border', text: 'theme-text-muted', border: undefined },
  }
  const colors = colorMap[accessBadge.color] ?? colorMap.gray

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm ${colors.bg}`}
      style={colors.border ? { borderColor: colors.border } : undefined}
    >
      <div className="flex items-center gap-2">
        <Icon as={Sparkles} size="sm" strokeWidth={2.1} />
        <span className={`font-black ${colors.text}`}>{accessBadge.label}</span>
        {isDemoOnly && (
          <span className="theme-text-muted text-xs font-bold">— Demo quizzes only</span>
        )}
      </div>
      {isDemoOnly && (
        <Button variant="ghost" size="sm" onClick={onUpgradeClick}>
          Upgrade <Icon as={Sparkles} size="xs" />
        </Button>
      )}
    </div>
  )
}

// Legacy export kept so existing imports don't break
export function AttemptCounter({ onUpgradeClick }) {
  return <AccessBadge onUpgradeClick={onUpgradeClick} />
}

// ── UpgradeBanner — theme-aware upgrade call-to-action ───────────────────────
export function UpgradeBanner({ onUpgradeClick }) {
  const { canAccessFullContent } = useSubscription()
  const [show, setShow] = useState(true)
  if (canAccessFullContent || !show) return null

  // Entry price = the cheapest plan the learner upgrade modal actually sells
  // (the Grade-7 pack). Pulled from config so the banner can't drift from what
  // checkout charges — the old hardcoded "From K50" referenced a legacy plan
  // that's no longer purchasable, undercutting the real K75 price.
  const entryPriceZMW = PLANS.grade7_monthly?.priceZMW ?? 75

  return (
    <div className="theme-card border-2 theme-border rounded-2xl p-4 flex items-center justify-between gap-3 shadow-elev-sm">
      <div>
        <p className="font-black theme-text text-base">Unlock Full Access</p>
        <p className="theme-text-muted text-xs mt-0.5">All quizzes · Exam mode · Weakness analysis</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button variant="primary" size="sm" onClick={onUpgradeClick}>
          {/* Android: no ZMW price literals — Google Play shows its own price. */}
          {isNativePlatform() ? 'Go Premium' : `From K${entryPriceZMW}/mo`}
        </Button>
        <button
          onClick={() => setShow(false)}
          className="theme-text-muted hover:theme-text min-h-0 p-1 bg-transparent shadow-none"
          aria-label="Dismiss"
        >
          <Icon as={X} size="md" />
        </button>
      </div>
    </div>
  )
}
