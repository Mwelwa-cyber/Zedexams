/**
 * useUnlockFlow — where a tapped lock goes.
 *
 * Exactly two destinations, and which one is not a preference:
 *
 *   under18 → the guardian-ask sheet. No price, no plan card, no pay button.
 *   adult   → the plan ladder and Lenco checkout.
 *
 * `resolveUnlockRoute` is a pure function of the plan state so the rule can be
 * asserted directly, and the sheet component reads the route off the request
 * rather than re-deriving it — one decision, made once. The under-18 variant
 * imports none of the pricing modules, which is the structural half of the
 * same guarantee: there is no price in that component's scope to leak.
 *
 * Why this matters beyond policy: a twelve-year-old has no mobile money
 * account. Showing them K50 is not merely a Play Families violation, it is an
 * offer made to someone who cannot accept it. The child sells; the guardian
 * pays.
 */

import { useCallback, useEffect, useState } from 'react'
import { AGE_BAND } from './planState'
import { unlockSheet } from './unlockSheet'
import { interruptionBudget } from './interruptionBudget'
import { FEATURE_GATES, TIER } from './gates'
import { useEntitlements } from './useEntitlements'
import { capture } from '../../utils/analytics'

export const UNLOCK_ROUTE = Object.freeze({
  GUARDIAN: 'guardian',
  CHECKOUT: 'checkout',
})

/**
 * The rule, as a pure function. Anything that is not positively an adult
 * routes to the guardian — see `resolveAgeBand` for why the default is the
 * survivable mistake rather than the symmetric one.
 */
export function resolveUnlockRoute(planState) {
  return planState?.ageBand === AGE_BAND.ADULT
    ? UNLOCK_ROUTE.CHECKOUT
    : UNLOCK_ROUTE.GUARDIAN
}

export function useUnlockFlow() {
  const { planState } = useEntitlements()
  const [request, setRequest] = useState(null)

  useEffect(() => unlockSheet.subscribe(setRequest), [])

  /**
   * Open the unlock surface for a gate.
   *
   * Returns `false` when the interruption budget refused — a caller that
   * needs to know (to leave a lock badge in its pressed state, say) can act on
   * it, and the refusal has already been reported to the funnel.
   */
  const requestUnlock = useCallback((gateId, context = {}) => {
    const gate = FEATURE_GATES[gateId]
    if (!gate) return false

    // A TAP is the user asking. The budget still gets a say — three
    // dismissals of the same sheet means it has been answered — but a tap is
    // never suppressed by the app-open quiet period or a blocked context,
    // because the learner is the one who initiated it and refusing would make
    // the padlock look broken.
    const allowed = interruptionBudget.canShow({
      tier: TIER.INLINE,
      surface: `unlock-sheet:${gateId}`,
      context: null,
    })
    if (!allowed) return false

    const route = resolveUnlockRoute(planState)
    capture('lock_tapped', { gate: gateId, screen: context.screen || null })
    capture('paywall_shown', {
      surface: 'contextual-sheet',
      tier: gate.tier,
      trigger: 'lock_tap',
      gate: gateId,
      plan_state: planState?.status || null,
      role: planState?.role || null,
      age_band: planState?.ageBand || null,
    })
    unlockSheet.open({ gate: gateId, route, context, openedAt: Date.now() })
    return true
  }, [planState])

  const closeUnlock = useCallback((gateId) => {
    const openedAt = request?.openedAt
    capture('paywall_dismissed', {
      surface: 'contextual-sheet',
      gate: gateId || request?.gate || null,
      seconds_visible: openedAt ? Math.round((Date.now() - openedAt) / 1000) : null,
    })
    interruptionBudget.recordDismissal(`unlock-sheet:${gateId || request?.gate || 'unknown'}`)
    unlockSheet.close()
  }, [request])

  return {
    request,
    requestUnlock,
    closeUnlock,
    route: resolveUnlockRoute(planState),
    isUnder18: planState?.ageBand !== AGE_BAND.ADULT,
  }
}

export default useUnlockFlow
