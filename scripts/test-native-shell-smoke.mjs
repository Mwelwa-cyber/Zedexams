#!/usr/bin/env node
/* global console, process, document, window */
/**
 * Native-shell smoke: boots the BUILT bundle the way the Android WebView boots
 * it, so every `isNativePlatform()` branch actually executes.
 *
 * Why this is not the same as scripts/test-mobile-smoke.mjs: that one runs a
 * phone-sized *browser*, where Capacitor reports platform 'web'. Every native
 * branch in src/ (App Check via Play Integrity, native push, Play Billing, the
 * SystemBars status-bar manager, apiUrl() rewriting, the skipped service
 * worker) is dark code there. This harness injects the REAL bridge script the
 * Android shell injects (node_modules/@capacitor/android/.../native-bridge.js)
 * plus a `window.androidBridge`, which is exactly the signal
 * getPlatformId() keys off — so the same bundle runs its android paths.
 */
import { preview } from 'vite'
import puppeteer from 'puppeteer'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')
const DIST = join(REPO, 'dist')
// The exact script the Android shell injects into its WebView. Reading it from
// @capacitor/android (rather than hand-rolling a fake) is what makes this a
// simulation of the real bridge instead of a guess at it.
const BRIDGE = join(
  REPO,
  'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js',
)

// Two shapes of Android cold start, because they take different code paths:
// a signed-out visitor (App Check init deferred to an idle callback) and a
// returning user whose device holds a session (App Check init runs
// synchronously so the SDK's boot check is attested — see firebase/config.js).
const SCENARIOS = [
  { route: '/', withSession: false },
  { route: '/login', withSession: false },
  { route: '/register', withSession: false },
  { route: '/papers', withSession: false },
  { route: '/pricing', withSession: false },
  { route: '/', withSession: true, expectCalls: ['FirebaseAppCheck.initialize'] },
  { route: '/dashboard', withSession: true, expectCalls: ['FirebaseAppCheck.initialize'] },
  // Play Integrity answers normally, with the hour-long TTL a device really
  // returns. Establishes the healthy baseline for bridge chatter.
  {
    route: '/', withSession: true, tag: 'healthy Play Integrity',
    responses: { 'FirebaseAppCheck.getToken': { token: 'play-integrity-token', expireTimeMillis: -3600000 } },
  },
  // Play Integrity answers but yields NO token — the empty-result path that
  // sends resilientGetToken to its placeholder. The placeholder carries
  // APPCHECK_PLACEHOLDER_TTL_MS, so this is the production shape of a
  // degraded-attestation device.
  {
    route: '/', withSession: true, tag: 'placeholder path (no token returned)',
    responses: { 'FirebaseAppCheck.getToken': {} },
  },
  // Play Integrity FAILS FAST — no Play Services, quota exhausted, or App Check
  // not configured. This is the production path that falls back to the
  // placeholder token, and the one to watch for a refresh loop.
  {
    route: '/', withSession: true, tag: 'Play Integrity unavailable',
    failCalls: ['FirebaseAppCheck.getToken'],
  },
]
const NAV_TIMEOUT_MS = 45_000
const MIN_ROOT_TEXT = 120
const MAX_OVERFLOW_PX = 16
// Every native call is a JSON round-trip across the WebView bridge, so a loop
// here is a pegged core and a flat battery rather than a visible error. A cold
// boot legitimately makes a handful (status-bar style, a back-button listener,
// App Check init + a token); anything in the hundreds is a runaway.
//
// This is not a hypothetical budget: a placeholder App Check token whose TTL
// did not clear the Firebase SDK's five-minute refresh buffer had the SDK
// re-entering the provider ~1,300 times a SECOND — 12,000 bridge crossings in
// one six-second page load, and nothing on screen looked wrong.
const MAX_CALLS_PER_METHOD = 50

const ANDROID_VIEWPORT = {
  width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
}
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Mobile Safari/537.36'

const CRASH_MARKERS = [
  'We hit a snag loading this page',
  "We can't reach the network right now",
  'Something went wrong',
]

// Backend/network noise expected against the fake .env.smoke project and a
// sandbox with no egress. A genuine render exception is NOT on this list.
const BENIGN = new RegExp([
  'installations/', 'API key not valid', 'auth/network-request-failed',
  'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION', 'ERR_INTERNET_DISCONNECTED',
  'Failed to fetch', 'net::', 'Failed to load resource',
  'FirebaseError', 'firestore', 'Firestore', 'messaging/', 'AbortError',
  'ERR_CERT', 'ERR_PROXY', 'ERR_TUNNEL', 'ERR_EMPTY_RESPONSE',
  '404 (Not Found)', 'appCheck', 'App Check', 'Quota', 'permission-denied',
].join('|'), 'i')

