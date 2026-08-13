#!/usr/bin/env node
/**
 * App Check readiness — the parts of the reader nothing covered.
 *
 * `appCheckHealthCore.spec.js` (Vitest, moved here with the module) already
 * covers `classifyDeviceAttestation` branch by branch, `mergeDayCounters`
 * across legacy + shard docs, and `summarise`'s sampling exposure. This file
 * deliberately does NOT restate those. It covers what neither suite did:
 *
 *   - `enforcementReadiness`, which had **no test at all** and is the highest-
 *     stakes function in the module;
 *   - `healthWindowDates` / `isoDate`, extracted here during the migration;
 *   - `discoverLabels`, and the two `summarise` properties the spec's sampling
 *     cases do not touch.
 *
 * Why readiness is the one to pin: this page answers a single question — is
 * `APPCHECK_ENFORCE=1` safe to flip — and enforcement hard-denies every call
 * without a valid token. A verdict wrong in the optimistic direction takes the
 * API down for real users, so each case below is a way that could happen
 * quietly.
 *
 * (`functions/appCheckHealthCore.js` is the WRITER, with its own suite under
 * `test:appcheck-health`. Same subject, different module.)
 */

import assert from 'node:assert'
import {
  discoverLabels,
  enforcementReadiness,
  healthWindowDates,
  isoDate,
  mergeDayCounters,
  summarise,
} from './appCheckHealthCore.js'

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

// --- the window ------------------------------------------------------------

ok('the window ends today and runs oldest first', () => {
  const now = Date.parse('2026-08-13T09:00:00Z')
  assert.deepStrictEqual(
    healthWindowDates({ days: 3, now }),
    ['2026-08-11', '2026-08-12', '2026-08-13'],
  )
  assert.strictEqual(healthWindowDates({ days: 14, now }).length, 14)
  assert.strictEqual(isoDate(new Date(now)), '2026-08-13')
})

// --- labels ----------------------------------------------------------------

ok('a newly-gated endpoint appears without a dashboard change', () => {
  assert.deepStrictEqual(
    discoverLabels([{ b_attempts: 1 }, { a_attempts: 1, a_valid: 1 }, { a_missing: 2 }]),
    ['a', 'b'],
    'labels are inferred from _attempts keys, and sorted',
  )
})

ok('a non-numeric field never becomes a counter', () => {
  // The spec covers a null shard read; this covers a shard that IS there and
  // holds junk — a string total would poison every sum downstream of it.
  assert.deepStrictEqual(
    mergeDayCounters('2026-08-13', [
      { date: '2026-08-13', updatedAt: 'a timestamp', x_attempts: 3 },
      { x_attempts: 'twelve', x_valid: Number.NaN, x_missing: Infinity },
    ]),
    { date: '2026-08-13', x_attempts: 3 },
  )
})

// --- summarise: the two properties the sampling cases do not reach ---------

ok('no traffic reports no percentage, not 0%', () => {
  const { rows, overall } = summarise([{ idle_attempts: 0, idle_valid: 0 }])
  assert.strictEqual(rows[0].validPct, null, '0% would read as "everything is failing"')
  assert.strictEqual(overall.validPct, null)
})

ok('unattested is missing plus invalid, at both levels', () => {
  const { rows, overall } = summarise([
    { a_attempts: 10, a_valid: 7, a_missing: 2, a_invalid: 1 },
    { b_attempts: 10, b_valid: 10 },
  ])
  const a = rows.find(r => r.label === 'a')
  assert.strictEqual(a.unattested, 3)
  assert.strictEqual(a.validPct, 70)
  assert.strictEqual(overall.attempts, 20)
  assert.strictEqual(overall.unattested, 3)
})

// --- the verdict that can take the API down --------------------------------

ok('a thin sample is never called ready', () => {
  const verdict = enforcementReadiness(summarise([{ a_attempts: 10, a_valid: 10 }]))
  assert.strictEqual(verdict.ready, false)
  assert.strictEqual(verdict.tone, 'wait')
  assert.match(verdict.reason, /Only 10 calls/)
})

ok('a clean window at volume is ready', () => {
  const verdict = enforcementReadiness(summarise([{ a_attempts: 500, a_valid: 500 }]))
  assert.strictEqual(verdict.ready, true)
  assert.strictEqual(verdict.tone, 'ready')
})

ok('ONE endpoint still unattested blocks the whole flip', () => {
  // The failure this page exists to prevent: 99.8% valid overall looks ready,
  // and the 0.2% is every call from one endpoint that enforcement would deny.
  const verdict = enforcementReadiness(summarise([
    { good_attempts: 5000, good_valid: 5000 },
    { legacy_attempts: 10, legacy_missing: 10 },
  ]))
  assert.strictEqual(verdict.ready, false)
  assert.strictEqual(verdict.tone, 'block')
  assert.match(verdict.reason, /legacy/, 'the reason has to name the endpoint to act on')
})

ok('the worst offender is the one named', () => {
  const verdict = enforcementReadiness(summarise([
    { a_attempts: 300, a_valid: 299, a_missing: 1 },
    { b_attempts: 300, b_valid: 250, b_missing: 50 },
  ]))
  assert.match(verdict.reason, /"b"/)
  assert.match(verdict.reason, /2 endpoint/)
})

ok('the traffic floor is a parameter, not a constant', () => {
  const thin = summarise([{ a_attempts: 50, a_valid: 50 }])
  assert.strictEqual(enforcementReadiness(thin).ready, false)
  assert.strictEqual(enforcementReadiness(thin, { minAttempts: 10 }).ready, true)
})

console.log(`\n${passed} App Check readiness checks passed.`)
