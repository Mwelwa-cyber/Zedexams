import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { paywall } from '../../../engines/payment-engine/paywall'
import { topup } from '../../../utils/topup'
import { capture } from '../../../utils/analytics'
import { isNativePlatform } from '../../../utils/runtime'
import { clearPremiumAction, rememberPremiumAction } from '../lib/pendingPremiumAction'
import ContextualUpgradeModal from './ContextualUpgradeModal'
import { resolveUpgradeScenario } from '../lib/upgradeScenarios'

const UpgradeModal = lazy(() => import('./UpgradeModal'))
const TopUpModal = lazy(() => import('./TopUpModal'))

// PaywallHost — mounts once at the root and turns `paywall.show(reason, ctx)`
// events into the compact ContextualUpgradeModal (which replaced the old
// full-width comparison-table paywall — teachers wanting the detailed
// comparison follow its "Compare plans" link to /pricing). This host owns the
// funnel analytics and the hand-off into the checkout modals; the pop-up
// itself is purely presentational.
export default function PaywallHost() {
  // Inside the Capacitor Android shell every purchase runs through Google
  // Play Billing: the K25 one-off (Lenco) offer is hidden, price literals
  // are stripped, and the top-up bus routes to the Play upgrade flow.
  // Computed per render (not module scope) so specs can mock runtime.
  const native = isNativePlatform()
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useAuth()
  const currentUid = currentUser?.uid || null
  const [state, setState] = useState(null)
  const [showUpgrade, setShowUpgrade] = useState(false)
  // Plan routing of the scenario that triggered the upgrade modal — captured
  // before the paywall state is cleared so the checkout opens on the right
  // plans (Max upsell vs the Pro paywalls).
  const [upgradePlans, setUpgradePlans] = useState(null)
  // Pay-per-generation top-up checkout. `topUpState` carries the label of
  // the studio the teacher was blocked on, purely for the modal's copy.
  const [topUpState, setTopUpState] = useState(null)

  useEffect(() => paywall.subscribe(setState), [])
  useEffect(() => topup.subscribe(setTopUpState), [])

  const scenario = state
    ? resolveUpgradeScenario(state.reason, state.ctx || {}, { native })
    : null
  const ctx = state?.ctx || {}

  // Funnel analytics — one event when a paywall is shown. Self-contained on
  // [state] (reads state.reason/state.ctx) so it fires once per show without
  // refiring on unrelated re-renders. capture() no-ops when analytics is
  // disabled or unconsented. Pairs with paywall_upgrade_clicked below.
  useEffect(() => {
    if (!state) return
    const shown = resolveUpgradeScenario(state.reason, state.ctx || {}, { native })
    if (!shown) return
    capture('paywall_shown', {
      reason: state.reason,
      feature: state.ctx?.feature || null,
      plan_target: shown.planTarget,
    })
    // Remember where the teacher was interrupted so a successful payment can
    // return them to this exact spot ("Continue to my work"). Cleared again
    // in handleDismiss if they close without upgrading.
    rememberPremiumAction({
      sourceRoute: location.pathname + location.search,
      uid: currentUid || null,
      reason: state.reason,
      tool: state.ctx?.tool || null,
      feature: state.ctx?.feature || null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  function handlePrimary() {
    if (!scenario) return
    capture('paywall_upgrade_clicked', {
      reason: state?.reason || null,
      feature: ctx.feature || null,
      plan_target: scenario.planTarget,
      via: 'primary',
    })
    setUpgradePlans({ planIds: scenario.planIds, defaultPlanId: scenario.defaultPlanId })
    paywall.hide()
    setShowUpgrade(true)
  }

  function handleSecondary(secondary) {
    if (secondary?.action === 'topup') {
      // Pay-per-generation top-up: K25 buys one extra generation on any tool.
      capture('topup_intent', {
        reason: state?.reason || null,
        feature: ctx.feature || null,
        via: 'paywall-secondary',
      })
      paywall.hide()
      topup.show({ feature: ctx.feature || null })
    }
  }

  function handleDismiss(via) {
    capture('paywall_dismissed', {
      reason: state?.reason || null,
      feature: ctx.feature || null,
      via: via || 'close',
    })
    // Dismissed without upgrading — forget the interruption so a later,
    // unrelated upgrade doesn't teleport them back here.
    clearPremiumAction()
    paywall.hide()
  }

  function handleCompare() {
    capture('paywall_compare_clicked', {
      reason: state?.reason || null,
      feature: ctx.feature || null,
      plan_target: scenario?.planTarget || null,
    })
    // The pop-up never navigates on its own except here — the full plan
    // comparison lives on /pricing. Dismissing/upgrading stays in place so
    // the studio (and any unsaved work behind the modal) is untouched.
    paywall.hide()
    navigate('/pricing')
  }

  return (
    <>
      {scenario && (
        <ContextualUpgradeModal
          scenario={scenario}
          onPrimary={handlePrimary}
          onSecondary={handleSecondary}
          onDismiss={handleDismiss}
          onCompare={handleCompare}
        />
      )}
      {showUpgrade && (
        <Suspense fallback={null}>
          <UpgradeModal
            portal="teacher"
            planIds={upgradePlans?.planIds || ['pro_monthly', 'pro_yearly']}
            defaultPlanId={upgradePlans?.defaultPlanId || 'pro_monthly'}
            onClose={() => { setShowUpgrade(false); setUpgradePlans(null) }}
          />
        </Suspense>
      )}
      {topUpState && (
        <Suspense fallback={null}>
          {native ? (
            // The K25 top-up is a Lenco one-off with no Play product (v1) —
            // on Android every topup.show() caller (UsageMeter, the paywall
            // secondary) lands on the Play subscription upgrade instead.
            <UpgradeModal
              portal="teacher"
              planIds={['pro_monthly', 'pro_yearly']}
              defaultPlanId="pro_monthly"
              onClose={() => topup.hide()}
            />
          ) : (
            <TopUpModal
              feature={topUpState.ctx?.feature || null}
              onClose={() => topup.hide()}
            />
          )}
        </Suspense>
      )}
    </>
  )
}
