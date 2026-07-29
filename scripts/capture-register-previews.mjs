#!/usr/bin/env node
/* global console, process, document, window */
/**
 * Capture the Class List + Class Register previews at real device widths.
 *
 * Boots the built app on a vite preview server and screenshots
 * /teacher/register-preview at each viewport the redesign has to work on, plus
 * the two full-screen flows on their own routes. Output lands in
 * `preview-shots/` (gitignored) with a manifest.
 *
 * NOT a `test:*` script, for the same reason scripts/test-mobile-smoke.mjs
 * isn't: it needs a dist/ build and a real Chromium, neither of which the
 * plain-node suite has. Run it after `npm run smoke:build`:
 *
 *     npm run smoke:build && node scripts/capture-register-previews.mjs
 *
 * It ALSO measures, because a preview that looks right and stutters is not a
 * pass: initial paint, a search keystroke, and a mark-all-present are timed on
 * the 86-learner fixture and printed with the shots. A page wider than its own
 * viewport fails the run — that is the phone-squeezed-desktop failure this
 * redesign exists to avoid, and it is invisible in a screenshot that has been
 * scaled to fit.
 */
import { preview } from 'vite'
import puppeteer from 'puppeteer'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'preview-shots')

const NAV_TIMEOUT_MS = 45_000
const MAX_OVERFLOW_PX = 16

/** The devices this redesign is specified against (§25, §29). */
const DEVICES = [
  { id: 'mobile-small', label: 'Small Android phone', width: 360, height: 780, mobile: true },
  { id: 'mobile', label: 'Standard phone', width: 390, height: 844, mobile: true },
  { id: 'mobile-landscape', label: 'Phone, landscape', width: 844, height: 390, mobile: true },
  { id: 'tablet-portrait', label: 'Tablet, portrait', width: 768, height: 1024, mobile: true },
  { id: 'tablet-landscape', label: 'Tablet, landscape', width: 1024, height: 768, mobile: true },
  { id: 'desktop-1366', label: 'Desktop 1366', width: 1366, height: 900, mobile: false },
  { id: 'desktop-1920', label: 'Desktop 1920', width: 1920, height: 1080, mobile: false },
]

const ROUTES = [
  { id: 'overview', path: '/teacher/register-preview', label: 'All eleven screens' },
  { id: 'capture', path: '/teacher/register-preview/capture', label: 'Multi-page capture' },
  { id: 'review', path: '/teacher/register-preview/review', label: 'Capture review + duplicates' },
]

const CRASH_MARKERS = [
  'We hit a snag loading this page',
  "We can't reach the network right now",
  'Something went wrong',
]

/**
 * Navigate and wait for React to paint real content.
 *
 * Returns the PAINT time, not the settle time. Fonts are given a bounded wait
 * afterwards, because `document.fonts.ready` can sit unresolved for twelve
 * seconds in headless Chromium on a route whose fonts never finish loading —
 * which is a fact about the harness, not about the page, and reporting it as
 * "load time" would have overstated the app's cost by fortyfold. The wait is
 * kept at all because a screenshot taken against fallback metrics shows line
 * breaks the real page does not have.
 */
const FONT_SETTLE_MS = 1500

async function paint(page, base, path) {
  const response = await page.goto(`${base}${path}`, {
    waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS,
  })
  await page.waitForFunction(
    () => {
      const root = document.getElementById('root')
      return !!root && (root.innerText || '').trim().length > 200
    },
    { timeout: NAV_TIMEOUT_MS },
  )
  const paintedAt = Date.now()
  await page.evaluate((budget) => Promise.race([
    document.fonts?.ready ?? Promise.resolve(),
    new Promise((r) => setTimeout(r, budget)),
  ]), FONT_SETTLE_MS)
  return { status: response ? response.status() : 0, paintedAt }
}

/**
 * Time the three interactions a class of 86 makes expensive.
 * Returns null when the controls are not on the page (the flow routes).
 */
const SEARCH_SELECTOR = 'input[aria-label="Search learner"]'

