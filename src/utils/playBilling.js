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
import {
  PLAY_SUBS,
  PLAY_PRODUCT_TYPE,
  playProductForPlan,
  planIdForPlayProduct,
  planRenewsOnPlay,
  obfuscatedAccountIdForUid,
} from './playBillingCatalog'
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

  // Play answers for ONE product type per query, so a mixed list (the
  // parent checkout offers subscriptions and passes side by side) needs
  // two. They run SEQUENTIALLY on purpose: the plugin's own docs warn
  // that the native billing client races on concurrent product queries,
  // which surfaces as products missing at random rather than as an error.
  const byProductId = new Map()
  for (const productType of [PURCHASE_TYPE.SUBS, PURCHASE_TYPE.INAPP]) {
    const ids = wanted
      .filter((w) => (w.type === PLAY_PRODUCT_TYPE.INAPP) === (productType === PURCHASE_TYPE.INAPP))
      .map((w) => w.productId)
    if (!ids.length) continue
    let products = []
    try {
      ;({ products } = await NativePurchases.getProducts({
        productIdentifiers: ids,
        productType,
      }))
    } catch (err) {
      // One type failing must not blank the other. The shortfall is
      // reported below either way, so a half-answer still lets a buyer
      // buy what Play DID return rather than seeing an empty panel.
      console.error(`[playBilling] getProducts(${productType}) failed`, err)
      continue
    }
    for (const p of products || []) {
      // Android subs: planIdentifier carries the product id; identifier is
      // the base plan. A one-time product has no base plan, so it comes
      // back on productIdentifier/identifier. Fall back across all three.
      const productId = p.planIdentifier || p.productIdentifier || p.identifier
      if (productId && !byProductId.has(productId)) byProductId.set(productId, p)
    }
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
      // Play's own localized price. NEVER substitute a ZMW literal here —
      // the store is authoritative on what the buyer is charged, and
      // quoting our own figure beside Play's is both a policy problem and
      // a way to promise a price we do not set.
      priceString: p.priceString || '',
      price: p.price ?? null,
      title: p.title || '',
      type: w.type,
      renews: planRenewsOnPlay(w.planId),
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
export async function purchasePlayProduct(planId, uid) {
  const entry = playProductForPlan(planId)
  if (!entry) throw new Error(`No Google Play product mapped for plan "${planId}"`)
  const isOneTime = entry.type === PLAY_PRODUCT_TYPE.INAPP
  const appAccountToken = obfuscatedAccountIdForUid(uid)
  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier: entry.productId,
    // A one-time product has no base plan; sending an empty one is not the
    // same as sending none.
    ...(entry.basePlanId ? { planIdentifier: entry.basePlanId } : {}),
    productType: isOneTime ? PURCHASE_TYPE.INAPP : PURCHASE_TYPE.SUBS,
    // Bind the purchase to this account (empty → omitted, so legacy callers
    // and unusable uids fall back to the server's first-writer guard).
    // On a guardian purchase this is the PARENT's uid — they are the buyer,
    // and the child they are buying for travels separately as a verified
    // beneficiary. Binding the child here would make every guardian
    // purchase look like a cross-account replay to the server.
    ...(appAccountToken ? { appAccountToken } : {}),
    // Never consume a pass. Consuming makes it re-purchasable and discards
    // the record a restore-on-open needs to prove the grant already
    // happened; we acknowledge instead.
    ...(isOneTime ? { isConsumable: false } : {}),
    // Acknowledge server-side after verification (see module header).
    autoAcknowledgePurchases: false,
  })
  const purchaseToken = transaction?.purchaseToken || transaction?.transactionId || ''
  if (!purchaseToken) throw new Error('Purchase completed but no purchase token was returned')
  return {
    // The server needs this to choose its verification endpoint, so fall
    // back to the mapped id rather than sending an empty string.
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
  // No productType filter → Play returns subscriptions AND one-time
  // products. Filtering to subs (as this did before passes existed) would
  // leave an interrupted day/term pass permanently unverified, and an
  // unacknowledged purchase is auto-refunded after three days — so the
  // buyer would lose both the pass and the money with nothing logged.
  const { purchases } = await NativePurchases.getPurchases()
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
 *
 * `beneficiaryUid` names the linked child a guardian is buying for. It is
 * a REQUEST, not a grant: the server re-authorises the pair against its
 * own read of parentLinks before it credits anybody
 * (functions/guardianBillingAuth.js). A restore sends none — it enumerates
 * whatever the Google account owns and has no idea who any of it was for.
 *
 * @returns {Promise<{results: Array, verifiedAt: string}>}
 */
export async function verifyPlayPurchases({ purchases, source, beneficiaryUid, guardianRequestId }) {
  const res = await verifyCallable({
    purchases,
    source,
    ...(beneficiaryUid ? { beneficiaryUid } : {}),
    ...(guardianRequestId ? { guardianRequestId } : {}),
  })
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

export { PLAY_SUBS, planIdForPlayProduct, planRenewsOnPlay }
