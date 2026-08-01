/**
 * src/utils/playCatalogHealth.js
 *
 * Decides whether Google Play returned every subscription product the app
 * asked it for, and turns a shortfall into one loud, reportable diagnosis.
 *
 * Why this exists: `fetchPlayProducts` deliberately drops a product Play
 * doesn't return rather than failing the whole panel — a partial catalogue is
 * better than an empty one. But the drop was `console.warn` only, and the
 * upgrade panel renders whatever survives, so a subscription that was never
 * activated in the Play Console reaches the buyer as a SHORT PLAN LIST with
 * no error anywhere: not on screen, not in telemetry. Every teacher plan can
 * be missing and the panel still looks like it worked. As of 2026-08-01 only
 * `learner_premium_monthly` has ever completed a purchase, which is exactly
 * the state this failure mode would produce and hide.
 *
 * Pure + dependency-free (the `*Core.js` convention) so it tests under plain
 * `node` with no Capacitor plugin, no Firebase, and no DOM.
 * Tested by scripts/test-play-catalog-health.mjs (npm run test:play-catalog-health).
 */

/**
 * Compare what we asked Play for against what it returned.
 *
 * @param {Array<{planId: string, productId: string}>} wanted
 *   The resolved catalogue entries the caller requested.
 * @param {Iterable<string>} returnedProductIds
 *   Product ids Play actually returned (already normalised by the caller —
 *   Android subs report the product id on `planIdentifier`, not `identifier`).
 * @returns {{
 *   requested: Array<{planId: string, productId: string}>,
 *   missing: Array<{planId: string, productId: string}>,
 *   requestedCount: number,
 *   returnedCount: number,
 *   complete: boolean,
 *   empty: boolean,
 * }}
 */
export function diffPlayCatalog(wanted, returnedProductIds) {
  const requested = (Array.isArray(wanted) ? wanted : []).filter(
    (w) => w && typeof w.productId === 'string' && w.productId
  )
  const returned = new Set()
  for (const id of returnedProductIds || []) {
    if (typeof id === 'string' && id) returned.add(id)
  }

  const missing = requested.filter((w) => !returned.has(w.productId))
  const returnedCount = requested.length - missing.length

  return {
    requested,
    missing,
    requestedCount: requested.length,
    returnedCount,
    // `complete` is about the REQUEST being fully served, so an empty request
    // is vacuously complete — there is nothing to have gone missing.
    complete: missing.length === 0,
    // `empty` is the distinct, worse case: we asked for products and got none
    // back. The panel already surfaces this one to the buyer; it is called out
    // separately here so telemetry can tell "catalogue misconfigured" apart
    // from "billing unavailable on this device".
    empty: requested.length > 0 && returnedCount === 0,
  }
}

/**
 * The operator-facing sentence for a shortfall. Names the plan AND the Play
 * product id, because the fix is in the Play Console and the Console is
 * organised by product id, not by our plan id.
 *
 * @param {ReturnType<typeof diffPlayCatalog>} diff
 * @returns {string} '' when nothing is missing.
 */
export function describePlayCatalogShortfall(diff) {
  const missing = diff?.missing || []
  if (!missing.length) return ''
  const pairs = missing.map((m) => `${m.planId} (${m.productId})`).join(', ')
  const scope = diff.empty
    ? 'Google Play returned NO products'
    : `Google Play returned ${diff.returnedCount} of ${diff.requestedCount} products`
  return (
    `${scope} — missing: ${pairs}. ` +
    'These plans are silently absent from the upgrade panel. Check each one is ' +
    'created AND activated in Play Console ▸ Monetise ▸ Subscriptions, with the ' +
    'product id and base plan id matching src/utils/playBillingCatalog.js exactly.'
  )
}

/**
 * The analytics payload for a shortfall. Plan/product ids only — no uid, no
 * price, nothing user-identifying.
 *
 * @param {ReturnType<typeof diffPlayCatalog>} diff
 */
export function playCatalogShortfallProperties(diff) {
  return {
    missingPlanIds: (diff?.missing || []).map((m) => m.planId).join(','),
    missingProductIds: (diff?.missing || []).map((m) => m.productId).join(','),
    missingCount: (diff?.missing || []).length,
    requestedCount: diff?.requestedCount ?? 0,
    returnedCount: diff?.returnedCount ?? 0,
    empty: !!diff?.empty,
  }
}
