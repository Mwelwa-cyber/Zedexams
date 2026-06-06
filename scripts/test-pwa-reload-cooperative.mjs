#!/usr/bin/env node
/**
 * scripts/test-pwa-reload-cooperative.mjs
 *
 * Regression test for the bug: document-quiz imports interrupted by a
 * service-worker-triggered page reload.
 *
 * Root cause (fixed in this change):
 *   sw-reload-clients.js called client.navigate(client.url) — a hard
 *   immediate reload — when a new SW activated. This fired while the user was
 *   opening the OS file picker (which triggers focus/visibilitychange events
 *   that in turn called registration.update()). If a fresh SW was available at
 *   that moment it would install, skipWaiting, activate, and hard-reload the
 *   tab before the import could complete.
 *
 * The fix (two parts):
 *   1. sw-reload-clients.js now sends postMessage({ type: 'SW_RELOAD_REQUEST' })
 *      instead of calling client.navigate() directly, so the page can show a
 *      prompt and reload at a safe moment.
 *   2. usePwaUpdate.js no longer registers a window 'focus' listener that
 *      triggered registration.update() — the 30-min timer + visibilitychange
 *      are sufficient and don't fire during file-picker open/close.
 *
 * These tests pin:
 *   1. sw-reload-clients.js uses postMessage, not navigate()
 *   2. The SW_RELOAD_REQUEST message contains the correct type
 *   3. An update replaces an existing SW (replacingExisting=true) triggers
 *      postMessage for each open client window
 *   4. A first-ever install (replacingExisting=false) skips the notification
 *   5. postMessage errors are swallowed — they never block SW activation
 *
 * Plain `node` script (no test runner) per repo convention; throws on failure.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const swReloadSrc = readFileSync(
  resolve(__dirname, '../public/sw-reload-clients.js'),
  'utf8',
)

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    failed++
    failures.push({ name, message: err.message })
    console.error(`  FAIL ${name}`)
    console.error(`       ${err.message}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    failed++
    failures.push({ name, message: err.message })
    console.error(`  FAIL ${name}`)
    console.error(`       ${err.message}`)
  }
}

/**
 * Evaluate sw-reload-clients.js in a simulated service-worker global.
 * Returns the spy objects so we can assert on what was called.
 *
 * The script is an IIFE that attaches listeners via `self.addEventListener`.
 * We simulate the SW global (self), then fire install + activate synthetic
 * events to exercise the logic.
 */
