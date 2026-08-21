/**
 * The cross-rail rule: a household must never pay on both rails.
 *
 * Every case below is one a real family can reach, and the two failure
 * directions cost very different things — which is why the rule is not
 * symmetrical in its strictness:
 *
 *  • too LOOSE and a parent pays twice a month forever, because a Play
 *    subscription renews itself and neither rail can see the other;
 *  • too STRICT and a paying family cannot pay us at all, which is why a
 *    cascade grant, an admin comp and an unrecognised provider are all
 *    explicitly NOT rails.
 *
 * Run: node functions/shared/billing/crossRailCore.test.js
 */
import assert from 'node:assert/strict'

import {
  RAIL,
  railOfProvider,
  activeRailFor,
  decideCrossRail,
  crossRailMessage,
} from './crossRailCore.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

const NOW = Date.parse('2026-08-21T09:00:00Z')
const FUTURE = NOW + 20 * 24 * 3600 * 1000
const PAST = NOW - 5 * 24 * 3600 * 1000

const on = (provider, expiry) => ({
  subscriptionProvider: provider,
  subscriptionExpiry: expiry,
  subscriptionPlan: 'monthly',
})

console.log('crossRailCore')

// ── Which providers are rails ───────────────────────────────────────
ok('google_play is the Play rail', railOfProvider('google_play') === RAIL.PLAY)
ok('lenco is the web rail', railOfProvider('lenco') === RAIL.LENCO)
// The shadow of somebody else's payment. Treating it as a rail would stop
// a parent buying for their SECOND child because the first was unlocked.
ok('guardian_cascade is not a rail', railOfProvider('guardian_cascade') === null)
ok('an admin grant is not a rail', railOfProvider('admin') === null)
ok('an unknown provider is not a rail (fail open)', railOfProvider('mystery') === null)
ok('a missing provider is not a rail', railOfProvider(undefined) === null)

// ── What counts as live ─────────────────────────────────────────────
ok('a future expiry on a rail is live',
  activeRailFor(on('lenco', FUTURE), NOW)?.rail === RAIL.LENCO)
ok('a past expiry is not live', activeRailFor(on('lenco', PAST), NOW) === null)
ok('no expiry at all is not live',
  activeRailFor({subscriptionProvider: 'lenco'}, NOW) === null)
ok('an ISO-string expiry is read',
  activeRailFor(on('google_play', new Date(FUTURE).toISOString()), NOW)?.rail === RAIL.PLAY)
ok('a Firestore Timestamp expiry is read',
  activeRailFor(on('google_play', {toMillis: () => FUTURE}), NOW)?.rail === RAIL.PLAY)
ok('a null user is not live', activeRailFor(null, NOW) === null)

// ── The decision ────────────────────────────────────────────────────
const payerOn = (provider, expiry) => [{who: 'payer', user: on(provider, expiry)}]

ok('nothing active → allowed',
  decideCrossRail({rail: RAIL.PLAY, accounts: [{who: 'payer', user: {}}], nowMs: NOW}).allowed)

ok('Play buyer, live on Lenco → refused',
  decideCrossRail({rail: RAIL.PLAY, accounts: payerOn('lenco', FUTURE), nowMs: NOW})
    .allowed === false)
ok('Lenco buyer, live on Play → refused',
  decideCrossRail({rail: RAIL.LENCO, accounts: payerOn('google_play', FUTURE), nowMs: NOW})
    .allowed === false)

// Renewing where you already are is the ordinary case and must never be
// caught by a rule about paying in two places.
ok('renewing on the SAME rail → allowed (Play)',
  decideCrossRail({rail: RAIL.PLAY, accounts: payerOn('google_play', FUTURE), nowMs: NOW}).allowed)
ok('renewing on the SAME rail → allowed (Lenco)',
  decideCrossRail({rail: RAIL.LENCO, accounts: payerOn('lenco', FUTURE), nowMs: NOW}).allowed)

ok('a LAPSED plan on the other rail → allowed',
  decideCrossRail({rail: RAIL.PLAY, accounts: payerOn('lenco', PAST), nowMs: NOW}).allowed)

// A guardian purchase credits the CHILD, so the parent's own document is
// where their web subscription lives — both have to be looked at.
ok('a live plan on the CHILD blocks the other rail',
  decideCrossRail({
    rail: RAIL.PLAY,
    accounts: [{who: 'payer', user: {}}, {who: 'child', user: on('lenco', FUTURE)}],
    nowMs: NOW,
  }).who === 'child')
ok('a live plan on the PAYER blocks the other rail',
  decideCrossRail({
    rail: RAIL.LENCO,
    accounts: [{who: 'payer', user: on('google_play', FUTURE)}, {who: 'child', user: {}}],
    nowMs: NOW,
  }).who === 'payer')

// The one that would break the product if it were wrong: a parent who has
// paid on Play for child A must still be able to unlock child B, and
// child B holds a cascaded grant.
ok('a cascaded child never blocks a purchase',
  decideCrossRail({
    rail: RAIL.LENCO,
    accounts: [{who: 'child', user: on('guardian_cascade', FUTURE)}],
    nowMs: NOW,
  }).allowed)

ok('an empty account list → allowed',
  decideCrossRail({rail: RAIL.PLAY, accounts: [], nowMs: NOW}).allowed)
ok('a null entry in the list is skipped, not a crash',
  decideCrossRail({rail: RAIL.PLAY, accounts: [null], nowMs: NOW}).allowed)

// ── The words a parent reads ────────────────────────────────────────
const playVerdict = decideCrossRail({
  rail: RAIL.LENCO, accounts: payerOn('google_play', FUTURE), nowMs: NOW,
})
const lencoVerdict = decideCrossRail({
  rail: RAIL.PLAY, accounts: payerOn('lenco', FUTURE), nowMs: NOW,
})
ok('being live on Play sends you to Google Play to manage it',
  /Google Play/.test(crossRailMessage(playVerdict)))
ok('being live on Play warns about the double charge',
  /charged twice/i.test(crossRailMessage(playVerdict)))
ok('being live on the web says there is nothing to buy yet',
  /nothing to buy/i.test(crossRailMessage(lencoVerdict)))
ok('an allowed verdict has no message', crossRailMessage({allowed: true}) === '')

console.log(`\n${passed} passed`)
