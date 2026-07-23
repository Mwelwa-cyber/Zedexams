#!/usr/bin/env node
/* global console, process, document, window, getComputedStyle, localStorage */
/**
 * Responsive-navigation regression test for Teacher Dashboard V2.
 *
 * Guards the bug where the desktop sidebar rendered on phones and compressed
 * the whole dashboard (search, greeting hero, Quick Create clipped off the
 * right edge). Boots the built app in headless Chromium and walks
 * /teacher/dashboard-preview — the intentionally unguarded, mock-data twin of
 * the live /teacher dashboard, sharing DashboardView + dashboardV2.css — over
 * the full viewport matrix, asserting at each size:
 *
 *   < 768px   mobile IA only: NO desktop sidebar in layout, bottom nav +
 *             compact header visible, content starts at the 16px page
 *             padding (not after a sidebar offset), key surfaces (search,
 *             hero, CTA, Quick Create tiles) fully inside the viewport,
 *             content clears the fixed bottom nav, no horizontal overflow.
 *   768–1023  desktop DOM with the compact icon rail only (≤100px), main
 *             content ≥620px, no mobile bottom nav.
 *   ≥ 1024px  full desktop sidebar, no mobile chrome.
 *
 * Plus a rotation pass (390×844 → 844×390 → back) proving the swap happens
 * live and leaves no stale sidebar spacing.
 *
 * Like scripts/test-mobile-smoke.mjs (whose plumbing this mirrors), it needs
 * a dist/ build and a real Chromium, so it is NOT a `test:*` script — it runs
 * in the "Build + mobile smoke" CI job. Locally:
 *     npm run smoke:build && npm run smoke:dashboard
 * (set PUPPETEER_EXECUTABLE_PATH to reuse a system/Playwright Chromium).
 */
import { preview } from 'vite'
import puppeteer from 'puppeteer'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'dist')

const ROUTE = '/teacher/dashboard-preview'
const NAV_TIMEOUT_MS = 30_000
// A few px of slop absorbs sub-pixel rounding and overlay scrollbars.
const MAX_OVERFLOW_PX = 4

// The regression matrix from the bug report: small → large phones, tablet
// portrait, tablet landscape, laptop.
const VIEWPORTS = [
  { width: 320, height: 568, kind: 'mobile' },
  { width: 360, height: 800, kind: 'mobile' },
  { width: 390, height: 844, kind: 'mobile' },
  { width: 412, height: 915, kind: 'mobile' },
  { width: 768, height: 1024, kind: 'tablet' },
  { width: 1024, height: 768, kind: 'desktop' },
  { width: 1440, height: 900, kind: 'desktop' },
]

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'

function viewportFor({ width, height, kind }) {
  return {
    width,
    height,
    deviceScaleFactor: 2,
    isMobile: kind !== 'desktop',
    hasTouch: kind !== 'desktop',
  }
}

/** Runs in the page: one structural snapshot of the navigation state. */
function snapshotPage() {
  const inLayout = (el) => {
    if (!el) return false
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
  }
  const doc = document.documentElement
  const sidebar = document.querySelector('.tdv2-sidebar')
  const bottomNav = document.querySelector('.tdv2m-bottomnav')
  const header = document.querySelector('.tdv2m-header')
  const mobileContent = document.querySelector('.tdv2m-content')
  const desktopMain = document.querySelector('.tdv2-main')
  const search = document.querySelector('.tdv2m-search') || document.querySelector('.tdv2-search')
  const hero = document.querySelector('.tdv2m-hero') || document.querySelector('.tdv2-hero')
  const cta = document.querySelector('.tdv2m-cta')
  const tiles = [...document.querySelectorAll('.tdv2m-tile')]
  return {
    viewportWidth: doc.clientWidth,
    overflowPx: doc.scrollWidth - doc.clientWidth,
    sidebarInLayout: inLayout(sidebar),
    sidebarWidth: sidebar ? sidebar.getBoundingClientRect().width : 0,
    bottomNavInLayout: inLayout(bottomNav),
    bottomNavHeight: bottomNav ? bottomNav.getBoundingClientRect().height : null,
    headerInLayout: inLayout(header),
    mobileContentRect: rect(mobileContent),
    mobileContentPadBottom: mobileContent?.parentElement
      ? parseFloat(getComputedStyle(mobileContent.parentElement).paddingBottom)
      : null,
    desktopMainRect: rect(desktopMain),
    searchRect: rect(search),
    heroRect: rect(hero),
    ctaRect: rect(cta),
    tileRects: tiles.map((t) => {
      const r = t.getBoundingClientRect()
      return { left: r.left, right: r.right, width: r.width }
    }),
    rootText: (document.getElementById('root')?.innerText || '').trim().length,
  }
}

