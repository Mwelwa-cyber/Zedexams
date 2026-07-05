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

const { PLAY_SUBS, obfuscatedAccountIdForUid: clientObfId } =
  await import('../src/utils/playBillingCatalog.js')
const {
  PLAY_PRODUCT_TO_PLAN,
  obfuscatedAccountIdForUid: serverObfId,
} = require('../functions/googlePlayBillingCore.js')

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

// obfuscatedAccountIdForUid must be identical on both sides (issue #1596):
// the client stamps it at purchase time, the server re-derives it to verify.
const OBF_CASES = ['firebaseUid28chars0000000000', '', 'a'.repeat(64), 'a'.repeat(65), 'x']
for (const uid of OBF_CASES) {
  const label = uid.length > 12 ? `${uid.slice(0, 8)}…(${uid.length})` : JSON.stringify(uid)
  ok(`obfuscatedAccountIdForUid(${label}) matches client↔server`,
    clientObfId(uid) === serverObfId(uid))
}

console.log(`\n${passed} passed`)
