/**
 * Release-safety: a Google Play subscription that was never activated in the
 * Play Console is dropped by fetchPlayProducts and the upgrade panel renders
 * a shorter plan list with no error. This asserts the drop is DETECTED and
 * described — the diagnosis is what turns a silent revenue loss into
 * something an operator can see.
 *
 * Run: node scripts/test-play-catalog-health.mjs
 */

import assert from 'node:assert'

const {
  diffPlayCatalog,
  describePlayCatalogShortfall,
  playCatalogShortfallProperties,
} = await import('../src/utils/playCatalogHealth.js')
const { PLAY_SUBS, playProductForPlan } = await import('../src/utils/playBillingCatalog.js')

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('play catalog health')

// The exact shape fetchPlayProducts builds, so the test can't pass against a
// structure the real caller never produces.
const entriesFor = (planIds) =>
  planIds.map((planId) => ({ planId, ...(playProductForPlan(planId) || {}) }))

const ALL_PLAN_IDS = Object.keys(PLAY_SUBS)
const TEACHER_PLANS = ['pro_monthly', 'pro_yearly', 'max_monthly', 'max_yearly']

// ── Everything present ──────────────────────────────────────────────────────
{
  const wanted = entriesFor(ALL_PLAN_IDS)
  const diff = diffPlayCatalog(wanted, wanted.map((w) => w.productId))
  ok('a fully-served request is complete', diff.complete === true)
  ok('a fully-served request reports nothing missing', diff.missing.length === 0)
  ok('a fully-served request is not empty', diff.empty === false)
  ok('describe() says nothing when nothing is missing',
    describePlayCatalogShortfall(diff) === '')
}

// ── The real-world case: teacher products not activated ─────────────────────
{
  const wanted = entriesFor(ALL_PLAN_IDS)
  // Only the two learner products come back — the state the July telemetry is
  // consistent with (learner_premium_monthly is the only plan ever purchased).
  const diff = diffPlayCatalog(wanted, ['learner_premium_weekly', 'learner_premium_monthly'])

  ok('a partial catalogue is NOT complete', diff.complete === false)
  ok('a partial catalogue is not flagged empty', diff.empty === false)
  ok('every unreturned plan is listed as missing',
    diff.missing.map((m) => m.planId).sort().join(',') === TEACHER_PLANS.slice().sort().join(','))
  ok('returnedCount counts only what Play actually served', diff.returnedCount === 2)
  ok('requestedCount is the full ask', diff.requestedCount === 6)

  const msg = describePlayCatalogShortfall(diff)
  ok('the message names the missing PLAN id', msg.includes('pro_monthly'))
  // The operator fixes this in the Play Console, which lists PRODUCT ids —
  // a message with only our internal plan id would send them hunting.
  ok('the message names the missing PRODUCT id', msg.includes('teacher_pro_monthly'))
  ok('the message points at the Play Console', msg.includes('Play Console'))
  ok('the message quantifies the shortfall', msg.includes('2 of 6'))

  const props = playCatalogShortfallProperties(diff)
  ok('analytics carries the missing plan ids', props.missingPlanIds.includes('max_yearly'))
  ok('analytics carries the missing count', props.missingCount === 4)
  ok('analytics carries the requested count', props.requestedCount === 6)
  // Anything user-identifying here would ship PII to PostHog on every load.
  ok('analytics payload is ids and counts only',
    Object.keys(props).sort().join(',') ===
      'empty,missingCount,missingPlanIds,missingProductIds,requestedCount,returnedCount')
}

// ── Nothing came back at all ────────────────────────────────────────────────
{
  const wanted = entriesFor(['pro_monthly', 'pro_yearly'])
  const diff = diffPlayCatalog(wanted, [])
  ok('an empty response is flagged empty', diff.empty === true)
  ok('an empty response is not complete', diff.complete === false)
  ok('an empty response reports every plan missing', diff.missing.length === 2)
  ok('the empty message reads differently from a partial one',
    describePlayCatalogShortfall(diff).includes('returned NO products'))
}

// ── Degenerate inputs must not throw or invent a shortfall ──────────────────
{
  const empty = diffPlayCatalog([], [])
  ok('an empty request is vacuously complete', empty.complete === true)
  // An empty request is NOT "empty" — there was no shortfall to report, and
  // firing an alarm here would cry wolf on every non-native caller.
  ok('an empty request is not flagged empty', empty.empty === false)

  ok('null inputs do not throw', diffPlayCatalog(null, null).complete === true)
  ok('undefined inputs do not throw', diffPlayCatalog(undefined, undefined).complete === true)

  // A catalogue entry with no productId can't be looked up in Play at all, so
  // counting it as "missing" would report a permanent phantom shortfall.
  const junk = diffPlayCatalog(
    [{ planId: 'ghost' }, { planId: 'pro_monthly', productId: 'teacher_pro_monthly' }],
    ['teacher_pro_monthly']
  )
  ok('an entry with no productId is excluded, not reported missing', junk.complete === true)
  ok('an entry with no productId is excluded from the request count', junk.requestedCount === 1)

  // Play returning something we never asked for is not our problem.
  const extra = diffPlayCatalog(entriesFor(['monthly']), ['learner_premium_monthly', 'surprise_product'])
  ok('an unrequested product from Play does not create a shortfall', extra.complete === true)
  ok('an unrequested product does not inflate returnedCount', extra.returnedCount === 1)

  // getProducts() can yield duplicates across base plans of one product.
  const dupes = diffPlayCatalog(entriesFor(['monthly']), ['learner_premium_monthly', 'learner_premium_monthly'])
  ok('duplicate product ids are counted once', dupes.returnedCount === 1)
}

console.log(`\nplay catalog health — ${passed} checks passed`)
