/**
 * MomentOfWinModal — Tier 3. The only full-screen upsell in the product.
 *
 * It fires after a win, never on entry: one per session, 24 hours quiet after
 * any dismissal, seven days after three. Same offer as the sheet, opposite
 * emotional position — the learner has just done something, and is being
 * congratulated rather than billed.
 *
 * ── It cannot be triggered by mounting it ──────────────────────────────
 *
 * `trigger` must be one of `MOMENT_OF_WIN_EVENTS`. Anything else — including
 * no trigger at all, which is what a mount, a route change and a sign-in look
 * like from here — renders null. That is asserted directly in
 * `MomentOfWinModal.spec.jsx` rather than left to the caller's discipline,
 * because "only show this after a win" is a rule that survives exactly as long
 * as the next person who needs a modal in a hurry.
 *
 * The interruption budget is consulted BEFORE the first frame, not after: a
 * modal that flashes and then removes itself has already interrupted.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import useFocusTrap from '../../../hooks/useFocusTrap'
import Icon from '../../../shared/components/Icon'
import { X } from '../../../shared/components/icons'
import {
  MOMENT_OF_WIN_EVENTS,
  TIER,
  interruptionBudget,
  useEntitlements,
  useUnlockFlow,
} from '../../../services/entitlements'
import { capture } from '../../../utils/analytics'

const SURFACE = 'moment-of-win'

/**
 * @param {object} props
 * @param {string} props.trigger        must be in MOMENT_OF_WIN_EVENTS
 * @param {string} props.title          e.g. "5 days in a row"
 * @param {string} [props.body]
 * @param {string} [props.emoji]
 * @param {() => void} [props.onClose]
 */
export default function MomentOfWinModal({
  trigger,
  title,
  body = '',
  emoji = '🔥',
  onClose,
}) {
  const { planState } = useEntitlements()
  const { requestUnlock } = useUnlockFlow()
  const panelRef = useRef(null)

  const validTrigger = MOMENT_OF_WIN_EVENTS.includes(trigger)

  // Decided once, before the first paint. A modal that renders and then
  // withdraws has already taken the screen.
  const [allowed] = useState(() => {
    if (!validTrigger) return false
    return interruptionBudget.canShow({ tier: TIER.FULL_SCREEN, surface: SURFACE, context: null })
  })

  const gate = useMemo(
    () => (planState?.role === 'teacher' ? 'TEACHER_AI_GEN' : 'PAPER_OPEN'),
    [planState?.role],
  )

  useEffect(() => {
    if (!allowed) return
    interruptionBudget.recordShown({ tier: TIER.FULL_SCREEN })
    capture('paywall_shown', {
      surface: SURFACE,
      tier: TIER.FULL_SCREEN,
      trigger,
      gate,
      plan_state: planState?.status || null,
      role: planState?.role || null,
      age_band: planState?.ageBand || null,
    })
  }, [allowed, trigger, gate, planState?.status, planState?.role, planState?.ageBand])

  const openedAt = useRef(Date.now())

  function handleClose() {
    capture('paywall_dismissed', {
      surface: SURFACE,
      gate,
      seconds_visible: Math.round((Date.now() - openedAt.current) / 1000),
    })
    interruptionBudget.recordDismissal(SURFACE)
    onClose?.()
  }

  useFocusTrap(panelRef, { active: allowed, onEscape: handleClose })

  if (!allowed) return null

  return (
    <div
      className="fixed inset-0 z-[9997] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="moment-of-win-title"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={handleClose} aria-hidden="true" />
      <div ref={panelRef} className="relative w-full max-w-xs animate-scale-in rounded-2xl theme-card p-5 text-center shadow-2xl">
        {/* A real ✕, same visual weight as the CTA, present from the first frame. */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full theme-bg-subtle theme-text-muted shadow-none"
        >
          <Icon as={X} size="sm" />
        </button>

        <div className="text-4xl leading-none" aria-hidden="true">{emoji}</div>
        <h2 id="moment-of-win-title" className="mt-2 font-display text-lg font-black theme-text">
          {title}
        </h2>
        {body && <p className="mt-1 text-[12px] leading-relaxed theme-text-muted">{body}</p>}

        <button
          type="button"
          onClick={() => { requestUnlock(gate, { screen: SURFACE }); onClose?.() }}
          className="mt-4 w-full rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-4 py-3 text-sm font-black text-white"
        >
          Keep it going
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="w-full bg-transparent px-4 py-2 text-[12px] font-bold theme-text-muted shadow-none"
        >
          Maybe later
        </button>
      </div>
    </div>
  )
}
