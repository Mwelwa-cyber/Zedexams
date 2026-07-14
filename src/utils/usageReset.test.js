/**
 * Unit tests for usageReset.js — plain-node script, run via
 * `npm run test:usage-reset`. Timezone-sensitive checks pass an explicit
 * IANA zone so they are deterministic on any CI machine.
 */

import {
  nextDailyResetMs,
  msUntilDailyReset,
  formatResetIn,
  formatResetClock,
} from './usageReset.js'

let passed = 0
function check(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`)
  passed += 1
  console.log(`  ✓ ${name}`)
}

// 2026-07-13 21:30:00 UTC — reset boundary is 2026-07-14T00:00:00Z.
const NOW = Date.UTC(2026, 6, 13, 21, 30, 0)

check('nextDailyResetMs is the next UTC midnight',
  nextDailyResetMs(NOW) === Date.UTC(2026, 6, 14, 0, 0, 0))
check('exactly at the boundary, the next reset is a full day away',
  nextDailyResetMs(Date.UTC(2026, 6, 14)) === Date.UTC(2026, 6, 15))
check('msUntilDailyReset counts down (2h30m here)',
  msUntilDailyReset(NOW) === 2.5 * 60 * 60 * 1000)
check('msUntilDailyReset never goes negative', msUntilDailyReset(NOW) >= 0)

check('formatResetIn renders hours + minutes', formatResetIn(2.5 * 60 * 60 * 1000) === '2h 30m')
check('formatResetIn renders bare minutes under an hour', formatResetIn(23 * 60 * 1000) === '23m')
check('formatResetIn floors at one minute', formatResetIn(0) === '1m')

// The whole point of the review item: the reset is 00:00 UTC, which is
// 02:00 in Zambia (CAT, UTC+2) — never described as "midnight".
check('reset clock reads 02:00 in Africa/Lusaka', formatResetClock(NOW, 'Africa/Lusaka') === '02:00')
check('reset clock reads 00:00 in UTC', formatResetClock(NOW, 'UTC') === '00:00')
check('device-timezone form returns HH:MM', /^\d{2}:\d{2}$/.test(formatResetClock(NOW)))

console.log(`\nusageReset: ${passed} checks passed`)
