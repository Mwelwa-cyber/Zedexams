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
 *   < 768px   mobile IA only: NO desktop sidebar in layout, floating dock +
 *             Quick Create button + compact header visible, content starts
 *             at the 16px page padding (not after a sidebar offset), key
 *             surfaces (hero, checklist, recently-used tiles, All Teacher
 *             Tools card) fully inside the viewport, content clears the
 *             floating dock, no horizontal overflow.
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
  const dockBar = document.querySelector('.tdv2m-dockbar')
  const dockPlus = document.querySelector('.tdv2m-dock-plus')
  const header = document.querySelector('.tdv2m-header')
  const mobileContent = document.querySelector('.tdv2m-content')
  const desktopMain = document.querySelector('.tdv2-main')
  const hero = document.querySelector('.tdv2m-hero') || document.querySelector('.tdv2-hero')
  const planPill = document.querySelector('.tdv2m-plan-pill')
  const checklist = document.querySelector('.tdv2m-check')
  const allTools = document.querySelector('.tdv2m-alltools')
  const tiles = [...document.querySelectorAll('.tdv2m-recent-tool')]
  return {
    viewportWidth: doc.clientWidth,
    overflowPx: doc.scrollWidth - doc.clientWidth,
    sidebarInLayout: inLayout(sidebar),
    sidebarWidth: sidebar ? sidebar.getBoundingClientRect().width : 0,
    bottomNavInLayout: inLayout(dockBar),
    bottomNavHeight: dockBar ? dockBar.getBoundingClientRect().height : null,
    dockPlusRect: rect(dockPlus),
    headerInLayout: inLayout(header),
    mobileContentRect: rect(mobileContent),
    mobileContentPadBottom: mobileContent?.parentElement
      ? parseFloat(getComputedStyle(mobileContent.parentElement).paddingBottom)
      : null,
    desktopMainRect: rect(desktopMain),
    heroRect: rect(hero),
    heroHeight: hero ? hero.getBoundingClientRect().height : null,
    planPillRect: rect(planPill),
    checklistRect: rect(checklist),
    allToolsRect: rect(allTools),
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
    if (!snap.bottomNavInLayout) problems.push('floating dock missing')
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
      ['greeting hero', snap.heroRect],
      ['plan pill', snap.planPillRect],
      ['weekly checklist', snap.checklistRect],
      ['All Teacher Tools card', snap.allToolsRect],
      ['Quick Create button', snap.dockPlusRect],
    ]) {
      if (!r) problems.push(`${name} not found`)
      else if (r.right > vw + 1 || r.left < -1) {
        problems.push(`${name} clipped (left ${Math.round(r.left)}, right ${Math.round(r.right)}, viewport ${vw})`)
      }
    }
    // Hero stays compact — the design targets ~220–260px.
    if (snap.heroHeight != null && snap.heroHeight > 300) {
      problems.push(`hero ${Math.round(snap.heroHeight)}px tall — expected a compact (~220–260px) hero`)
    }
    // The Quick Create button must be a real touch target.
    if (snap.dockPlusRect && snap.dockPlusRect.width < 44) {
      problems.push(`Quick Create button only ${Math.round(snap.dockPlusRect.width)}px wide (<44px)`)
    }
    // Recently-used tools: up to four tiles, four per row, none clipped.
    if (snap.tileRects.length === 0) problems.push('recently-used tool tiles not found')
    if (snap.tileRects.length > 4) problems.push(`${snap.tileRects.length} recently-used tiles — max is 4`)
    for (const r of snap.tileRects) {
      if (r.right > vw + 1) problems.push(`recently-used tile clipped at ${Math.round(r.right)}px`)
    }
    // Content must clear the floating dock: the page's bottom padding
    // covers the dock's on-screen height plus 16px breathing room.
    if (snap.bottomNavHeight != null && snap.mobileContentPadBottom != null) {
      if (snap.mobileContentPadBottom < snap.bottomNavHeight + 16 - 1) {
        problems.push(
          `bottom padding ${Math.round(snap.mobileContentPadBottom)}px < dock ${Math.round(snap.bottomNavHeight)}px + 16px — content can sit under the dock`,
        )
      }
    }
  } else {
    if (!snap.sidebarInLayout) problems.push('desktop sidebar missing')
    if (snap.bottomNavInLayout) problems.push('floating dock visible on a ≥768px viewport')
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

/**
 * Semantic readiness gate for a dashboard page. Replaces the old "text +
 * fixed 300ms" wait, which sampled the sidebar before the lazily-loaded
 * dashboardV2 stylesheet was applied and the CSS grid had laid the sidebar
 * out. The sidebar's width comes entirely from the grid track in
 * `.tdv2 { display: grid; grid-template-columns: 248px minmax(0,1fr) }`
 * (dashboardV2.css, imported by the lazy /teacher/dashboard-preview chunk),
 * so in the brief window after the JSX renders text but before that
 * stylesheet is live and the grid has run, `.tdv2-sidebar` measures 0px.
 * Under CI load that window sometimes outlasts the fixed 300ms — the
 * intermittent "desktop sidebar missing / 0px wide" failure.
 *
 * Instead we wait for the exact conditions the assertions depend on, each
 * bounded by NAV_TIMEOUT_MS and resolving as soon as it holds (no sleep):
 *   1. the shell rendered real content (not a crash/empty shell);
 *   2. the dashboardV2 stylesheet is live — the `.tdv2` root exposes its
 *      design-system custom property (`--ease`), proving the rule block
 *      (and thus the grid) has applied;
 *   3. the viewport's primary nav has a settled, correctly-sized box.
 */
async function waitForDashboardReady(page, vp) {
  await page.waitForFunction(
    () => {
      const root = document.getElementById('root')
      return !!root && (root.innerText || '').trim().length >= 120
    },
    { timeout: NAV_TIMEOUT_MS, polling: 'raf' },
  )
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.tdv2')
      if (!el) return false
      // --ease is defined on the .tdv2 rule block; a non-empty computed value
      // means dashboardV2.css has been applied (grid layout is in effect).
      return getComputedStyle(el).getPropertyValue('--ease').trim() !== ''
    },
    { timeout: NAV_TIMEOUT_MS, polling: 'raf' },
  )
  await waitForNavSettled(page, vp)
}

