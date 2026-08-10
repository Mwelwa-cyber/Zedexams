/* Plain-node tests for dashboardV2Core (npm run test:dashboard-v2). */
import assert from 'node:assert/strict'
import {
  greetingPartForHour,
  greetingLabel,
  resolveGreeting,
  progressFraction,
} from './dashboardV2Core.js'

// Spec boundaries: <12 morning, 12–17 afternoon, ≥18 evening.
assert.equal(greetingPartForHour(0), 'morning')
assert.equal(greetingPartForHour(11), 'morning')
assert.equal(greetingPartForHour(12), 'afternoon')
assert.equal(greetingPartForHour(17), 'afternoon')
assert.equal(greetingPartForHour(18), 'evening')
assert.equal(greetingPartForHour(23), 'evening')

// Out-of-range / garbage input falls back safely.
assert.equal(greetingPartForHour(-1), 'afternoon')
assert.equal(greetingPartForHour(24), 'afternoon')
assert.equal(greetingPartForHour('nope'), 'afternoon')

assert.equal(greetingLabel('morning'), 'Good morning')
assert.equal(greetingLabel('afternoon'), 'Good afternoon')
assert.equal(greetingLabel('evening'), 'Good evening')
assert.equal(greetingLabel('junk'), 'Good afternoon')

// Override from the preview panel wins over the clock.
assert.deepEqual(
  resolveGreeting({ hour: 9, override: 'evening', firstName: 'Mahenga' }),
  { part: 'evening', label: 'Good evening', name: 'Mahenga' },
)
// No override → hour decides; blank name defaults.
assert.deepEqual(
  resolveGreeting({ hour: 9, firstName: '  ' }),
  { part: 'morning', label: 'Good morning', name: 'there' },
)
// Unknown override string is ignored, not trusted.
assert.equal(resolveGreeting({ hour: 20, override: 'noon' }).part, 'evening')

assert.equal(progressFraction(2, 5), 0.4)
assert.equal(progressFraction(0, 6), 0)
assert.equal(progressFraction(7, 5), 1)
assert.equal(progressFraction(1, 0), 0)
assert.equal(progressFraction('x', 5), 0)

console.log('dashboardV2Core: all assertions passed')
