/**
 * PlanUsageCard — the dashboard's single compact plan + usage card
 * (redesign §11). Lives at the bottom of the dashboard: plan chip, AI
 * generations remaining today with the daily reset countdown, top-up
 * credits when any exist, and one plan-appropriate action (Upgrade for
 * Free, Manage plan for paid) plus "View details", which lazy-mounts the
 * full UsageMeter breakdown exactly as before.
 *
 * All numbers come from the existing useTeacherUsage projection (passed in
 * by TeacherDashboard, which already subscribes) — no second usage tracker,
 * and extracting the card removed a duplicate onSnapshot subscription.
 * Wording sticks to what the metering system really is: a per-UTC-day
 * generation allowance (there is no weekly-credit concept to display).
 */

import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../ui/Icon'
import { ArrowRight, ChevronDown, Sparkles } from '../ui/icons'
import { capture } from '../../utils/analytics'
import { formatResetClock, formatResetIn, msUntilDailyReset } from '../../utils/usageReset'

// Heavy (own data hook + big stylesheet); only mounted behind View details.
const UsageMeter = lazy(() => import('./UsageMeter'))

// Caps at or above this are the "unlimited" sentinel the meter uses.
const UNLIMITED_CAP = 99999

// SVG ring gauge — fill fraction is remaining/all for finite plans, a
// gentle decorative arc for unlimited ones.
function UsageGauge({ value, pct }) {
  const r = 24
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, pct))
  return (
    <div className="teacher-usage-gauge">
      <svg viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r={r} fill="none" stroke="#efe7d5" strokeWidth="7" />
        <circle
          cx="30" cy="30" r={r} fill="none" stroke="#2f7d5f" strokeWidth="7"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - clamped)}
          transform="rotate(-90 30 30)"
        />
      </svg>
      <span className="teacher-usage-gauge__value">{value}</span>
    </div>
  )
}

export default function PlanUsageCard({ usage, loading }) {
  const [expanded, setExpanded] = useState(false)
  // Re-render each minute so the countdown stays live instead of freezing
  // at whatever it was when the card mounted (never negative — the helper
  // floors at zero, and the boundary rolls to the next day's reset).
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (loading || !usage) {
    return (
      <div className="teacher-usage-card teacher-usage-card--skeleton" role="status">
        <span className="sr-only">Loading your plan and usage summary…</span>
      </div>
    )
  }

  const unlimited = usage.daily >= UNLIMITED_CAP
  const remaining = Math.max(0, (usage.daily || 0) - (usage.today || 0))
  const isFree = usage.plan === 'free'
  // Countdown + exact LOCAL wall-clock time of the reset, both derived from
  // the server's real UTC day boundary (≈02:00 in Zambia — never "midnight").
  const resetIn = formatResetIn(msUntilDailyReset(nowTick))
  const resetClock = formatResetClock(nowTick)
  const gaugePct = unlimited ? 0.85 : usage.daily ? remaining / usage.daily : 0

  return (
    <div className="teacher-usage-wrap">
      <div className="teacher-usage-card">
        <div className="teacher-usage-card__row">
          <span className={`teacher-plan-chip teacher-plan-chip--${usage.plan}`}>
            <span aria-hidden="true">{isFree ? '⭐' : '👑'}</span> {usage.planLabel} Plan
          </span>

          <div className="teacher-usage-card__metric">
            {unlimited ? (
              <span className="teacher-usage-card__spark" aria-hidden="true">
                <Icon as={Sparkles} size="md" />
              </span>
            ) : (
              <UsageGauge value={remaining} pct={gaugePct} />
            )}
            <div className="teacher-usage-card__metric-body">
              <span className="teacher-usage-card__big">
                {unlimited ? 'Unlimited' : <>{remaining}<span className="teacher-usage-card__den"> of {usage.daily}</span></>}
              </span>
              <span className="teacher-usage-card__k">
                AI generation{unlimited || remaining !== 1 ? 's' : ''} remaining today
              </span>
              <span className="teacher-usage-card__reset">
                Resets in {resetIn} · at {resetClock} local time
                {usage.credits > 0 && (
                  <> · {usage.credits} top-up credit{usage.credits === 1 ? '' : 's'}</>
                )}
              </span>
            </div>
          </div>

          <div className="teacher-usage-card__actions">
            {isFree ? (
              <Link
                to="/teacher/subscription"
                className="teacher-usage-card__upgrade"
                onClick={() => capture('plan_upgrade_clicked', { source: 'dashboard-plan-card', placement: 'dashboard-bottom' })}
              >
                Upgrade
                <Icon as={ArrowRight} size="xs" />
              </Link>
            ) : (
              <Link to="/teacher/subscription" className="teacher-usage-card__manage">
                Manage plan
              </Link>
            )}
            <button
              type="button"
              className="teacher-usage-card__toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => {
                // Measures whether teachers still find the usage section now
                // that it lives at the bottom of the dashboard (redesign §11).
                if (!v) capture('usage_details_expanded', { placement: 'dashboard-bottom' })
                return !v
              })}
            >
              View details
              <Icon as={ChevronDown} size="xs" className={expanded ? 'teacher-usage-card__chevron is-open' : 'teacher-usage-card__chevron'} />
            </button>
          </div>
        </div>
      </div>
      {expanded && (
        <Suspense
          fallback={
            <div className="teacher-usage-card teacher-usage-card--skeleton" role="status">
              <span className="sr-only">Loading usage details…</span>
            </div>
          }
        >
          <UsageMeter />
        </Suspense>
      )}
    </div>
  )
}