// The plugins `npx cap sync android` registers (android/app/src/main/assets/
// capacitor.plugins.json) plus the SystemBars/Console plugins built into the
// bridge itself. Methods are the ones this app actually calls at boot.
const PLUGIN_HEADERS = [
  { name: 'SafeArea', methods: [{ name: 'enable', rtype: 'promise' }, { name: 'disable', rtype: 'promise' }, { name: 'getSafeAreaInsets', rtype: 'promise' }, { name: 'getStatusBarHeight', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }] },
  { name: 'FirebaseAppCheck', methods: [{ name: 'initialize', rtype: 'promise' }, { name: 'getToken', rtype: 'promise' }, { name: 'setTokenAutoRefreshEnabled', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }] },
  { name: 'FirebaseAuthentication', methods: [{ name: 'getCurrentUser', rtype: 'promise' }, { name: 'getIdToken', rtype: 'promise' }, { name: 'signInWithGoogle', rtype: 'promise' }, { name: 'signOut', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }] },
  { name: 'FirebaseMessaging', methods: [{ name: 'checkPermissions', rtype: 'promise' }, { name: 'requestPermissions', rtype: 'promise' }, { name: 'getToken', rtype: 'promise' }, { name: 'removeAllListeners', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }] },
  { name: 'App', methods: [{ name: 'getInfo', rtype: 'promise' }, { name: 'getState', rtype: 'promise' }, { name: 'exitApp', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }] },
  { name: 'Filesystem', methods: [{ name: 'writeFile', rtype: 'promise' }, { name: 'getUri', rtype: 'promise' }, { name: 'checkPermissions', rtype: 'promise' }, { name: 'requestPermissions', rtype: 'promise' }] },
  { name: 'Keyboard', methods: [{ name: 'setResizeMode', rtype: 'promise' }, { name: 'hide', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }] },
  { name: 'Share', methods: [{ name: 'share', rtype: 'promise' }, { name: 'canShare', rtype: 'promise' }] },
  { name: 'NativePurchases', methods: [{ name: 'getProducts', rtype: 'promise' }, { name: 'purchaseProduct', rtype: 'promise' }, { name: 'restorePurchases', rtype: 'promise' }, { name: 'isBillingSupported', rtype: 'promise' }] },
  { name: 'SystemBars', methods: [{ name: 'setStyle', rtype: 'promise' }, { name: 'show', rtype: 'promise' }, { name: 'hide', rtype: 'promise' }, { name: 'setAnimation', rtype: 'promise' }] },
  { name: 'Console', methods: [{ name: 'log', rtype: 'promise' }] },
  { name: 'WebView', methods: [{ name: 'setServerBasePath', rtype: 'promise' }, { name: 'getServerBasePath', rtype: 'promise' }, { name: 'persistServerBasePath', rtype: 'promise' }] },
  { name: 'CapacitorCookies', methods: [{ name: 'getCookies', rtype: 'promise' }, { name: 'setCookie', rtype: 'promise' }, { name: 'deleteCookie', rtype: 'promise' }, { name: 'clearCookies', rtype: 'promise' }, { name: 'clearAllCookies', rtype: 'promise' }] },
  { name: 'CapacitorHttp', methods: [{ name: 'request', rtype: 'promise' }, { name: 'get', rtype: 'promise' }, { name: 'post', rtype: 'promise' }, { name: 'put', rtype: 'promise' }, { name: 'patch', rtype: 'promise' }, { name: 'delete', rtype: 'promise' }] },
]

// What the fake native layer answers. Anything unlisted resolves to {}.
const PLUGIN_RESPONSES = {
  'SafeArea.getSafeAreaInsets': { insets: { top: 24, bottom: 48, left: 0, right: 0 } },
  'SafeArea.getStatusBarHeight': { statusBarHeight: 24 },
  'FirebaseAppCheck.getToken': { token: 'fake-play-integrity-token', exp: Date.now() + 3600_000 },
  'FirebaseAuthentication.getCurrentUser': { user: null },
  'FirebaseMessaging.checkPermissions': { receive: 'prompt' },
  'FirebaseMessaging.getToken': { token: 'fake-fcm-token' },
  'App.getInfo': { name: 'ZedExams', id: 'com.zedexams.android', build: '1', version: '1.3.1' },
  'App.getState': { isActive: true },
  'NativePurchases.isBillingSupported': { isBillingSupported: true },
  'NativePurchases.getProducts': { products: [] },
  'Share.canShare': { value: true },
}

function fail(msg) { console.error(`\n[native-smoke] ${msg}`); process.exitCode = 1 }