/**
 * Wait until the viewport's primary nav element has a stable, correctly-sized
 * box, so a measurement never races an un-laid-out 0px box or an in-flight
 * transition. "Settled" = the same width across two consecutive animation
 * frames.
 *   • desktop → the full sidebar, width >= 120px (matches the assertion floor)
 *   • tablet  → the compact sidebar rail, just needs to be laid out (>1px)
 *   • mobile  → the floating dock (the desktop sidebar is display:none here)
 */
async function waitForNavSettled(page, vp) {
  const selector = vp.kind === 'mobile' ? '.tdv2m-dockbar' : '.tdv2-sidebar'
  const minWidth = vp.kind === 'desktop' ? 120 : 1
  // Reset the cross-call stability marker so we always require two FRESH frames.
  await page.evaluate((sel) => {
    try { delete window['__tdv2_settle_' + sel] } catch {}
  }, selector)
  await page.waitForFunction(
    (sel, minW) => {
      const el = document.querySelector(sel)
      if (!el) return false
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') return false
      const w = el.getBoundingClientRect().width
      const h = el.getBoundingClientRect().height
      const key = '__tdv2_settle_' + sel
      const prev = window[key]
      window[key] = w
      return w > minW && h > 0 && prev !== undefined && Math.abs(prev - w) < 0.5
    },
    { timeout: NAV_TIMEOUT_MS, polling: 'raf' },
    selector,
    minWidth,
  )
}

/**
 * In-page diagnostics captured only when a viewport fails, so an intermittent
 * failure is debuggable from the CI log instead of a bare "0px" line.
 */
