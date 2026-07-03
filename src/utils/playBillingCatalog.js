/**
 * src/utils/playBillingCatalog.js
 *
 * Google Play Billing product catalog — the client half of the plan↔product
 * mapping. Pure data (no Capacitor imports) so node test scripts can import it.
 *
 * KEEP IN SYNC with functions/googlePlayBillingCore.js (PLAY_PRODUCT_TO_PLAN —
 * the exact inverse of PLAY_SUBS) and with the subscription products configured
 * in the Google Play Console (Monetise ▸ Subscriptions). The mirror is
 * enforced by scripts/test-play-catalog-mirror.mjs (npm run test:play-catalog-mirror).
 *
 * v1 scope: subscriptions only. Plans with no Play product (grade packs,
 * single-subject, the K25 top-up) have no entry here — on Android those CTAs
 * fall back to the mapped plans via resolveNativePlanIds().
 */

export const PLAY_PACKAGE = 'com.zedexams.android'

// planId (functions/plans.js) → Google Play subscription product + base plan.
export const PLAY_SUBS = {
  weekly:      { productId: 'learner_premium_weekly',  basePlanId: 'weekly'  },
  monthly:     { productId: 'learner_premium_monthly', basePlanId: 'monthly' },
  pro_monthly: { productId: 'teacher_pro_monthly',     basePlanId: 'monthly' },
  pro_yearly:  { productId: 'teacher_pro_yearly',      basePlanId: 'yearly'  },
  max_monthly: { productId: 'teacher_max_monthly',     basePlanId: 'monthly' },
  max_yearly:  { productId: 'teacher_max_yearly',      basePlanId: 'yearly'  },
}

export function playProductForPlan(planId) {
  return PLAY_SUBS[planId] || null
}

export function planIdForPlayProduct(productId) {
  for (const [planId, entry] of Object.entries(PLAY_SUBS)) {
    if (entry.productId === productId) return planId
  }
  return null
}

/**
 * Reduce a Lenco-era planIds list to the plans purchasable through Google
 * Play. When nothing survives (grade packs, top-up routing), fall back to the
 * portal's core subscription pair so the buyer always sees something to buy.
 */
export function resolveNativePlanIds(planIds, portal) {
  const mapped = (planIds || []).filter((id) => PLAY_SUBS[id])
  if (mapped.length) return mapped
  return portal === 'teacher' || portal === 'maxUpgrade'
    ? ['pro_monthly', 'pro_yearly']
    : ['weekly', 'monthly']
}