function checkSnapshot(snap, { width, kind }, problems) {
  const vw = snap.viewportWidth
  if (snap.rootText < 120) {
    problems.push(`only ${snap.rootText} chars rendered (empty/crash shell?)`)
    return
  }
  if (snap.overflowPx > MAX_OVERFLOW_PX) {
    problems.push(`horizontal overflow ${snap.overflowPx}px past the ${vw}px viewport`)
  }

  if (kind === 'mobile') {
    if (snap.sidebarInLayout) {
      problems.push(`desktop sidebar in layout at ${width}px (width ${snap.sidebarWidth}px)`)
    }
    if (!snap.bottomNavInLayout) problems.push('mobile bottom nav missing')
    if (!snap.headerInLayout) problems.push('mobile top bar missing')
    const c = snap.mobileContentRect
    if (!c) {
      problems.push('mobile content column missing')
    } else {
      // Content starts at the mobile page padding — never after a sidebar
      // offset. (12px on ≤350px phones, 16px otherwise; centred ≤560px.)
      if (c.left > Math.max(24, (vw - 560) / 2 + 1)) {
        problems.push(`content left edge at ${Math.round(c.left)}px — sidebar offset leaking?`)
      }
      if (c.right > vw + 1) problems.push(`content right edge ${Math.round(c.right)}px past viewport`)
    }
    for (const [name, r] of [
      ['search field', snap.searchRect],
      ['greeting hero', snap.heroRect],
      ['Continue-plan CTA', snap.ctaRect],
    ]) {
      if (!r) problems.push(`${name} not found`)
      else if (r.right > vw + 1 || r.left < -1) {
        problems.push(`${name} clipped (left ${Math.round(r.left)}, right ${Math.round(r.right)}, viewport ${vw})`)
      }
    }
    if (snap.tileRects.length === 0) problems.push('Quick Create tiles not found')
    for (const r of snap.tileRects) {
      if (r.right > vw + 1) problems.push(`Quick Create tile clipped at ${Math.round(r.right)}px`)
      // Two-up tiles must keep ≥150px; below that the grid must stack.
      if (r.width < 150 && snap.tileRects.some((o) => Math.abs(o.left - r.left) > 8)) {
        problems.push(`Quick Create tile only ${Math.round(r.width)}px wide in a multi-column grid`)
      }
    }
    // Content must clear the fixed bottom nav: the page's bottom padding
    // covers the nav's on-screen height plus 16px breathing room.
    if (snap.bottomNavHeight != null && snap.mobileContentPadBottom != null) {
      if (snap.mobileContentPadBottom < snap.bottomNavHeight + 16 - 1) {
        problems.push(
          `bottom padding ${Math.round(snap.mobileContentPadBottom)}px < nav ${Math.round(snap.bottomNavHeight)}px + 16px — content can sit under the bottom nav`,
        )
      }
    }
  } else {
    if (!snap.sidebarInLayout) problems.push('desktop sidebar missing')
    if (snap.bottomNavInLayout) problems.push('mobile bottom nav visible on a ≥768px viewport')
    if (snap.headerInLayout) problems.push('mobile top bar visible on a ≥768px viewport')
    if (kind === 'tablet') {
      if (snap.sidebarWidth > 100) {
        problems.push(`tablet shows a ${Math.round(snap.sidebarWidth)}px sidebar — expected the compact icon rail`)
      }
      if (snap.desktopMainRect && snap.desktopMainRect.width < 620) {
        problems.push(`tablet content only ${Math.round(snap.desktopMainRect.width)}px wide (<620px)`)
      }
    } else if (snap.sidebarWidth < 120) {
      problems.push(`desktop sidebar only ${Math.round(snap.sidebarWidth)}px wide — expected the full sidebar`)
    }
  }
}

