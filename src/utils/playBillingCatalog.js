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
 * Two maps, because Play models them as two product TYPES and verifies them
 * through two different Developer API endpoints: PLAY_SUBS are auto-renewing
 * subscriptions (purchases.subscriptionsv2) and PLAY_INAPP are one-off passes
 * (purchases.products). A pass is not a subscription that happens to be
 * short — it never renews, Play offers no manage screen for it, and the
 * buyer is told so. Keeping them apart here is what stops a day pass being
 * presented with a renewal date it will never have.
 *
 * Plans with no Play product at all (grade packs, single-subject, the K25
 * top-up) have no entry in either — on Android those CTAs fall back to the
 * mapped plans via resolveNativePlanIds().
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

// planId (functions/plans.js) → Google Play ONE-TIME (in-app) product.
//
// The two learner passes a guardian can buy outright. They carry no
// basePlanId because a one-time product has no base plan, and no renewal
// because there is nothing to renew — `openPlaySubscriptionManagement` must
// never be offered for one.
export const PLAY_INAPP = {
  day_pass:  { productId: 'learner_premium_day_pass'  },
  term_pass: { productId: 'learner_premium_term_pass' },
}

/** Every Play product this build knows, subscriptions and passes alike. */
export const PLAY_PRODUCT_TYPE = { SUBS: 'subs', INAPP: 'inapp' }

// Google Play's ObfuscatedAccountId / Apple's appAccountToken cap: 64 chars.
export const OBFUSCATED_ACCOUNT_ID_MAX = 64

/**
 * The obfuscated account id to bind a purchase to for a ZedExams uid
 * (issue #1596). A Firebase uid is already an opaque, non-PII token, so it's
 * bound verbatim; the server re-derives the same value to verify the purchase
 * belongs to the signed-in account. Returns '' (→ binding skipped) for an
 * unusable uid or one over Play's 64-char cap (Firebase Auth uids are 28
 * chars, so the cap only guards custom-token uids).
 *
 * KEEP IN SYNC with functions/googlePlayBillingCore.js's obfuscatedAccountIdForUid
 * (asserted by scripts/test-play-catalog-mirror.mjs).
 */
export function obfuscatedAccountIdForUid(uid) {
  const s = typeof uid === 'string' ? uid : ''
  if (!s || s.length > OBFUSCATED_ACCOUNT_ID_MAX) return ''
  return s
}

/**
 * The Play product for a plan, with the TYPE that decides which purchase
 * flow and which verification endpoint it takes. Returns null for a plan
 * Play cannot sell.
 *
 * Callers must branch on `type` rather than assuming subs: launching a
 * one-time product through the subscription flow fails at the Play sheet,
 * and verifying one against subscriptionsv2 returns 404 — which the server
 * reads as "token doesn't exist", i.e. a silently unfulfilled purchase that
 * Google auto-refunds three days later.
 */
export function playProductForPlan(planId) {
  const sub = PLAY_SUBS[planId]
  if (sub) return { ...sub, type: PLAY_PRODUCT_TYPE.SUBS }
  const inapp = PLAY_INAPP[planId]
  if (inapp) return { ...inapp, basePlanId: null, type: PLAY_PRODUCT_TYPE.INAPP }
  return null
}

export function planIdForPlayProduct(productId) {
  for (const [planId, entry] of Object.entries(PLAY_SUBS)) {
    if (entry.productId === productId) return planId
  }
  for (const [planId, entry] of Object.entries(PLAY_INAPP)) {
    if (entry.productId === productId) return planId
  }
  return null
}

/** Whether a plan renews itself on Play. Drives the copy AND the manage link. */
export function planRenewsOnPlay(planId) {
  return Boolean(PLAY_SUBS[planId])
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
