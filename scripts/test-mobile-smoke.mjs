#!/usr/bin/env node
/* global console, process, document, navigator */
/**
 * Mobile smoke test for the core PUBLIC routes.
 *
 * Release-safety layer (Phase 1): this is the browser-based companion to the
 * static scripts/test-public-routes.mjs. Where that one parses App.jsx to prove
 * the routes are *declared* public, this one actually boots the built app in a
 * phone-sized headless Chromium and proves each route *renders* — no white
 * screen, no ErrorBoundary crash card, real content in #root, and no gross
 * horizontal overflow that would make the page unusable on a phone.
 *
 * Scope is deliberately the signed-out public surface a first-time visitor on a
 * phone hits before they have an account:
 *     /  /login  /register  /papers  /pricing
 *
 * Why it is NOT a `test:*` script (so run-all-tests.mjs / `npm run test:all`
 * never picks it up): it needs a `dist/` build AND a real Chromium, neither of
 * which the plain-node suite has. It runs as its own CI job (see ci.yml) after
 * `npm run build`, mirroring how the Firestore-rules emulator tests run in their
 * own job. Locally:  npm run build && npm run smoke:mobile
 *
 * It runs WITHOUT real Firebase secrets on purpose — the public marketing
 * surface must render from static chrome alone. Backend calls (auth/Firestore)
 * fail in the background and log console errors; those are reported but do not
 * fail the smoke. The hard failures are the ones a real phone visitor would
 * see: an uncaught exception (white screen), the crash card, an empty shell, a
 * non-2xx/3xx response, or a page wider than the viewport.
 *
 * Modelled on scripts/prerender.mjs (same vite preview + puppeteer plumbing).
 */
import { preview } from 'vite'
import puppeteer from 'puppeteer'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'dist')

// The signed-out public surface every first-time mobile visitor lands on.
const ROUTES = ['/', '/login', '/register', '/papers', '/pricing']

const NAV_TIMEOUT_MS = 30_000
// Minimum visible text in #root before we trust the route actually painted
// (guards against snapshotting an empty SPA shell or a crash screen).
const MIN_ROOT_TEXT = 120
// A page wider than the viewport by more than this many CSS px means real
// horizontal overflow — content a phone user has to scroll sideways to read.
// A few px of slop absorbs sub-pixel rounding and overlay scrollbars.
const MAX_OVERFLOW_PX = 16