function makeSWContext({ hasActiveWorker = true } = {}) {
  const messages = []   // captures { clientId, data } from postMessage calls
  const navigateCalls = [] // captures any navigate() calls (should be zero)

  const clients = []
  // Build fake window clients that record postMessage / navigate calls
  function makeClient(id) {
    return {
      id,
      url: `https://zedexams.com/teacher/assessments/new`,
      postMessage(data) {
        messages.push({ clientId: id, data })
        return Promise.resolve()
      },
      navigate(url) {
        navigateCalls.push({ clientId: id, url })
        return Promise.resolve({ url })
      },
    }
  }
  clients.push(makeClient('tab-1'), makeClient('tab-2'))

  const listeners = {}
  const swSelf = {
    registration: hasActiveWorker ? { active: { scriptURL: 'https://zedexams.com/sw.js' } } : null,
    clients: {
      claim: async () => {},
      matchAll: async ({ type } = {}) => type === 'window' ? [...clients] : [],
    },
    addEventListener(event, handler) {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(handler)
    },
  }

  // Evaluate the IIFE in the simulated global scope.
  // We use new Function to set `self` as the global.
  const fn = new Function('self', swReloadSrc)  // eslint-disable-line no-new-func
  fn(swSelf)

  async function fireInstall() {
    for (const h of listeners['install'] || []) h({})
  }

  async function fireActivate() {
    const waitingPromises = []
    const event = {
      waitUntil(p) { waitingPromises.push(p) },
    }
    for (const h of listeners['activate'] || []) h(event)
    // Wait for all waitUntil promises to settle
    await Promise.allSettled(waitingPromises)
  }

  return { messages, navigateCalls, fireInstall, fireActivate, clients }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\nsw-reload-clients: cooperative reload (postMessage, not navigate)')

await testAsync('uses postMessage not navigate on update (replacingExisting=true)', async () => {
  const { messages, navigateCalls, fireInstall, fireActivate } = makeSWContext({ hasActiveWorker: true })
  await fireInstall()
  await fireActivate()

  assert.equal(navigateCalls.length, 0,
    `navigate() was called ${navigateCalls.length} time(s) — must be 0 to avoid hard reload mid-import`)
  assert.equal(messages.length, 2,
    `expected 2 postMessage calls (one per client), got ${messages.length}`)
})

await testAsync('postMessage carries SW_RELOAD_REQUEST type', async () => {
  const { messages, fireInstall, fireActivate } = makeSWContext({ hasActiveWorker: true })
  await fireInstall()
  await fireActivate()

  for (const msg of messages) {
    assert.equal(msg.data?.type, 'SW_RELOAD_REQUEST',
      `postMessage data.type should be 'SW_RELOAD_REQUEST', got ${JSON.stringify(msg.data)}`)
  }
})

await testAsync('messages go to each open window client', async () => {
  const { messages, fireInstall, fireActivate } = makeSWContext({ hasActiveWorker: true })
  await fireInstall()
  await fireActivate()

  const ids = messages.map(m => m.clientId).sort()
  assert.deepEqual(ids, ['tab-1', 'tab-2'],
    `expected messages to both clients, got ${JSON.stringify(ids)}`)
})

await testAsync('first-ever install (replacingExisting=false) sends no messages', async () => {
  const { messages, navigateCalls, fireInstall, fireActivate } = makeSWContext({ hasActiveWorker: false })
  await fireInstall()
  await fireActivate()

  assert.equal(messages.length, 0,
    `expected 0 postMessages on first install, got ${messages.length}`)
  assert.equal(navigateCalls.length, 0,
    `expected 0 navigate calls on first install, got ${navigateCalls.length}`)
})

await testAsync('postMessage rejection is swallowed — does not reject the activate promise', async () => {
  // Simulate a client whose postMessage rejects (e.g. the tab was closed).
  const messages = []
  const navigateCalls = []
  const listeners = {}

  const failingClient = {
    id: 'dying-tab',
    url: 'https://zedexams.com/',
    postMessage() { return Promise.reject(new Error('client gone')) },
    navigate(url) { navigateCalls.push(url); return Promise.resolve({ url }) },
  }

  const swSelf = {
    registration: { active: {} },
    clients: {
      claim: async () => {},
      matchAll: async () => [failingClient],
    },
    addEventListener(event, handler) {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(handler)
    },
  }

  const fn = new Function('self', swReloadSrc)  // eslint-disable-line no-new-func
  fn(swSelf)

  let activateResolved = false
  const waitingPromises = []
  const event = { waitUntil(p) { waitingPromises.push(p) } }
  for (const h of listeners['install'] || []) h({})
  for (const h of listeners['activate'] || []) h(event)

  // Must settle without throwing
  const results = await Promise.allSettled(waitingPromises)
  for (const r of results) {
    assert.equal(r.status, 'fulfilled',
      `activate waitUntil promise rejected: ${r.reason}`)
  }
  activateResolved = true
  assert.equal(activateResolved, true)
  assert.equal(navigateCalls.length, 0, 'navigate() must not be called as a fallback')
})

console.log('\nsw-reload-clients: source does not contain client.navigate')

test('sw-reload-clients.js source has no client.navigate() call', () => {
  // Guard against future regressions: the src must not contain direct navigate
  // calls in executable code. Strip single-line and block comments first so
  // that mentions in the doc comment (e.g. "We do NOT call client.navigate()")
  // don't cause a false positive.
  const noBlockComments = swReloadSrc.replace(/\/\*[\s\S]*?\*\//g, '')
  const noLineComments = noBlockComments.replace(/\/\/.*/g, '')
  assert.equal(
    /client\.navigate\s*\(/.test(noLineComments),
    false,
    'sw-reload-clients.js must not call client.navigate() in executable code — use postMessage instead',
  )
})

test('sw-reload-clients.js source contains postMessage({ type: \'SW_RELOAD_REQUEST\' })', () => {
  assert.match(
    swReloadSrc,
    /postMessage\(\s*\{\s*type\s*:\s*['"]SW_RELOAD_REQUEST['"]/,
    'sw-reload-clients.js must postMessage SW_RELOAD_REQUEST',
  )
})

// ─── Report ───────────────────────────────────────────────────────────────────

console.log('')
console.log(`─── ${passed + failed} tests · ${passed} passed · ${failed} failed ───`)
if (failed > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
