#!/usr/bin/env node
/**
 * Static-text regression tests for the boot watchdog (white-screen guard).
 *
 * Background: a throw anywhere on the startup path that runs BEFORE React's
 * <ErrorBoundary> mounts — most commonly getAuth() throwing
 * `auth/invalid-api-key` at module load when a Firebase config value is
 * missing in the deploy, or a stale service-worker serving an index.html that
 * points at hashed chunks a newer deploy already removed (ChunkLoadError) —
 * leaves the user on a permanent blank #root with no message and no way out.
 * The React ErrorBoundary cannot catch any of these because it never mounts.
 *
 * The fix (see index.html) is a dependency-free inline watchdog that detects
 * an empty #root after a boot error / hard timeout and renders a recovery UI
 * with Reload + "Clear cache & reload" (which unregisters the SW + clears Cache
 * Storage — the actual cure for the stale-SW case). src/main.jsx sets
 * window.__ZED_APP_MOUNTED__ so a slow-but-successful boot never trips it, and
 * src/firebase/config.js validates required keys up front for clear operator
 * diagnostics.
 *
 * This is a text-level guard (like test-storage-rules-text.mjs): it pins the
 * load-bearing strings so a future edit to index.html / main.jsx / config.js
 * can't silently delete the white-screen net. The functional proof that the
 * watchdog actually paints lives in the mobile-smoke harness; this keeps the
 * invariant cheap enough to run in `npm run test:all`.
 *
 * Run: npm run test:boot-watchdog  (also via npm run test:all)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8')
const mainJsx = readFileSync(join(ROOT, 'src', 'main.jsx'), 'utf8')
const configJs = readFileSync(join(ROOT, 'src', 'firebase', 'config.js'), 'utf8')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('\nboot watchdog (index.html)')

test('watchdog reads the shared mount flag', () => {
  assert(
    indexHtml.includes('__ZED_APP_MOUNTED__'),
    'index.html watchdog must consult window.__ZED_APP_MOUNTED__ so a slow but successful boot never trips the fallback',
  )
})

test('watchdog also treats a non-empty #root as mounted', () => {
  assert(
    /childElementCount/.test(indexHtml),
    'watchdog must check #root.childElementCount as the primary mounted signal',
  )
})

test('watchdog listens for boot errors AND a hard timeout', () => {
  assert(indexHtml.includes("addEventListener('error'"), 'watchdog must listen for window error events')
  assert(
    indexHtml.includes("addEventListener('unhandledrejection'"),
    'watchdog must listen for unhandledrejection',
  )
  assert(indexHtml.includes("addEventListener('load'"), 'watchdog must arm a hard timeout on load')
})

test('error listener uses capture phase to catch failed chunk loads', () => {
  // A stale-SW ChunkLoadError surfaces as a resource <script> error, which
  // only a capture-phase listener sees. The third arg `true` is load-bearing.
  assert(
    /addEventListener\('error',\s*\w+,\s*true\)/.test(indexHtml),
    'the error listener must be registered with capture = true',
  )
})

test('fallback UI is rendered into #root with recovery actions', () => {
  assert(
    indexHtml.includes('We could not finish loading ZedExams'),
    'watchdog must render the recovery heading',
  )
  assert(/onclick="location\.reload\(\)"/.test(indexHtml), 'fallback must offer a plain Reload')
  assert(
    indexHtml.includes('zedClearCacheReload'),
    'fallback must offer a cache-clearing reload (the stale-SW cure)',
  )
})

test('clear-cache helper unregisters the SW and clears Cache Storage', () => {
  assert(
    indexHtml.includes('serviceWorker') && indexHtml.includes('unregister'),
    'zedClearCacheReload must unregister service workers',
  )
  assert(
    indexHtml.includes('caches.keys') && indexHtml.includes('caches.delete'),
    'zedClearCacheReload must clear Cache Storage',
  )
})

console.log('\nmount flag (src/main.jsx)')

test('main.jsx sets the mount flag after render', () => {
  assert(
    /window\.__ZED_APP_MOUNTED__\s*=\s*true/.test(mainJsx),
    'main.jsx must set window.__ZED_APP_MOUNTED__ = true so the watchdog knows the app booted',
  )
})

console.log('\nfirebase config validation (src/firebase/config.js)')

test('config.js validates required keys before initializeApp', () => {
  assert(
    configJs.includes('REQUIRED_CONFIG_KEYS'),
    'config.js must declare the required-key list',
  )
  const reqIdx = configJs.indexOf('REQUIRED_CONFIG_KEYS')
  const initIdx = configJs.indexOf('initializeApp(firebaseConfig)')
  assert(reqIdx !== -1 && initIdx !== -1 && reqIdx < initIdx, 'validation must run before initializeApp')
})

test('config.js names the missing VITE_FIREBASE_* var in the error', () => {
  assert(
    configJs.includes('VITE_FIREBASE_') && /Missing required Firebase web config/.test(configJs),
    'config.js error message must name the missing VITE_FIREBASE_* variables',
  )
})

console.log('')
if (fail > 0) {
  console.log(`─── ${pass} passed · ${fail} failed ───`)
  for (const f of failures) console.log(`  ✗ ${f.name}: ${f.message}`)
  process.exit(1)
}
console.log(`─── all ${pass} boot-watchdog checks passed ───`)