// iPhone-12-class viewport: the most common phone footprint for Zambian
// learners hitting the site on mobile data.
const MOBILE_VIEWPORT = {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

// ErrorBoundary (src/shared/components/ErrorBoundary.jsx) renders one of these
// headings when a render throws. Seeing either means the route crashed.
const CRASH_MARKERS = [
  'We hit a snag loading this page',
  "We can't reach the network right now", // offline variant
  'Something went wrong',
]

// Uncaught errors that are EXPECTED when the smoke runs against the FAKE
// Firebase project in .env.smoke: every backend call (auth, installations,
// performance, messaging, Firestore) is rejected because the project/key
// aren't real. In CI, egress reaches Google and the fake key returns a clean
// `400 INVALID_ARGUMENT` from Firebase Installations (kicked off by
// getPerformance/getMessaging at init), which surfaces as an uncaught
// rejection; locally, egress is cert-blocked and the same failure shows up as
// a console error instead. Both are connectivity noise, not render bugs, so
// they don't fail the smoke. A genuine render-time exception (TypeError, React
// error, "Cannot read properties of …") is NOT on this list and still fails.
// `auth/invalid-api-key` is deliberately absent — it means the key was empty/
// malformed and the app white-screened, which we DO want to catch.
const BENIGN_PAGE_ERROR = new RegExp(
  [
    'installations/',
    'API key not valid',
    'network-request-failed',
    'messaging/',
    'permission-denied',
    'Failed to fetch',
    'INVALID_ARGUMENT',
    'ERR_CERT', // local cert-blocked egress variant
    'ERR_NETWORK',
  ].join('|'),
)

async function checkRoute(browser, base, route) {
  const page = await browser.newPage()
  await page.emulate({ viewport: MOBILE_VIEWPORT, userAgent: MOBILE_UA })

  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (err) => pageErrors.push(err?.message || String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  const problems = []
  try {
    const response = await page.goto(`${base}${route}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    })
    const status = response ? response.status() : 0
    if (status >= 400) problems.push(`HTTP ${status}`)

    // Wait for React to paint real content into #root.
    try {
      await page.waitForFunction(
        (min) => {
          const root = document.getElementById('root')
          return !!root && (root.innerText || '').trim().length >= min
        },
        { timeout: NAV_TIMEOUT_MS },
        MIN_ROOT_TEXT,
      )
    } catch {
      // fall through — the metrics snapshot below records how little rendered
    }
    // Small settle for any post-paint layout (fonts, lazy chrome).
    await new Promise((r) => setTimeout(r, 250))

    const { rootText, bodyText, overflowPx, viewportWidth } = await page.evaluate(() => {
      const root = document.getElementById('root')
      const doc = document.documentElement
      return {
        rootText: (root?.innerText || '').trim().length,
        bodyText: (document.body?.innerText || ''),
        overflowPx: doc.scrollWidth - doc.clientWidth,
        viewportWidth: doc.clientWidth,
      }
    })

    if (rootText < MIN_ROOT_TEXT) {
      problems.push(`only ${rootText} chars rendered in #root (empty/crash shell?)`)
    }
    const crash = CRASH_MARKERS.find((m) => bodyText.includes(m))
    if (crash) problems.push(`crash card shown ("${crash}")`)
    // Only a NON-benign uncaught error fails the smoke. Firebase backend
    // rejections (fake project) are expected and reported as info below.
    const realErrors = pageErrors.filter((e) => !BENIGN_PAGE_ERROR.test(e))
    if (realErrors.length) {
      problems.push(`uncaught error: ${realErrors[0]}`)
    }
    if (overflowPx > MAX_OVERFLOW_PX) {
      problems.push(
        `horizontal overflow ${overflowPx}px past the ${viewportWidth}px viewport`,
      )
    }
  } catch (err) {
    problems.push(err?.message || String(err))
  } finally {
    await page.close()
  }

  return { route, problems, consoleErrors, pageErrors }
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('[mobile-smoke] dist/index.html not found — run `npm run build` first.')
    process.exit(1)
  }

  const server = await preview({
    root: ROOT,
    preview: { port: 0, strictPort: false, host: '127.0.0.1' },
  })
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  console.log(`[mobile-smoke] preview server at ${base}`)
  console.log(`[mobile-smoke] viewport ${MOBILE_VIEWPORT.width}x${MOBILE_VIEWPORT.height} (mobile)`)

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })

  const results = []
  try {
    for (const route of ROUTES) {
      results.push(await checkRoute(browser, base, route))
    }
  } finally {
    await browser.close()
    server.httpServer.close()
  }

  console.log('')
  let failed = 0
  for (const { route, problems, consoleErrors, pageErrors } of results) {
    if (problems.length === 0) {
      console.log(`  ok   ${route}`)
    } else {
      failed += 1
      console.log(`  FAIL ${route}`)
      for (const p of problems) console.log(`         ✗ ${p}`)
    }
    // Console + benign Firebase-backend errors are informational only — the
    // smoke runs against a fake project, so backend calls are expected to
    // error in the background. Surface them for debugging without failing.
    if (consoleErrors.length || pageErrors.length) {
      const first = (consoleErrors[0] || pageErrors[0] || '').slice(0, 140)
      console.log(
        `         (${consoleErrors.length} console + ${pageErrors.length} backend error(s); first: ${first})`,
      )
    }
  }

  console.log('')
  console.log(`─── ${results.length} routes · ${results.length - failed} ok · ${failed} failed ───`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('[mobile-smoke] fatal:', err)
  process.exit(1)
})