async function measure(page) {
  // WAIT for the control rather than probing once. Probing raced the lazy
  // route chunk, so the same screen reported a timing on some viewports and
  // none on others — an inconsistency that would have made every number in
  // the report untrustworthy without being obviously wrong.
  try {
    await page.waitForSelector(SEARCH_SELECTOR, { timeout: 5000 })
  } catch {
    return null
  }

  const search = await page.evaluate(async () => {
    const input = document.querySelector('input[aria-label="Search learner"]')
    if (!input) return null
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const started = performance.now()
    setter.call(input, 'Mulenga')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const elapsed = performance.now() - started
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => requestAnimationFrame(r))
    return elapsed
  })

  const markAll = await page.evaluate(async () => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Mark all present')
    if (!button) return null
    const started = performance.now()
    button.click()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return performance.now() - started
  })

  return {
    searchMs: search == null ? null : Math.round(search),
    markAllPresentMs: markAll == null ? null : Math.round(markAll),
  }
}

async function shoot(browser, base, device, route) {
  const page = await browser.newPage()
  await page.setViewport({
    width: device.width,
    height: device.height,
    deviceScaleFactor: 2,
    isMobile: device.mobile,
    hasTouch: device.mobile,
  })

  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err?.message || String(err)))

  const problems = []
  let metrics = null
  const started = Date.now()
  let paintMs = null
  try {
    const { status, paintedAt } = await paint(page, base, route.path)
    paintMs = paintedAt - started
    if (status >= 400) problems.push(`HTTP ${status}`)

    const text = await page.evaluate(() => document.getElementById('root')?.innerText || '')
    for (const marker of CRASH_MARKERS) {
      if (text.includes(marker)) problems.push(`crash card: ${marker}`)
    }

    // A page wider than its own viewport is the squeezed-desktop failure.
    const overflow = await page.evaluate(() => Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth, 0,
    ))
    if (overflow > MAX_OVERFLOW_PX) problems.push(`horizontal overflow ${overflow}px`)

    metrics = await measure(page)

    // Dismiss the analytics-consent banner the way a reviewer would. It is
    // real app chrome and belongs on these routes; it also sits over the
    // footer, which is where Finish scanning and the confirm button live —
    // so a screenshot taken with it up hides the two controls the preview
    // exists to show. Suppressing it in the app for preview paths was the
    // other option and is worse: consent behaviour is not a thing to special
    // case for convenience.
    await page.evaluate(() => {
      const decline = [...document.querySelectorAll('button')]
        .find((b) => b.textContent.trim() === 'No thanks')
      if (decline) decline.click()
    })
    await new Promise((r) => setTimeout(r, 200))

    const file = join(OUT, `${route.id}--${device.id}.png`)
    await page.screenshot({ path: file, fullPage: true })
    problems.push(...pageErrors.map((e) => `page error: ${e}`))

    return {
      route: route.id, device: device.id, file, problems,
      paintMs, totalMs: Date.now() - started, metrics,
    }
  } catch (err) {
    return {
      route: route.id, device: device.id, file: null,
      problems: [`failed: ${err.message}`], paintMs, totalMs: Date.now() - started, metrics,
    }
  } finally {
    await page.close()
  }
}

async function main() {
  if (!existsSync(DIST)) {
    console.error('[previews] no dist/ — run `npm run smoke:build` first.')
    process.exit(1)
  }
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const server = await preview({
    root: ROOT,
    preview: { port: 0, strictPort: false, host: '127.0.0.1' },
  })
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  console.log(`[previews] serving ${base}`)

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  })

  const results = []
  try {
    for (const route of ROUTES) {
      for (const device of DEVICES) {
        const result = await shoot(browser, base, device, route)
        results.push(result)
        const status = result.problems.length ? `FAIL ${result.problems.join('; ')}` : 'ok'
        const timing = result.metrics
          ? ` search ${result.metrics.searchMs}ms · mark-all ${result.metrics.markAllPresentMs}ms`
          : ''
        console.log(`  ${status.padEnd(6)} ${route.id}/${device.id} — paint ${result.paintMs}ms${timing}`)
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }

  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    devices: DEVICES,
    routes: ROUTES,
    results,
  }, null, 2)}\n`)

  const failed = results.filter((r) => r.problems.length)
  console.log(`\n${results.length - failed.length} of ${results.length} previews captured cleanly.`)
  console.log(`Shots in ${OUT}`)
  if (failed.length) {
    console.log('\nProblems:')
    for (const r of failed) console.log(`  ${r.route}/${r.device}: ${r.problems.join('; ')}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[previews] failed:', err)
  process.exit(1)
})
