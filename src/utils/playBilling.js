/**
 * src/utils/playBilling.js
 *
 * Google Play Billing wrapper — the ONLY file that imports
 * @capgo/native-purchases, so every plugin-shape assumption is quarantined
 * here. Android-only surface: callers must gate on isNativePlatform()
 * (PlayUpgradePanel / NativePlayBillingSync already do).
 *
 * Plugin facts pinned against the installed 8.6.2 .d.ts + Android source:
 *  - purchaseProduct() resolves with { purchaseToken, orderId,
 *    productIdentifier, isAcknowledged, purchaseState } on Android; the
 *    purchase token (NOT transactionId, which mirrors it) is what the
 *    backend verifies.
 *  - getProducts() returns Android subscription Products with
 *    `identifier` = BASE PLAN id and `planIdentifier` = the subscription
 *    product id (inverted from what you'd guess — documented in the .d.ts).
 *  - getPurchases({productType:'subs'}) enumerates owned purchases (the
 *    restore path); restorePurchases() is an iOS sync concept.
 *  - Rejections use generic messages: "Purchase is not purchased" covers
 *    user-cancel AND already-owned AND other failures; "Purchase is
 *    pending" covers slow payment methods. We classify accordingly and
 *    never guess cancelled-vs-owned.
 *  - autoAcknowledgePurchases:false → the backend acknowledges after
 *    verifying (unverified purchases auto-refund after 3 days, the right
 *    failure mode for money we never confirmed).
 */

import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'
import { PLAY_SUBS, playProductForPlan, planIdForPlayProduct } from './playBillingCatalog'

const fns = getFunctions(app, 'us-central1')
const verifyCallable = httpsCallable(fns, 'verifyGooglePlayPurchase')

/**
 * Fetch Play products for a list of plan ids. Products not returned by
 * Play (not yet created/activated in the Console) are omitted with a
 * warning rather than failing the whole panel.
 * @returns {Promise<Array<{planId, productId, priceString, price, title}>>}
 */
export async function fetchPlayProducts(planIds) {
  const wanted = (planIds || [])
    .map((planId) => ({ planId, ...(playProductForPlan(planId) || {}) }))
    .filter((w) => w.productId)
  if (!wanted.length) return []

  const { products } = await NativePurchases.getProducts({
    productIdentifiers: wanted.map((w) => w.productId),
    productType: PURCHASE_TYPE.SUBS,
  })

  const byProductId = new Map()
  for (const p of products || []) {
    // Android subs: planIdentifier carries the product id; identifier is
    // the base plan. Fall back to identifier for other platforms.
    const productId = p.planIdentifier || p.identifier
    if (productId && !byProductId.has(productId)) byProductId.set(productId, p)
  }

  const out = []
  for (const w of wanted) {
    const p = byProductId.get(w.productId)
    if (!p) {
      console.warn(`[playBilling] Play did not return product "${w.productId}" — is it active in the Play Console?`)
      continue
    }
    out.push({
      planId: w.planId,
      productId: w.productId,
      priceString: p.priceString || '',
      price: p.price ?? null,
      title: p.title || '',
    })
  }
  return out
}

/**
 * Launch the Play purchase sheet for a plan. Resolves with the purchase
 * token the backend needs. Rejects on cancel/failure — classify with
 * classifyPurchaseError().
 */
export async function purchasePlaySubscription(planId) {
  const entry = playProductForPlan(planId)
  if (!entry) throw new Error(`No Google Play product mapped for plan "${planId}"`)
  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier: entry.productId,
    planIdentifier: entry.basePlanId,
    productType: PURCHASE_TYPE.SUBS,
    // Acknowledge server-side after verification (see module header).
    autoAcknowledgePurchases: false,
  })
  const purchaseToken = transaction?.purchaseToken || transaction?.transactionId || ''
  if (!purchaseToken) throw new Error('Purchase completed but no purchase token was returned')
  return {
    productId: transaction?.productIdentifier || entry.productId,
    purchaseToken,
  }
}

/**
 * Bucket a purchaseProduct() rejection. The plugin's Android layer rejects
 * with the same message for user-cancel, already-owned, and most launch
 * failures, so 'not-completed' is intentionally broad — the UI pairs it
 * with a "Restore purchases" action to cover the already-owned case.
 */
export function classifyPurchaseError(err) {
  const msg = String(err?.message || err || '')
  if (/pending/i.test(msg)) return 'pending'
  if (/not purchased/i.test(msg)) return 'not-completed'
  if (/BILLING_UNAVAILABLE|FEATURE_NOT_SUPPORTED|Billing setup|BILLING_INTERRUPTED/i.test(msg)) {
    return 'unavailable'
  }
  return 'unknown'
}

/**
 * Enumerate the Google account's owned subscription purchases (restore
 * path). Deduped by purchase token.
 * @returns {Promise<Array<{productId, purchaseToken}>>}
 */
export async function restorePlayPurchases() {
  const { purchases } = await NativePurchases.getPurchases({
    productType: PURCHASE_TYPE.SUBS,
  })
  const seen = new Set()
  const out = []
  for (const t of purchases || []) {
    const purchaseToken = t?.purchaseToken || t?.transactionId || ''
    if (!purchaseToken || seen.has(purchaseToken)) continue
    seen.add(purchaseToken)
    out.push({ productId: t?.productIdentifier || '', purchaseToken })
  }
  return out
}

/**
 * Send purchase token(s) to the backend for verification + grant.
 * @returns {Promise<{results: Array, verifiedAt: string}>}
 */
export async function verifyPlayPurchases({ purchases, source }) {
  const res = await verifyCallable({ purchases, source })
  return res.data
}

/**
 * Open Google Play's subscription management screen. Prefers the plugin's
 * native intent; falls back to the public deep link.
 */
export async function openPlaySubscriptionManagement(productId) {
  try {
    await NativePurchases.manageSubscriptions()
    return
  } catch {
    // Fall through to the URL — Capacitor externalizes non-origin URLs,
    // which lands in the Play app when it's installed.
  }
  const base = 'https://play.google.com/store/account/subscriptions'
  const url = productId
    ? `${base}?sku=${encodeURIComponent(productId)}&package=com.zedexams.android`
    : base
  window.open(url, '_blank')
}

export { PLAY_SUBS, planIdForPlayProduct }