async function waitForPaint(page) {
  await page.waitForFunction(
    () => {
      const root = document.getElementById('root')
      return !!root && (root.innerText || '').trim().length >= 120
    },
    { timeout: NAV_TIMEOUT_MS },
  )
  await new Promise((r) => setTimeout(r, 300))
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('[dashboard-responsive] dist/index.html not found — run `npm run smoke:build` first.')
    process.exit(1)
  }

  const server = await preview({
    root: ROOT,
    preview: { port: 0, strictPort: false, host: '127.0.0.1' },
  })
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  console.log(`[dashboard-responsive] preview server at ${base}`)

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  let failed = 0
  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage()
      // Hermetic run: only the local preview server is reachable. Fonts,
      // Firebase, analytics etc. abort instantly instead of hanging on
      // whatever network CI has — the dashboard must render without them.
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        const { hostname } = new URL(req.url())
        if (hostname === '127.0.0.1' || hostname === 'localhost') req.continue()
        else req.abort()
      })
      // The first-run onboarding tour overlays the dashboard; mark it done so
      // layout assertions see the real chrome.
      await page.evaluateOnNewDocument(() => {
        try {
          localStorage.setItem('zedexams:tdv2-tour', 'done')
        } catch {}
      })
      await page.emulate({
        viewport: viewportFor(vp),
        userAgent: vp.kind === 'desktop' ? undefined : MOBILE_UA,
      })
      const problems = []
      try {
        await page.goto(`${base}${ROUTE}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
        await waitForPaint(page)
        const snap = await page.evaluate(snapshotPage)
        checkSnapshot(snap, vp, problems)

        // Rotation pass on the reference phone: portrait → landscape → back.
        if (vp.width === 390) {
          await page.setViewport(viewportFor({ width: 844, height: 390, kind: 'tablet' }))
          await new Promise((r) => setTimeout(r, 350))
          const land = await page.evaluate(snapshotPage)
          checkSnapshot(land, { width: 844, kind: 'tablet' }, problems)

          await page.setViewport(viewportFor(vp))
          await new Promise((r) => setTimeout(r, 350))
          const back = await page.evaluate(snapshotPage)
          checkSnapshot(back, vp, problems)
          if (back.mobileContentRect && back.mobileContentRect.left > 24) {
            problems.push(
              `stale sidebar spacing after rotation — content left at ${Math.round(back.mobileContentRect.left)}px`,
            )
          }
        }
      } catch (err) {
        problems.push(err?.message || String(err))
      } finally {
        await page.close()
      }

      if (problems.length === 0) {
        console.log(`  ok   ${vp.width}x${vp.height} (${vp.kind})`)
      } else {
        failed += 1
        console.log(`  FAIL ${vp.width}x${vp.height} (${vp.kind})`)
        for (const p of problems) console.log(`         ✗ ${p}`)
      }
    }
  } finally {
    await browser.close()
    server.httpServer.close()
  }

  console.log('')
  console.log(`─── ${VIEWPORTS.length} viewports · ${VIEWPORTS.length - failed} ok · ${failed} failed ───`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('[dashboard-responsive] fatal:', err)
  process.exit(1)
})