function diagnosePage() {
  const rectOf = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: Math.round(r.left), top: Math.round(r.top), width: r.width, height: r.height }
  }
  const sidebar = document.querySelector('.tdv2-sidebar')
  const cs = sidebar ? getComputedStyle(sidebar) : null
  const tdv2 = document.querySelector('.tdv2')
  const persisted = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k) persisted[k] = localStorage.getItem(k)
    }
  } catch {}
  return {
    sidebarClass: sidebar ? sidebar.className : '(no .tdv2-sidebar element)',
    sidebarComputed: cs ? { display: cs.display, visibility: cs.visibility, width: cs.width } : null,
    sidebarRect: rectOf(sidebar),
    tdv2Display: tdv2 ? getComputedStyle(tdv2).display : '(no .tdv2 element)',
    tdv2EaseVar: tdv2 ? getComputedStyle(tdv2).getPropertyValue('--ease').trim() || '(unset)' : null,
    rootTextLen: (document.getElementById('root')?.innerText || '').trim().length,
    persisted,
  }
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
      // Hermetic per-page state. Pages in one browser share this origin's
      // localStorage, so a persisted value from a previous viewport (theme,
      // launcher-group collapse `zedexams:tsl-collapsed`, tour) could skew the
      // next viewport's layout. Clear everything at document start, then mark
      // the first-run onboarding tour done so layout assertions see the real
      // chrome instead of the overlay.
      await page.evaluateOnNewDocument(() => {
        try {
          localStorage.clear()
          localStorage.setItem('zedexams:tdv2-tour', 'done')
        } catch {}
      })
      await page.emulate({
        viewport: viewportFor(vp),
        userAgent: vp.kind === 'desktop' ? undefined : MOBILE_UA,
      })
      const problems = []
      let diag = null
      try {
        await page.goto(`${base}${ROUTE}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
        await waitForDashboardReady(page, vp)
        const snap = await page.evaluate(snapshotPage)
        checkSnapshot(snap, vp, problems)

        // Rotation pass on the reference phone: portrait → landscape → back.
        // After each viewport change wait for the new primary nav to settle
        // (semantic, no fixed sleep) before re-measuring.
        if (vp.width === 390) {
          const landVp = { width: 844, height: 390, kind: 'tablet' }
          await page.setViewport(viewportFor(landVp))
          await waitForNavSettled(page, landVp)
          const land = await page.evaluate(snapshotPage)
          checkSnapshot(land, { width: 844, kind: 'tablet' }, problems)

          await page.setViewport(viewportFor(vp))
          await waitForNavSettled(page, vp)
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
        // Capture diagnostics on failure BEFORE closing the page, so an
        // intermittent flake leaves the viewport size, sidebar classes,
        // computed display/visibility/width, bounding rect and persisted
        // state in the CI log.
        if (problems.length > 0) {
          try {
            diag = await page.evaluate(diagnosePage)
          } catch {}
        }
        await page.close()
      }

      if (problems.length === 0) {
        console.log(`  ok   ${vp.width}x${vp.height} (${vp.kind})`)
      } else {
        failed += 1
        console.log(`  FAIL ${vp.width}x${vp.height} (${vp.kind})`)
        for (const p of problems) console.log(`         ✗ ${p}`)
        if (diag) {
          console.log(`         ── diagnostics (${vp.width}x${vp.height} ${vp.kind}) ──`)
          console.log(`            sidebar class:    ${diag.sidebarClass}`)
          console.log(`            sidebar computed: ${JSON.stringify(diag.sidebarComputed)}`)
          console.log(`            sidebar rect:     ${JSON.stringify(diag.sidebarRect)}`)
          console.log(`            .tdv2 display:    ${diag.tdv2Display}  --ease: ${diag.tdv2EaseVar}`)
          console.log(`            root text length: ${diag.rootTextLen}`)
          console.log(`            persisted state:  ${JSON.stringify(diag.persisted)}`)
        }
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
