#!/usr/bin/env node
/**
 * Tests for the PWA "auto-reload on next navigation" decision helper.
 * Run: npm run test:pwa-auto-reload  (also via npm run test:all)
 *
 * Behaviour pinned (see src/hooks/pwaAutoReload.js):
 *   When a new service worker has activated (updateReady), the app should NOT
 *   hard-reload immediately (that could interrupt an in-flight op like a
 *   document import). Instead it "arms" at the current location and applies the
 *   update on the NEXT in-app navigation — a safe teardown point. The toast
 *   remains as a fallback for users who never navigate.
 */

const { pwaReloadOnNavigate } = await import('../src/hooks/pwaAutoReload.js')

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, err }); console.log(`  XX  ${name} — ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

console.log('\npwa auto-reload — reload-on-navigation decision')

test('no update pending → never armed, never reloads', () => {
  const r = pwaReloadOnNavigate({ armed: false, updateReady: false })
  assert(r.armed === false && r.reload === false, `got ${JSON.stringify(r)}`)
})

test('update becomes ready (not yet armed) → arms at current location, does NOT reload', () => {
  const r = pwaReloadOnNavigate({ armed: false, updateReady: true })
  assert(r.armed === true && r.reload === false, `expected arm-without-reload, got ${JSON.stringify(r)}`)
})

test('navigation while armed + update ready → reload now (stays armed)', () => {
  const r = pwaReloadOnNavigate({ armed: true, updateReady: true })
  assert(r.armed === true && r.reload === true, `expected reload, got ${JSON.stringify(r)}`)
})

test('update no longer ready → disarms, never reloads', () => {
  const r = pwaReloadOnNavigate({ armed: true, updateReady: false })
  assert(r.armed === false && r.reload === false, `expected disarm, got ${JSON.stringify(r)}`)
})

test('a fresh arm cycle never reloads on the SAME tick the update arrived', () => {
  // Simulate: update arrives (tick 1) then one navigation (tick 2).
  let s = { armed: false }
  const t1 = pwaReloadOnNavigate({ armed: s.armed, updateReady: true }) // update arrives
  s = { armed: t1.armed }
  assert(t1.reload === false, 'must not reload on the tick the update arrived')
  const t2 = pwaReloadOnNavigate({ armed: s.armed, updateReady: true }) // first navigation
  assert(t2.reload === true, 'must reload on the first navigation after arming')
})

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`); process.exit(1) }
