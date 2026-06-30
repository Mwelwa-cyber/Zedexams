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

// ── busy guard: critical work in flight (e.g. a lesson-plan generation) ──────
console.log('\npwa auto-reload — busy guard (critical work in flight)')

test('update ready but busy → disarms, never reloads', () => {
  const r = pwaReloadOnNavigate({ armed: false, updateReady: true, busy: true })
  assert(r.armed === false && r.reload === false, `got ${JSON.stringify(r)}`)
})

test('busy disarms even when previously armed → no reload on navigation mid-op', () => {
  const r = pwaReloadOnNavigate({ armed: true, updateReady: true, busy: true })
  assert(r.armed === false && r.reload === false, `expected disarm while busy, got ${JSON.stringify(r)}`)
})

test('the reported bug: update arrives mid-generation, teacher navigates, op finishes, then navigates again', () => {
  // Update arrives while generating (busy): must NOT arm and must NOT reload.
  const t1 = pwaReloadOnNavigate({ armed: false, updateReady: true, busy: true })
  assert(t1.reload === false && t1.armed === false, 'must not reload/arm while generating')
  // A navigation happens WHILE still generating: still safe — no reload.
  const t2 = pwaReloadOnNavigate({ armed: t1.armed, updateReady: true, busy: true })
  assert(t2.reload === false, 'a navigation during generation must never reload')
  // Generation finishes (busy clears): arms on this run, still no reload.
  const t3 = pwaReloadOnNavigate({ armed: t2.armed, updateReady: true, busy: false })
  assert(t3.reload === false && t3.armed === true, 'arms when busy clears, no reload yet')
  // Next navigation after the op: now it reloads onto the new build.
  const t4 = pwaReloadOnNavigate({ armed: t3.armed, updateReady: true, busy: false })
  assert(t4.reload === true, 'reloads on the first navigation after the op completes')
})

test('busy defaults to false → existing (non-busy) behaviour is unchanged', () => {
  const r = pwaReloadOnNavigate({ armed: true, updateReady: true })
  assert(r.armed === true && r.reload === true, `expected unchanged reload, got ${JSON.stringify(r)}`)
})

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`); process.exit(1) }
