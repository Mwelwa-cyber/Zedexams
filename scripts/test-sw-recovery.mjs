/**
 * scripts/test-sw-recovery.mjs
 *
 * Regression test for the stale-chunk login failure (PR: zedexams-login-issue).
 *
 * Production data showed `Failed to fetch dynamically imported module …
 * /assets/Login-*.js` reaching the error boundary 28× across 5 users: after a
 * deploy the old hashed chunks 404, and because the PWA service worker keeps
 * serving the stale precached index.html, a plain reload loops back into the
 * same failed import. The fix evicts the SW shell (clears Cache Storage +
 * unregisters the SW) BEFORE reloading.
 *
 * These tests pin:
 *   1. chunk-load errors are detected across browser message shapes,
 *   2. the purge clears every cache key and unregisters every SW,
 *   3. recovery always reloads — even if the purge hangs or rejects,
 *   4. recovery purges BEFORE it reloads.
 *
 * Plain `node` script (no test runner) per repo convention; throws on failure.
 */

import assert from 'node:assert/strict'
import {
  isChunkLoadError,
  purgeServiceWorkerCaches,
  recoverFromChunkError,
} from '../src/utils/swRecovery.js'

let passed = 0
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1
      console.log(`  ✓ ${name}`)
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`)
      console.error(err)
      process.exit(1)
    })
}

await test('isChunkLoadError detects the production Vite/Chrome message', () => {
  assert.equal(
    isChunkLoadError(
      new TypeError(
        'Failed to fetch dynamically imported module: https://zedexams.com/assets/Login-I0CPmIMJ.js',
      ),
    ),
    true,
  )
})

await test('isChunkLoadError detects Firefox / Safari / Webpack variants', () => {
  assert.equal(isChunkLoadError(new Error('error loading dynamically imported module')), true)
  assert.equal(isChunkLoadError(new Error('Importing a module script failed.')), true)
  assert.equal(isChunkLoadError(new Error('Loading chunk 42 failed.')), true)
  assert.equal(isChunkLoadError(new Error('Loading CSS chunk 7 failed.')), true)
  const named = new Error('boom')
  named.name = 'ChunkLoadError'
  assert.equal(isChunkLoadError(named), true)
})

await test('isChunkLoadError ignores unrelated and empty errors', () => {
  assert.equal(isChunkLoadError(new Error('Invalid quiz payload at passages.0')), false)
  assert.equal(isChunkLoadError(new TypeError('x is not a function')), false)
  assert.equal(isChunkLoadError(null), false)
  assert.equal(isChunkLoadError(undefined), false)
})

await test('purge clears every cache key and unregisters every SW', async () => {
  const deletedKeys = []
  const unregistered = []
  const cacheStorage = {
    keys: async () => ['workbox-precache-v1', 'google-fonts-css', 'firebase-storage'],
    delete: async (key) => {
      deletedKeys.push(key)
      return true
    },
  }
  const serviceWorker = {
    getRegistrations: async () => [
      { unregister: async () => unregistered.push('a') },
      { unregister: async () => unregistered.push('b') },
    ],
  }

  await purgeServiceWorkerCaches({ cacheStorage, serviceWorker })

  assert.deepEqual(deletedKeys.sort(), [
    'firebase-storage',
    'google-fonts-css',
    'workbox-precache-v1',
  ])
  assert.deepEqual(unregistered.sort(), ['a', 'b'])
})

await test('purge is a no-op (and never throws) without the browser APIs', async () => {
  await purgeServiceWorkerCaches({}) // neither caches nor SW available
})

await test('purge survives a cache API that rejects', async () => {
  let unregistered = false
  await purgeServiceWorkerCaches({
    cacheStorage: { keys: async () => { throw new Error('quota') } },
    serviceWorker: {
      getRegistrations: async () => [{ unregister: async () => { unregistered = true } }],
    },
  })
  // SW unregister still ran despite the cache side blowing up.
  assert.equal(unregistered, true)
})

await test('recovery purges BEFORE it reloads', async () => {
  const order = []
  await recoverFromChunkError({
    purge: async () => { order.push('purge') },
    reload: () => { order.push('reload') },
  })
  assert.deepEqual(order, ['purge', 'reload'])
})

await test('recovery still reloads when the purge rejects', async () => {
  let reloaded = false
  await recoverFromChunkError({
    purge: async () => { throw new Error('unregister failed') },
    reload: () => { reloaded = true },
  })
  assert.equal(reloaded, true)
})

await test('recovery reloads even if the purge hangs forever (timeout wins)', async () => {
  let reloaded = false
  await recoverFromChunkError({
    purge: () => new Promise(() => {}), // never resolves
    reload: () => { reloaded = true },
    timeoutMs: 20,
  })
  assert.equal(reloaded, true)
})

console.log(`\nsw-recovery: ${passed} checks passed`)
