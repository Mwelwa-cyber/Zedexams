/**
 * Release-safety: the Google Play product catalog exists in two places —
 * src/utils/playBillingCatalog.js (client, planId → productId/basePlanId)
 * and functions/googlePlayBillingCore.js (server, productId → planId).
 * If they drift, a purchase verifies against the wrong plan (or not at
 * all). This script asserts the two maps are exact inverses, the same
 * keep-in-sync discipline as the plans.js / subscriptionConfig.js mirror.
 *
 * Run: node scripts/test-play-catalog-mirror.mjs
 */

import assert from 'node:assert'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const {
  PLAY_SUBS,
  PLAY_INAPP,
  playProductForPlan,
  planIdForPlayProduct: clientPlanIdFor,
  planRenewsOnPlay,
  obfuscatedAccountIdForUid: clientObfId,
} = await import('../src/utils/playBillingCatalog.js')
const {
  PLAY_PRODUCT_TO_PLAN,
  PLAY_INAPP_PRODUCT_TO_PLAN,
  playProductType,
  planIdForPlayProduct: serverPlanIdFor,
  obfuscatedAccountIdForUid: serverObfId,
} = require('../functions/googlePlayBillingCore.js')
const { PLANS: SERVER_PLANS } = require('../functions/plans.js')

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('play catalog mirror')

const clientPlanIds = Object.keys(PLAY_SUBS)
const serverProductIds = Object.keys(PLAY_PRODUCT_TO_PLAN)

ok('client and server catalogs have the same size',
  clientPlanIds.length === serverProductIds.length)

for (const [planId, entry] of Object.entries(PLAY_SUBS)) {
  ok(`client ${planId} → ${entry.productId} maps back to ${planId} on the server`,
    PLAY_PRODUCT_TO_PLAN[entry.productId] === planId)
  ok(`client ${planId} has a basePlanId`, typeof entry.basePlanId === 'string' && entry.basePlanId.length > 0)
  // Play product-id rules: start with number/lowercase letter; only
  // lowercase letters, numbers, underscores and periods.
  ok(`productId "${entry.productId}" is Play-Console-legal`,
    /^[a-z0-9][a-z0-9._]*$/.test(entry.productId))
}

for (const [productId, planId] of Object.entries(PLAY_PRODUCT_TO_PLAN)) {
  ok(`server ${productId} → ${planId} maps back on the client`,
    PLAY_SUBS[planId] && PLAY_SUBS[planId].productId === productId)
}

// ── The one-time passes ────────────────────────────────────────────────
// Same inverse discipline as the subscriptions above. These exist because
// a guardian can buy a day or term pass on Android, and Play verifies a
// one-time product through a DIFFERENT endpoint — so a drift here does not
// mis-grant, it fails to grant at all and Google refunds it three days
// later, which is the failure nobody is watching for.
const clientInappPlanIds = Object.keys(PLAY_INAPP)
const serverInappProductIds = Object.keys(PLAY_INAPP_PRODUCT_TO_PLAN)

ok('client and server one-time catalogs have the same size',
  clientInappPlanIds.length === serverInappProductIds.length)

for (const [planId, entry] of Object.entries(PLAY_INAPP)) {
  ok(`client one-time ${planId} → ${entry.productId} maps back on the server`,
    PLAY_INAPP_PRODUCT_TO_PLAN[entry.productId] === planId)
  ok(`one-time productId "${entry.productId}" is Play-Console-legal`,
    /^[a-z0-9][a-z0-9._]*$/.test(entry.productId))
  ok(`one-time ${planId} carries no basePlanId (it has no base plan)`,
    entry.basePlanId === undefined)
}

for (const [productId, planId] of Object.entries(PLAY_INAPP_PRODUCT_TO_PLAN)) {
  ok(`server one-time ${productId} → ${planId} maps back on the client`,
    PLAY_INAPP[planId] && PLAY_INAPP[planId].productId === productId)
}

// No product id may appear in BOTH maps: the type decides the endpoint, so
// an id in two types has no single answer to "how is this verified?".
for (const productId of serverInappProductIds) {
  ok(`one-time ${productId} is not also a subscription`,
    PLAY_PRODUCT_TO_PLAN[productId] === undefined)
}

// ── Type resolution agrees across the boundary ─────────────────────────
for (const [planId, entry] of Object.entries({ ...PLAY_SUBS, ...PLAY_INAPP })) {
  const clientEntry = playProductForPlan(planId)
  ok(`playProductForPlan(${planId}) resolves the same type the server reports`,
    clientEntry && clientEntry.type === playProductType(entry.productId))
  ok(`planIdForPlayProduct(${entry.productId}) agrees client↔server`,
    clientPlanIdFor(entry.productId) === serverPlanIdFor(entry.productId))
}

// A pass must never be described as renewing — the manage-in-Play link and
// the renewal-date copy both key off this.
for (const planId of clientInappPlanIds) {
  ok(`${planId} does not renew on Play`, planRenewsOnPlay(planId) === false)
}
for (const planId of Object.keys(PLAY_SUBS)) {
  ok(`${planId} renews on Play`, planRenewsOnPlay(planId) === true)
}

// Every mapped plan must be a plan the SERVER can actually charge for, or
// verification resolves a product to a planId getPlan() returns null for
// and the purchase is refused after the buyer has already paid Google.
for (const planId of [...Object.keys(PLAY_SUBS), ...clientInappPlanIds]) {
  ok(`${planId} exists in functions/plans.js`, Boolean(SERVER_PLANS[planId]))
}

// obfuscatedAccountIdForUid must be identical on both sides (issue #1596):
// the client stamps it at purchase time, the server re-derives it to verify.
const OBF_CASES = ['firebaseUid28chars0000000000', '', 'a'.repeat(64), 'a'.repeat(65), 'x']
for (const uid of OBF_CASES) {
  const label = uid.length > 12 ? `${uid.slice(0, 8)}…(${uid.length})` : JSON.stringify(uid)
  ok(`obfuscatedAccountIdForUid(${label}) matches client↔server`,
    clientObfId(uid) === serverObfId(uid))
}

console.log(`\n${passed} passed`)
