import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { resolveTeacherPlan } from '../../../engines/payment-engine/teacherPlans'
import { activateExistingTeacherTrialOffer } from '../services/existingTeacherTrialOfferService'
import { capture } from '../../../utils/analytics'
import Icon from '../../../shared/components/Icon'
import { Sparkles, ArrowRight, CheckCircleIcon, Clock, RotateCw, X } from '../../../shared/components/icons'

// Session-scoped, exactly like UsageReminderBanner/RenewalBanner's own
// dismiss keys — never Firestore, and never read by anything that decides
// eligibility or redemption. "Maybe Later" hides the DASHBOARD card only;
// the offer itself (users/{uid}.teacherTrialOffer.status) is untouched, so
// it is still there next session and still reachable from My Subscription.
const DISMISS_KEY = 'zedexams.existingTeacherTrialOffer.dismissed'

const DAY_MS = 24 * 60 * 60 * 1000

function toDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function daysLeft(expiryMs, now = Date.now()) {
  if (!Number.isFinite(expiryMs)) return null
  return Math.max(0, Math.ceil((expiryMs - now) / DAY_MS))
}

function formatExpiry(expiryMs) {
  if (!Number.isFinite(expiryMs)) return ''
  return new Date(expiryMs).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

/**
 * The existing-teacher trial offer — and, once claimed, the active-trial
 * status — as one card. Two bodies, never both:
 *
 *   • OFFER   — users.teacherTrialOffer.status === 'available' and the
 *     teacher is currently on Free. "Start Free Trial" calls the backend
 *     (functions/teacherTrial/existingTeacherOffer.js); nothing here decides
 *     eligibility, it only shows what the server has already decided.
 *   • ACTIVE  — resolveTeacherPlan(userProfile) === 'trial', which is true
 *     for EITHER the automatic signup trial or this offer once claimed —
 *     deliberately the same presentation for both, since they are the same
 *     entitlement (teacherPlan: 'trial' + teacherTrialEndsAt) under the hood.
 *
 * Renders nothing for every other teacher, and nothing at all for a
 * non-teacher. Mounted on the teacher dashboard (dismissible) and on My
 * Subscription (dismissible=false — a page the teacher navigated to on
 * purpose is not a place to hide things from them).
 */
export default function TeacherTrialOfferCard({ dismissible = true, hideActive = false, className = '' }) {
  const { userProfile } = useAuth()
  const navigate = useNavigate()

  const [dismissed, setDismissed] = useState(false)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState('')
  // Set once the callable resolves, so the confirmation + the switch to the
  // active body is immediate rather than waiting on the profile's own
  // onSnapshot round-trip. The live profile value (once it arrives) always
  // wins — see effectiveExpiryMs below — so this is only ever a bridge.
  const [justActivated, setJustActivated] = useState(null)

  useEffect(() => {
    if (!dismissible) return
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [dismissible])

  if (!userProfile || userProfile.role !== 'teacher') return null

  const livePlan = resolveTeacherPlan(userProfile)
  const isLiveTrial = livePlan === 'trial'
  const isActive = isLiveTrial || !!justActivated

  const offerAvailable = !isActive
    && userProfile.teacherTrialOffer?.status === 'available'
    && livePlan === 'free'

  if (!isActive && !offerAvailable) return null
  if (!isActive && dismissible && dismissed) return null
  // My Subscription already has its own "Current plan: Trial" presentation
  // (badge, expiry, days left, Upgrade button) — this card's job there is
  // only to surface the OFFER, not to duplicate that section once claimed.
  if (isActive && hideActive) return null

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* private mode — dismissal just won't persist */
    }
    capture('existing_teacher_trial_offer_dismissed')
    setDismissed(true)
  }

  async function start() {
    setError('')
    setActivating(true)
    capture('existing_teacher_trial_offer_start_clicked')
    try {
      const res = await activateExistingTeacherTrialOffer()
      setJustActivated(res)
      capture('existing_teacher_trial_activated', { alreadyActive: res?.alreadyActive === true })
    } catch (err) {
      setError(err?.message || "Something went wrong — we couldn't start your trial. Please try again.")
      capture('existing_teacher_trial_activation_failed', { code: err?.code })
    } finally {
      setActivating(false)
    }
  }

  const wrapperClass =
    `rounded-[20px] border p-5 sm:p-6 shadow-sm ${className}`

  if (isActive) {
    const liveExpiryMs = toDate(userProfile.teacherTrialEndsAt)?.getTime()
    const effectiveExpiryMs = Number.isFinite(liveExpiryMs) ? liveExpiryMs : justActivated?.teacherTrialEndsAtMs
    const remaining = daysLeft(effectiveExpiryMs)

    return (
      <section
        role="status"
        className={`${wrapperClass} border-[#F0D8C4] bg-[#FFF4ED]`}
      >
        {justActivated && !justActivated.alreadyActive && (
          <p className="mb-3 flex items-center gap-1.5 text-sm font-black text-[#8A5A2B]">
            <Icon as={CheckCircleIcon} size="sm" strokeWidth={2.2} className="text-[#C65A24]" />
            Your Teacher Pro trial is active!
          </p>
        )}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-[#C65A24]">Teacher Pro Trial</p>
            <h2 className="mt-1 text-xl font-black text-slate-900">
              {remaining != null
                ? `${remaining} day${remaining === 1 ? '' : 's'} left`
                : 'Trial active'}
            </h2>
            {effectiveExpiryMs != null && (
              <p className="mt-1 text-sm font-bold text-slate-600">
                Ends {formatExpiry(effectiveExpiryMs)}
              </p>
            )}
          </div>
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#C65A24] text-white">
            <Icon as={Sparkles} size="md" strokeWidth={2.1} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => navigate('/teacher')}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl border border-[#E7C3A6] bg-white px-4 py-2.5 text-sm font-black text-[#8A5A2B] transition-colors hover:bg-[#FBE9DC]"
          >
            Explore Pro tools
            <Icon as={ArrowRight} size="xs" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/teacher/subscription')}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl bg-[#C65A24] px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-[#B14F1E]"
          >
            Upgrade to Teacher Pro
          </button>
        </div>
      </section>
    )
  }

  // ── Offer body ──────────────────────────────────────────────────────
  return (
    <section
      role="region"
      aria-label="Teacher Pro trial offer"
      className={`${wrapperClass} border-[#F0D8C4] bg-[#FFF4ED] relative`}
    >
      {dismissible && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss — Maybe Later"
          disabled={activating}
          className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full text-[#8A5A2B]/60 transition-colors hover:bg-[#F3D9C4] hover:text-[#8A5A2B]"
        >
          <Icon as={X} size="sm" />
        </button>
      )}

      <div className="flex items-start gap-3 pr-8">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#C65A24] text-white">
          <Icon as={Sparkles} size="md" strokeWidth={2.1} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#C65A24]">Teacher Pro</p>
          <h2 className="mt-0.5 text-xl font-black text-slate-900">Enjoy 7 days free</h2>
        </div>
      </div>

      <p className="mt-3 text-sm font-bold text-slate-700">
        Unlock lesson planning, assessments, worksheets and exports.
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-500">
        <Icon as={Clock} size="xs" />
        No payment required &bull; No automatic charge
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={start}
          disabled={activating}
          aria-busy={activating || undefined}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#C65A24] px-5 py-3 text-sm font-black text-white shadow-sm transition-colors hover:bg-[#B14F1E] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {activating ? (
            <>
              <Icon as={RotateCw} size="sm" className="animate-spin" />
              Starting trial…
            </>
          ) : (
            <>
              Start Free Trial
              <Icon as={ArrowRight} size="xs" />
            </>
          )}
        </button>
        {dismissible ? (
          <button
            type="button"
            onClick={dismiss}
            disabled={activating}
            className="inline-flex min-h-[48px] items-center justify-center rounded-2xl px-4 py-3 text-sm font-black text-[#8A5A2B] transition-colors hover:bg-[#F3D9C4] disabled:cursor-not-allowed disabled:opacity-70"
          >
            Maybe Later
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-xs font-bold text-slate-500">
        Your 7 days begin when you activate the trial.
      </p>
    </section>
  )
}
