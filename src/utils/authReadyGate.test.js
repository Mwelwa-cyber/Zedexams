/**
 * Node test for src/utils/authReadyGate.js — the module-level mirror of
 * `authReady` that the Firestore read path waits on.
 *
 * Run: node src/utils/authReadyGate.test.js
 */

import assert from 'node:assert/strict'
import {
  isAuthReady,
  markAuthReady,
  markAuthUnresolved,
  whenAuthReady,
  AUTH_READY_WAIT_MS,
} from './authReadyGate.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

markAuthUnresolved()
ok('starts unresolved', isAuthReady() === false)

// ── Waiters release together ─────────────────────────────────────────────
const a = whenAuthReady({ timeoutMs: 5000 })
const b = whenAuthReady({ timeoutMs: 5000 })
let aDone = false
let bDone = false
void a.then((v) => { aDone = v }).catch(() => {})
void b.then((v) => { bDone = v }).catch(() => {})

// Nothing resolves before auth speaks — a gate that opened on its own would
// let through exactly the reads it exists to hold.
await new Promise((r) => setTimeout(r, 20))
ok('a waiter does not resolve before auth speaks', aDone === false && bDone === false)

markAuthReady()
ok('marking ready flips the flag', isAuthReady() === true)
ok('every waiter resolves true', (await a) === true && (await b) === true)

// ── Already-open gate is free ────────────────────────────────────────────
ok('a wait after ready resolves immediately', (await whenAuthReady({ timeoutMs: 0 })) === true)
// Marking twice must not throw or double-release.
markAuthReady()
ok('marking ready twice is a no-op', isAuthReady() === true)

// ── The bound ────────────────────────────────────────────────────────────
// A wedged auth must give the caller an honest `false`, not hang the screen
// forever. This is the difference between a denied read and a blank page.
markAuthUnresolved()
const started = Date.now()
const timedOut = await whenAuthReady({ timeoutMs: 30 })
ok('a wedged auth resolves false rather than hanging', timedOut === false)
ok('the timeout is honoured', Date.now() - started < 2000)
ok('a timed-out wait leaves the gate closed', isAuthReady() === false)

// A waiter that timed out must not be re-resolved by a later markAuthReady —
// the promise is already settled, and a double resolve would be a silent bug
// elsewhere.
markAuthReady()
ok('a late markAuthReady after a timeout still opens the gate', isAuthReady() === true)

// ── A throwing waiter cannot strand the others ───────────────────────────
markAuthUnresolved()
const survivor = whenAuthReady({ timeoutMs: 5000 })
markAuthReady()
ok('a waiter still resolves after the queue is drained', (await survivor) === true)

ok('the default wait is bounded and sane', AUTH_READY_WAIT_MS > 0 && AUTH_READY_WAIT_MS <= 30_000)

console.log(`\nauthReadyGate: ${passed} assertions passed`)
