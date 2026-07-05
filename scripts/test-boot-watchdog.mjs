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
 * The fix (see public/boot.js) is a dependency-free watchdog that detects an
 * empty #root after a boot error / hard timeout and renders a recovery UI with
 * Reload + "Clear cache & reload" (which unregisters the SW + clears Cache
 * Storage — the actual cure for the stale-SW case). It lives in public/boot.js
 * (loaded by index.html via <script src="/boot.js">) rather than inline so the
 * CSP script-src can stay free of 'unsafe-inline'. src/main.jsx sets
 * window.__ZED_APP_MOUNTED__ so a slow-but-successful boot never trips it, and
 * src/firebase/config.js validates required keys up front for clear operator
 * diagnostics.
 *
 * This is a text-level guard (like test-storage-rules-text.mjs): it pins the
 * load-bearing strings so a future edit to boot.js / index.html / main.jsx /
 * config.js can't silently delete the white-screen net. The functional proof
 * that the watchdog actually paints lives in the mobile-smoke harness; this
 * keeps the invariant cheap enough to run in `npm run test:all`.
 *
 * Run: npm run test:boot-watchdog  (also via npm run test:all)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8')
const bootJs = readFileSync(join(ROOT, 'public', 'boot.js'), 'utf8')
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

console.log('\nboot watchdog (public/boot.js)')

test('index.html loads the external boot script', () => {
  // The watchdog + theme guard live in public/boot.js (externalised so the CSP
  // script-src can drop 'unsafe-inline'). If index.html stops loading it, the
  // whole white-screen net silently disappears.
  assert(
    /<script[^>]*\bsrc="\/boot\.js"/.test(indexHtml),
    'index.html must load /boot.js via <script src="/boot.js">',
  )
})

test('watchdog reads the shared mount flag', () => {
  assert(
    bootJs.includes('__ZED_APP_MOUNTED__'),
    'boot.js watchdog must consult window.__ZED_APP_MOUNTED__ so a slow but successful boot never trips the fallback',
  )
})

test('watchdog detects a real React mount via #root children, ignoring the boot skeleton', () => {
  // The inline boot skeleton makes #root non-empty before React mounts, so the
  // watchdog can no longer treat "any child" as mounted — it must look past the
  // skeleton, or a genuine hang would never trip the white-screen fallback.
  assert(
    /root\.children/.test(bootJs),
    'watchdog must inspect #root children as a DOM-based mounted signal',
  )
  assert(
    bootJs.includes('zed-boot-skeleton'),
    'watchdog must reference the boot skeleton so it does not count it as a real mount',
  )
})

test('an inline boot skeleton paints before the JS bundle (FCP guard)', () => {
  // Paints the brand + spinner in the first frame so a cold mobile load is not
  // a blank screen for several seconds. Lives inside #root so createRoot() drops
  // it on mount. Still inline in index.html (it's markup, not script).
  assert(
    /<div id="root">[\s\S]*id="zed-boot-skeleton"[\s\S]*<\/div>\s*<\/div>/.test(indexHtml),
    'index.html must render an inline #zed-boot-skeleton inside #root',
  )
  assert(/ZedExams|Zed<span/.test(indexHtml), 'the boot skeleton should show the brand wordmark')
})

test('watchdog listens for boot errors AND a hard timeout', () => {
  assert(bootJs.includes("addEventListener('error'"), 'watchdog must listen for window error events')
  assert(
    bootJs.includes("addEventListener('unhandledrejection'"),
    'watchdog must listen for unhandledrejection',
  )
  assert(bootJs.includes("addEventListener('load'"), 'watchdog must arm a hard timeout on load')
})

test('error listener uses capture phase to catch failed chunk loads', () => {
  // A stale-SW ChunkLoadError surfaces as a resource <script> error, which
  // only a capture-phase listener sees. The third arg `true` is load-bearing.
  assert(
    /addEventListener\('error',\s*\w+,\s*true\)/.test(bootJs),
    'the error listener must be registered with capture = true',
  )
})

test('fallback UI is rendered into #root with recovery actions', () => {
  assert(
    bootJs.includes('We could not finish loading ZedExams'),
    'watchdog must render the recovery heading',
  )
  // The recovery buttons are wired with addEventListener (not inline onclick),
  // which is what lets script-src drop 'unsafe-inline'.
  assert(
    /addEventListener\('click'[\s\S]*location\.reload\(\)/.test(bootJs),
    'fallback must offer a plain Reload wired via addEventListener',
  )
  assert(
    bootJs.includes('zedClearCacheReload'),
    'fallback must offer a cache-clearing reload (the stale-SW cure)',
  )
})

test('the recovery UI wires no inline event-handler attributes (CSP)', () => {
  // Inline on*="" handlers inside the injected markup would force script-src
  // 'unsafe-inline' back on. Scope the match to tag context (<... on*=) so a
  // prose comment mentioning the old onload attribute doesn't trip it.
  assert(
    !/<[^>]*\son(click|load|error)\s*=\s*["']/.test(bootJs),
    'boot.js must not build inline on*="" handlers in markup — wire events with addEventListener',
  )
})

test('clear-cache helper unregisters the SW and clears Cache Storage', () => {
  assert(
    bootJs.includes('serviceWorker') && bootJs.includes('unregister'),
    'zedClearCacheReload must unregister service workers',
  )
  assert(
    bootJs.includes('caches.keys') && bootJs.includes('caches.delete'),
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
