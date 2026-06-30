#!/usr/bin/env node
/**
 * Tests for the critical-work guard (src/utils/criticalWork.js).
 * Run: npm run test:critical-work  (also via npm run test:all)
 *
 * Behaviour pinned:
 *   • Ref-counted: nested begins keep it busy until every matching release.
 *   • Releasers are one-shot — calling one twice can't drive the count negative.
 *   • endCriticalWork() floors at zero (a stray extra release is a no-op).
 *   • Subscribers fire only on the 0↔1 busy edges, with the current boolean.
 *
 * Runs without a DOM: criticalWork.js guards its `window` access, so the
 * beforeunload binding simply no-ops here while the counter logic is exercised.
 */

const {
  beginCriticalWork,
  endCriticalWork,
  isCriticalWorkInFlight,
  subscribeCriticalWork,
  __resetCriticalWork,
} = await import('../src/utils/criticalWork.js')

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  __resetCriticalWork()
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, err }); console.log(`  XX  ${name} — ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

console.log('\ncritical-work guard')

test('idle by default', () => {
  assert(isCriticalWorkInFlight() === false, 'should start idle')
})

test('begin → busy, release → idle', () => {
  const release = beginCriticalWork()
  assert(isCriticalWorkInFlight() === true, 'busy after begin')
  release()
  assert(isCriticalWorkInFlight() === false, 'idle after release')
})

test('nested work stays busy until every release', () => {
  const r1 = beginCriticalWork()
  const r2 = beginCriticalWork()
  assert(isCriticalWorkInFlight() === true, 'busy with two in flight')
  r1()
  assert(isCriticalWorkInFlight() === true, 'still busy with one in flight')
  r2()
  assert(isCriticalWorkInFlight() === false, 'idle once both released')
})

test('releaser is one-shot — double release cannot go negative', () => {
  const r1 = beginCriticalWork()
  const r2 = beginCriticalWork()
  r1(); r1(); r1() // extra calls must be no-ops
  assert(isCriticalWorkInFlight() === true, 'second op must still hold it busy')
  r2()
  assert(isCriticalWorkInFlight() === false, 'idle after the real second release')
})

test('endCriticalWork floors at zero', () => {
  endCriticalWork() // stray release with nothing in flight
  assert(isCriticalWorkInFlight() === false, 'still idle, no underflow')
  const release = beginCriticalWork()
  assert(isCriticalWorkInFlight() === true)
  release()
  assert(isCriticalWorkInFlight() === false)
})

test('subscribers fire on busy edges with the current value', () => {
  const seen = []
  const unsub = subscribeCriticalWork((busy) => seen.push(busy))
  const r1 = beginCriticalWork()  // edge → true
  const r2 = beginCriticalWork()  // no edge (still busy)
  r1()                            // no edge (still busy)
  r2()                            // edge → false
  unsub()
  beginCriticalWork()             // no notification after unsubscribe
  assert(JSON.stringify(seen) === JSON.stringify([true, false]), `got ${JSON.stringify(seen)}`)
})

test('a throwing subscriber never wedges the counter', () => {
  subscribeCriticalWork(() => { throw new Error('boom') })
  const release = beginCriticalWork()
  assert(isCriticalWorkInFlight() === true, 'still tracks busy despite a throwing listener')
  release()
  assert(isCriticalWorkInFlight() === false, 'still releases despite a throwing listener')
})

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`); process.exit(1) }
