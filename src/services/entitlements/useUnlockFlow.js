/**
 * useUnlockFlow — where a tapped lock goes.
 *
 * One destination, for everyone: the plan ladder and the platform's checkout.
 *
 *   web      → the Lenco modal. An under-18 learner enters their PARENT's
 *              mobile-money number on the same device; the parent approves the
 *              prompt on their own phone with their PIN.
 *   Android  → Google Play's purchase sheet, which owns the price and any
 *              Family Link purchase approval. No Lenco, no link, no guardian ask.
 *
 * A twelve-year-old has no mobile money account of their own, which is why the
 * web checkout asks for the parent's number rather than the learner's. WHETHER
 * a minor may complete a purchase is still the server's call
 * (`assertMayStartPurchase`) — this only decides what they are shown.
 */

import { useCallback, useEffect, useState } from 'react'
import { AGE_BAND } from './planState'
import { unlockSheet } from './unlockSheet'
import { interruptionBudget } from './interruptionBudget'
import { FEATURE_GATES, TIER } from './gates'
import { useEntitlements } from './useEntitlements'
import { capture } from '../../utils/analytics'

export const UNLOCK_ROUTE = Object.freeze({
  CHECKOUT: 'checkout',
})

/**
 * The rule, as a pure function: everyone checks out. (There used to be a second
 * route for an under-18 learner in the Android build, a guardian ask that mailed
 * a Lenco link; it is gone.) What "checks out" means differs by platform and is
 * decided where the money moves, not here — the web opens the Lenco modal, the
 * Android build opens Google Play's purchase sheet.
 */
// eslint-disable-next-line no-unused-vars
export function resolveUnlockRoute(_planState, _options) {
  return UNLOCK_ROUTE.CHECKOUT
}

export function useUnlockFlow() {
  const { planState } = useEntitlements()
  const [request, setRequest] = useState(null)
  const route = resolveUnlockRoute(planState)

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
  }, [planState, route])

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
    route,
    // Whether the sheet this learner reaches carries a price. NOT the same
    // question as `isUnder18`: on the web a minor sees one too.
    showsPrice: route === UNLOCK_ROUTE.CHECKOUT,
    isUnder18: planState?.ageBand !== AGE_BAND.ADULT,
  }
}

export default useUnlockFlow
