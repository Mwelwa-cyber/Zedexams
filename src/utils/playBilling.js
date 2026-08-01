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
import { PLAY_SUBS, playProductForPlan, planIdForPlayProduct, obfuscatedAccountIdForUid } from './playBillingCatalog'
import {
  diffPlayCatalog,
  describePlayCatalogShortfall,
  playCatalogShortfallProperties,
} from './playCatalogHealth'
import { capture } from './analytics'

const fns = getFunctions(app, 'us-central1')
const verifyCallable = httpsCallable(fns, 'verifyGooglePlayPurchase')

/**
 * Announce a catalogue shortfall on every channel we have. `console.error`
 * (not `warn`) because this is a revenue-losing misconfiguration, not a
 * curiosity — it reaches `adb logcat` during a device test. The analytics
 * event is what makes it visible AFTER release, alongside play_verify_failed.
 * Never throws: a broken reporter must not take down the upgrade panel.
 */
function reportPlayCatalogShortfall(diff) {
  const message = describePlayCatalogShortfall(diff)
  try {
    console.error(`[playBilling] ${message}`)
  } catch { /* console unavailable — telemetry below still runs */ }
  try {
    capture('play_products_missing', playCatalogShortfallProperties(diff))
  } catch { /* capture() already swallows its own errors; belt and braces */ }
}

/**
 * Fetch Play products for a list of plan ids. Products not returned by
 * Play (not yet created/activated in the Console) are omitted rather than
 * failing the whole panel — a partial catalogue still lets someone buy.
 *
 * A drop is NOT silent: the shortfall is reported to the console AND to
 * analytics (`play_products_missing`) from inside this function, so it can't
 * be lost by a caller that forgets to check. That matters because the panel
 * only shows the buyer an error when NOTHING comes back; a partial catalogue
 * renders as a normal, shorter plan list. See playCatalogHealth.js.
 *
 * @returns {Promise<Array<{planId, productId, priceString, price, title}>>}
 */
export async function fetchPlayProducts(planIds) {
  const wanted = (planIds || [])
    .map((planId) => ({ planId, ...(playProductForPlan(planId) || {}) }))
    .filter((w) => w.productId)
  if (!wanted.length) return []

  const billing = await NativePurchases.isBillingSupported()
  if (!billing?.isBillingSupported) {
    throw new Error('Google Play billing is not available on this device')
  }

  const { products } = await NativePurchases.getProducts({
    productIdentifiers: wanted.map((w) => w.productId),
    productType: PURCHASE_TYPE.SUBS,
  })

  const byProductId = new Map()
  for (const p of products || []) {
    // Android subs: planIdentifier carries the product id; identifier is
    // the base plan. Fall back to identifier for other platforms.
    const productId = p.planIdentifier || p.productIdentifier || p.identifier
    if (productId && !byProductId.has(productId)) byProductId.set(productId, p)
  }

  // Report the shortfall BEFORE building the result, so a throw while mapping
  // products can't swallow the diagnosis.
  const diff = diffPlayCatalog(wanted, byProductId.keys())
  if (!diff.complete) reportPlayCatalogShortfall(diff)

  const out = []
  for (const w of wanted) {
    const p = byProductId.get(w.productId)
    if (!p) continue
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
 *
 * `uid` (the signed-in ZedExams uid) is stamped as the obfuscated account id
 * so Google records the purchase against this account — the server later
 * re-derives and verifies it (issue #1596). On @capgo/native-purchases,
 * `appAccountToken` maps to Play's ObfuscatedAccountId on Android.
 */
export async function purchasePlaySubscription(planId, uid) {
  const entry = playProductForPlan(planId)
  if (!entry) throw new Error(`No Google Play product mapped for plan "${planId}"`)
  const appAccountToken = obfuscatedAccountIdForUid(uid)
  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier: entry.productId,
    planIdentifier: entry.basePlanId,
    productType: PURCHASE_TYPE.SUBS,
    // Bind the purchase to this account (empty → omitted, so legacy callers
    // and unusable uids fall back to the server's first-writer guard).
    ...(appAccountToken ? { appAccountToken } : {}),
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
  if (/BILLING_UNAVAILABLE|FEATURE_NOT_SUPPORTED|Billing setup|BILLING_INTERRUPTED|billing is not available|billing unavailable|service unavailable|play store/i.test(msg)) {
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