async function main() {
  if (!existsSync(DIST)) { fail(`no dist/ at ${DIST} — run npm run smoke:build first`); return }
  if (!existsSync(BRIDGE)) { fail(`no native-bridge.js at ${BRIDGE}`); return }
  const bridgeSrc = readFileSync(BRIDGE, 'utf8')

  const server = await preview({
    root: REPO,
    configFile: join(REPO, 'vite.config.js'),
    preview: { port: 0, strictPort: false, host: '127.0.0.1', open: false },
  })
  const url = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '')
  if (!url) { fail('preview server gave no URL'); return }
  console.log(`[native-smoke] preview at ${url}`)

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  let okCount = 0
  const failures = []

  for (const { route, withSession, expectCalls = [], responses = {}, failCalls = [], tag } of SCENARIOS) {
    const label = tag ? `${route} — ${tag}` : withSession ? `${route} (returning session)` : route
    // A negative expireTimeMillis means "this many ms in the FUTURE", resolved
    // in-page so the fixture isn't stamped at harness-start time.
    const scenarioResponses = { ...PLUGIN_RESPONSES, ...responses }
    const page = await browser.newPage()
    await page.setViewport(ANDROID_VIEWPORT)
    await page.setUserAgent(ANDROID_UA)

    const pageErrors = []
    const consoleErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)))
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

    // Inject the Android shell BEFORE any app script runs.
    await page.evaluateOnNewDocument(
      (src, headers, responses, withSession, failCalls) => {
        // 1) The signal getPlatformId() keys off → platform 'android'.
        window.androidBridge = {
          postMessage(msgStr) {
            let call
            try { call = JSON.parse(msgStr) } catch { return }
            const key = `${call.pluginId}.${call.methodName}`
            // Record every crossing so the harness can prove the native
            // branches RAN, not merely that nothing threw.
            if (call.pluginId !== 'Console') window.__ZED_NATIVE_CALLS__.push(key)
            // A registration is not an event. The real bridge invokes a
            // listener's callback only when the native side PUSHES an event,
            // so answering addListener here would fire every handler at boot —
            // which made the hardware-back handler run and call exitApp.
            if (call.methodName === 'addListener') return
            if (failCalls.includes(key)) {
              setTimeout(() => {
                try {
                  window.Capacitor.fromNative({
                    callbackId: call.callbackId, pluginId: call.pluginId,
                    methodName: call.methodName, success: false,
                    error: { message: 'Play Integrity is not available on this device.' },
                  })
                } catch { /* teardown */ }
              }, 0)
              return
            }
            const data = { ...(responses[key] || {}) }
            if (typeof data.expireTimeMillis === 'number' && data.expireTimeMillis < 0) {
              data.expireTimeMillis = Date.now() - data.expireTimeMillis
            }
            // Answer asynchronously, like a real native round-trip.
            setTimeout(() => {
              try {
                window.Capacitor.fromNative({
                  callbackId: call.callbackId,
                  pluginId: call.pluginId,
                  methodName: call.methodName,
                  success: true,
                  data,
                })
              } catch { /* teardown races are fine */ }
            }, 0)
          },
        }
        // 2) getGlobalJS(): the Bridge seeds the global before anything else.
        window.__ZED_NATIVE_CALLS__ = []
        if (withSession) {
          // 'auth:hasSession' (firebase/authSessionHint.js) is what makes
          // config.js run App Check init SYNCHRONOUSLY instead of on an idle
          // callback — the returning-user cold boot that App Check
          // enforcement on Auth turns into a sign-out when it regresses.
          try { localStorage.setItem('auth:hasSession', '1') } catch { /* private mode */ }
        }
        window.Capacitor = { DEBUG: false, isLoggingEnabled: false, Plugins: {} }
        // 3) The real bridge script the WebView injects (defines nativePromise,
        //    nativeCallback, addListener, toNative/fromNative).
        ;(0, eval)(src)
        // 4) getPluginJS(): for EVERY registered native plugin the Bridge
        //    injects a legacy object onto Capacitor.Plugins, then sets
        //    PluginHeaders. This is what makes `Capacitor.Plugins.X` resolve on
        //    a device WITHOUT the app importing the plugin's npm package —
        //    the lookup firebase/config.js, AuthContext and runtime.js all use.
        //    Omitting it is the difference between simulating the shell and
        //    guessing at it.
        for (const header of headers) {
          const w = window
          const t = (w.Capacitor.Plugins[header.name] = {})
          t.addListener = function (eventName, callback) {
            return w.Capacitor.addListener(header.name, eventName, callback)
          }
          for (const method of header.methods) {
            if (method.name === 'addListener' || method.name === 'removeListener') continue
            const mname = method.name
            t[mname] =
              method.rtype === 'callback'
                ? function (_options, _callback) {
                    return w.Capacitor.nativeCallback(header.name, mname, _options, _callback)
                  }
                : function (_options) {
                    return w.Capacitor.nativePromise(header.name, mname, _options)
                  }
          }
        }
        window.Capacitor.PluginHeaders = headers
        window.__ZED_NATIVE_SIM__ = true
      },
      bridgeSrc, PLUGIN_HEADERS, scenarioResponses, withSession, failCalls,
    )

    const target = `${url}${route}`
    let status = 0
    try {
      const res = await page.goto(target, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS })
      status = res?.status() ?? 0
    } catch (e) {
      failures.push(`${label}: navigation failed — ${e?.message || e}`)
      await page.close(); continue
    }

    // Long enough for the DEFERRED App Check path to have run: config.js
    // schedules it with requestIdleCallback({ timeout: 2500 }), so a shorter
    // wait would report "never initialised" for a path that simply had not
    // fired yet.
    await new Promise((r) => setTimeout(r, 6000))

    const probe = await page.evaluate((minText) => {
      const root = document.getElementById('root')
      const text = (root?.innerText || '').trim()
      const de = document.documentElement
      const cap = window.Capacitor
      return {
        platform: (() => { try { return cap?.getPlatform?.() } catch { return 'ERR' } })(),
        isNative: (() => { try { return cap?.isNativePlatform?.() === true } catch { return false } })(),
        textLen: text.length,
        enough: text.length >= minText,
        bodyText: (document.body.innerText || '').slice(0, 4000),
        overflow: Math.max(0, de.scrollWidth - de.clientWidth),
        // The native shell must NOT register a service worker: it is served
        // from the bundled origin where the SW is dead weight (src/main.jsx).
        swRegistered: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
        nativeCalls: (window.__ZED_NATIVE_CALLS__ || []).slice(),
        sessionHintKept: (() => {
          try { return localStorage.getItem('auth:hasSession') === '1' } catch { return false }
        })(),
      }
    }, MIN_ROOT_TEXT)

    const tally = new Map()
    for (const c of probe.nativeCalls) tally.set(c, (tally.get(c) || 0) + 1)
    const summary = [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}×${n}`)
      .join(', ')

    const problems = []
    if (status && status >= 400) problems.push(`HTTP ${status}`)
    if (!probe.isNative) problems.push(`native simulation did not take (platform=${probe.platform})`)
    if (!probe.enough) problems.push(`empty/thin render (#root text ${probe.textLen} < ${MIN_ROOT_TEXT})`)
    const crash = CRASH_MARKERS.find((m) => probe.bodyText.includes(m))
    if (crash) problems.push(`crash card: "${crash}"`)
    if (probe.overflow > MAX_OVERFLOW_PX) problems.push(`horizontal overflow ${probe.overflow}px`)
    if (probe.swRegistered) problems.push('a service worker registered inside the native shell')
    for (const [method, n] of tally) {
      if (n > MAX_CALLS_PER_METHOD) {
        problems.push(`native bridge loop: ${method} called ${n}× in one boot (budget ${MAX_CALLS_PER_METHOD})`)
      }
    }
    for (const expected of expectCalls) {
      if (!probe.nativeCalls.includes(expected)) {
        problems.push(`native call never made: ${expected}`)
      }
    }
    const realErrors = pageErrors.filter((e) => !BENIGN.test(e))
    if (realErrors.length) problems.push(`uncaught: ${realErrors.slice(0, 3).join(' | ')}`)

    const nativeConsole = consoleErrors.filter((e) => !BENIGN.test(e))

    if (problems.length) {
      failures.push(`${label}: ${problems.join('; ')}`)
      console.log(`  FAIL ${label}  [${probe.platform}]`)
      problems.forEach((p) => console.log(`         - ${p}`))
      console.log(`         native calls (${probe.nativeCalls.length}): ${summary || 'NONE'}`)
    } else {
      okCount += 1
      console.log(`  ok   ${label}  [platform=${probe.platform}, root text ${probe.textLen}]`)
      console.log(`         native calls (${probe.nativeCalls.length}): ${summary || 'NONE'}`)
      if (nativeConsole.length) {
        console.log(`         note: ${nativeConsole.length} non-benign console error(s)`)
        nativeConsole.slice(0, 3).forEach((e) => console.log(`           · ${e.slice(0, 220)}`))
      }
    }
    await page.close()
  }

  await browser.close()
  await server.close()

  console.log(`\n─── ${SCENARIOS.length} boots · ${okCount} ok · ${failures.length} failed ───`)
  if (failures.length) { failures.forEach((f) => console.error(`  ✗ ${f}`)); process.exitCode = 1 }
}

main().catch((e) => { fail(`harness crashed: ${e?.stack || e}`) })
