import { useState } from 'react'
import { Lock, Sparkles, X } from '../ui/icons'
import { useSubscription } from '../../hooks/useSubscription'
import UpgradeModal from './UpgradeModal'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

// ── PremiumGate — locks a feature behind full access ─────────────────────────
export default function PremiumGate({ feature, children }) {
  const { canAccessFullContent, canUseExamMode, canUseWeaknessAnalysis } = useSubscription()
  const [showUpgrade, setShowUpgrade] = useState(false)

  const allowed = feature === 'examMode'           ? canUseExamMode
    : feature === 'weaknessAnalysis'               ? canUseWeaknessAnalysis
    : canAccessFullContent

  if (allowed) return children

  return (
    <>
      <div onClick={() => setShowUpgrade(true)} className="cursor-pointer select-none relative">
        <div className="opacity-40 pointer-events-none">{children}</div>
        <div className="absolute inset-0 flex items-center justify-center theme-card/80 backdrop-blur-[1px] rounded-2xl">
          <div className="text-center px-4">
            <Icon as={Lock} size="lg" className="mx-auto mb-1 theme-text-muted" />
            <p className="font-black theme-text text-sm">Upgrade required</p>
            <p className="theme-accent-text font-bold text-xs underline mt-0.5">Upgrade to unlock</p>
          </div>
        </div>
      </div>
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </>
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

  return (
    <div className="theme-card border-2 theme-border rounded-2xl p-4 flex items-center justify-between gap-3 shadow-elev-sm">
      <div>
        <p className="font-black theme-text text-base">Unlock Full Access</p>
        <p className="theme-text-muted text-xs mt-0.5">All quizzes · Exam mode · Weakness analysis</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button variant="primary" size="sm" onClick={onUpgradeClick}>
          From K50/mo
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
