import { useState } from 'react'
import { useSubscription } from '../../hooks/useSubscription'
import UpgradeModal from './UpgradeModal'

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
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-2xl">
          <div className="text-center px-4">
            <div className="text-3xl mb-1">🔒</div>
            <p className="font-black text-gray-700 text-sm">Upgrade required</p>
            <p className="text-indigo-600 font-bold text-xs underline mt-0.5">Upgrade to unlock</p>
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
    green:  { bg: 'bg-green-50 border-green-200',  text: 'text-green-700' },
    blue:   { bg: 'bg-blue-50 border-blue-200',    text: 'text-blue-700'  },
    yellow: { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-700' },
    gray:   { bg: 'bg-gray-50 border-gray-200',    text: 'text-gray-600'  },
  }
  const colors = colorMap[accessBadge.color] ?? colorMap.gray

  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm border ${colors.bg}`}>
      <div className="flex items-center gap-2">
        <span>{accessBadge.icon}</span>
        <span className={`font-black ${colors.text}`}>{accessBadge.label}</span>
        {isDemoOnly && (
          <span className="text-gray-400 text-xs font-bold">— Demo quizzes only</span>
        )}
      </div>
      {isDemoOnly && (
        <button
          onClick={onUpgradeClick}
          className="text-xs font-black text-indigo-600 hover:text-indigo-800 underline min-h-0 p-0 bg-transparent shadow-none whitespace-nowrap"
        >
          Upgrade ⭐
        </button>
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
    <div className="theme-card border-2 border-indigo-200 rounded-2xl p-4 flex items-center justify-between gap-3">
      <div>
        <p className="font-black theme-text text-base">Unlock Full Access</p>
        <p className="theme-text-muted text-xs mt-0.5">All quizzes · All papers · Exam mode · Weakness analysis</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onUpgradeClick}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm py-2 px-4 rounded-full shadow min-h-0 transition-colors"
        >
          From K50/mo
        </button>
        <button
          onClick={() => setShow(false)}
          className="theme-text-muted hover:theme-text font-black text-xl min-h-0 p-0 bg-transparent shadow-none"
        >
          ×
        </button>
      </div>
    </div>
  )
}
