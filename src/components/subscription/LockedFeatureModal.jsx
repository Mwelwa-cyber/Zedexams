import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { lockedFeature } from '../../utils/lockedFeature'
import { useAuth } from '../../contexts/AuthContext'
import {
  PRO_BENEFITS,
  audienceForProfile,
  resolveSubscriptionStatus,
} from '../../utils/subscriptionStatus'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { Lock, Sparkles, CheckCircleIcon, X } from '../ui/icons'

/**
 * Locked-feature modal — shown whenever a Free / Expired user tries to open a
 * Pro feature. Driven by the lockedFeature singleton bus so any component can
 * trigger it with lockedFeature.show({ feature, audience }).
 *
 * Mounted once at the app root. Self-hides for Pro / Trial users (their access
 * is live, so a stray trigger should never nag them).
 */
export default function LockedFeatureModal() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState(null)

  useEffect(() => lockedFeature.subscribe(setState), [])

  // Body scroll-lock + Esc to close while open.
  useEffect(() => {
    if (!state) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) { if (e.key === 'Escape') lockedFeature.hide() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [state])

  if (!state) return null

  const audience = state.audience || audienceForProfile(userProfile)
  // If the user actually has access (Pro / Trial / admin), never block them —
  // close silently. Guards against a stale trigger after an upgrade.
  const { shouldRemind } = resolveSubscriptionStatus(userProfile, { audience })
  if (!shouldRemind) return null

  const benefits = PRO_BENEFITS[audience] || PRO_BENEFITS.learner
  const featureName = state.feature ? `${state.feature}` : 'This feature'

  function handleUpgrade() {
    lockedFeature.hide()
    navigate('/my-subscription')
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="locked-feature-title"
    >
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={() => lockedFeature.hide()}
        aria-hidden="true"
      />
      <div className="relative theme-card w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border theme-border shadow-2xl animate-scale-in overflow-hidden">
        <button
          type="button"
          onClick={() => lockedFeature.hide()}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 theme-text-muted hover:theme-text bg-transparent shadow-none min-h-0 p-1.5 rounded-full"
        >
          <Icon as={X} size="md" />
        </button>

        {/* Hero */}
        <div className="theme-accent-fill theme-on-accent px-6 pt-7 pb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20">
            <Icon as={Lock} size="xl" strokeWidth={2.1} />
          </div>
          <p className="text-xs font-black uppercase tracking-widest opacity-90">✦ Pro feature</p>
          <h2 id="locked-feature-title" className="mt-1 text-xl font-black leading-tight">
            {featureName} is part of ZedExams Pro
          </h2>
          <p className="mt-1.5 text-sm font-bold opacity-90">
            Upgrade to continue — no break in your studying.
          </p>
        </div>

        {/* Benefits */}
        <div className="px-6 py-5">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-black theme-text">
            <Icon as={Sparkles} size="sm" strokeWidth={2.1} className="theme-accent-text" />
            {audience === 'teacher' ? 'Your Pro toolkit includes' : 'Pro unlocks'}
          </p>
          <ul className="space-y-2">
            {benefits.map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm font-bold theme-text">
                <Icon as={CheckCircleIcon} size="sm" strokeWidth={2.1} className="mt-0.5 flex-shrink-0 text-green-500" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-col gap-2">
            <Button variant="primary" size="lg" onClick={handleUpgrade}>
              Upgrade to Pro
            </Button>
            <Button variant="ghost" size="md" onClick={() => lockedFeature.hide()}>
              Maybe later
            </Button>
          </div>
          <p className="mt-3 text-center text-xs theme-text-muted">
            Pay with MTN MoMo or Airtel · Cancel anytime
          </p>
        </div>
      </div>
    </div>
  )
}
