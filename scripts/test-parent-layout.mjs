#!/usr/bin/env node
/**
 * The parent app's layout, measured in a real browser.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * Every /family screen was unusable on a phone, and every symptom came
 * from one line of markup:
 *
 *   <img src="/zedexams-logo.webp" alt="ZedExams" height="28" />
 *
 * `@tailwind base` declares `img { height: auto }` at author level, which
 * outranks the `height` presentational hint — so the logo rendered at its
 * intrinsic 312x384. On desktop it pushed "Good evening" below the fold;
 * on a 390px phone it filled the first screen AND, sitting in a
 * non-wrapping flex row beside a `white-space: nowrap` role pill, made the
 * document wider than the viewport. That is where "Paren…", the clipped
 * "Acc" tab label and the half-off-screen Ask Zed pill came from: one
 * unsized image, four bug reports.
 *
 * None of it is visible to a unit test. jsdom has no layout engine, so
 * `scrollWidth`, `getBoundingClientRect` and "above the fold" are all
 * unanswerable there — which is exactly why the bug shipped past a suite
 * with a spec for this very screen.
 *
 * ── How it gets a signed-in parent screen without signing in ────────
 *
 * It does not render the app. `src/features/parentPortal/__layout__/`
 * dumps the REAL components' markup from Vitest, and this loads that
 * markup with the REAL built stylesheets. So the class names, the DOM
 * shape and the CSS are the product's; only the data is a fixture.
 *
 * Run: npm run layout:parent
 *
 * It builds what it needs (`vite build` + the markup dump) if missing.
 *
 * Named `layout:*` rather than `test:*` ON PURPOSE: `test:all` auto-runs
 * every `test:` script that is a `node` command, and this one wants a
 * production build and a real Chromium. It sits beside `npm run smoke`,
 * which is out of `test:all` for exactly the same reason.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'dist')
const DUMP = join(ROOT, 'node_modules', '.cache', 'parent-layout')

/** Phone widths that actually reach us, plus a desktop. */
const PHONE_WIDTHS = [360, 390, 430]
const DESKTOP_WIDTH = 1440
const VIEWPORT_HEIGHT = 780

// The sidebar breakpoint in learnerTheme.css. Below it the bottom nav is
// the navigation; at or above it the nav is a fixed left sidebar and the
// top-bar brand is redundant.
const SIDEBAR_BREAKPOINT = 1000

function run(cmd, args, env = {}) {
  execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
}

function ensureBuild() {
  if (existsSync(join(DIST, 'assets'))) return
  console.log('· no dist/ — building once so the harness has the real CSS')
  run('npx', ['vite', 'build', '--mode', 'smoke'])
}

function ensureMarkup() {
  if (existsSync(join(DUMP, 'home.html'))) return
  console.log('· dumping the real component markup')
  mkdirSync(DUMP, { recursive: true })
  run('npx', [
    'vitest', 'run',
    'src/features/parentPortal/__layout__/dumpParentMarkup.spec.jsx',
  ], { PARENT_LAYOUT_DUMP: DUMP })
}

/** Every built stylesheet, concatenated — Tailwind preflight included. */
function collectCss() {
  const dir = join(DIST, 'assets')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
}

/**
 * Inline every root-relative asset the markup references as a data URI.
 *
 * Without this the harness cannot see an image-sizing bug AT ALL, which
 * is the one it exists for: `setContent` gives the page an `about:blank`
 * base, so `/zedexams-logo.webp` never loads, the <img> has no intrinsic
 * size, and it lays out 0x0 — the exact opposite of the 312x384 that
 * broke the product. A harness that renders the broken markup and reports
 * green is worse than no harness.
 */
function inlineAssets(markup) {
  return markup.replace(/src="(\/[^"]+\.(?:webp|png|jpg|jpeg|svg))"/g, (whole, path) => {
    const file = join(ROOT, 'public', path.replace(/^\//, ''))
    if (!existsSync(file)) return whole
    const type = path.endsWith('.svg') ? 'image/svg+xml' :
      path.endsWith('.png') ? 'image/png' :
        path.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    return `src="data:${type};base64,${readFileSync(file).toString('base64')}"`
  })
}

function page(markup, css) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0}</style>
<style>${css}</style>
</head><body>${inlineAssets(markup)}</body></html>`
}

const failures = []
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}`)
  } else {
    console.log(`  ✗ ${label}`)
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  ensureBuild()
  ensureMarkup()

  const puppeteer = require('puppeteer')
  const css = collectCss()
  const markup = {
    home: readFileSync(join(DUMP, 'home.html'), 'utf8'),
    children: readFileSync(join(DUMP, 'children.html'), 'utf8'),
  }

  const launch = { args: ['--no-sandbox', '--disable-dev-shm-usage'] }
  // Prefer the pre-installed Chromium when there is one (CI images and
  // this container ship it); fall back to puppeteer's own download.
  const preinstalled = process.env.PUPPETEER_EXECUTABLE_PATH ||
    ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
        .find((p) => existsSync(p))
  if (preinstalled) launch.executablePath = preinstalled

  const browser = await puppeteer.launch(launch)
  try {
    const tab = await browser.newPage()

    for (const width of PHONE_WIDTHS) {
      console.log(`\nphone · ${width}px`)
      await tab.setViewport({ width, height: VIEWPORT_HEIGHT, deviceScaleFactor: 2 })

      for (const [name, html] of Object.entries(markup)) {
        await tab.setContent(page(html, css), { waitUntil: 'load' })
        // Fonts change metrics; measuring before they settle measures
        // fallback text and moves every boundary by a line. Images the
        // same, and harder: an <img> that has not decoded yet lays out
        // 0x0, which is indistinguishable from a correctly sized one.
        await tab.evaluate(() => Promise.all([
          document.fonts?.ready,
          ...[...document.images].filter((i) => !i.complete)
              .map((i) => i.decode().catch(() => {})),
        ]))

        const m = await tab.evaluate((navBreakpoint) => {
          const q = (s) => document.querySelector(s)
          const box = (el) => (el ? el.getBoundingClientRect() : null)
          const brand = q('.pax-brand')
          const pill = q('.pax-role-pill')
          const nav = q('.lhx-nav')
          const navItems = [...document.querySelectorAll('.lhx-nav-item')]
          const greeting = q('.pax-greet')
          const column = q('.lhx-page')

          // The bottom-most thing the page actually draws. Measured over
          // every descendant rather than "the last child", because the
          // last child is often a spacer and the tallest content can be
          // nested several levels down.
          const contentBottom = column ?
            [...column.querySelectorAll('*')]
                .map((el) => el.getBoundingClientRect())
                .filter((r) => r.height > 0)
                .reduce((max, r) => Math.max(max, r.bottom), -Infinity) :
            null

          // Does any element stick out past the viewport's right edge?
          // `body.scrollWidth` alone says THAT it overflows; naming the
          // widest element says what to fix.
          const widest = [...document.querySelectorAll('*')]
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter(({ r }) => r.width > 0 && r.right > window.innerWidth + 0.5)
              .sort((a, b) => b.r.right - a.r.right)[0]

          // A label is clipped when the text it wants is wider than the
          // box it has. `scrollWidth > clientWidth` is that, exactly.
          const clipped = [pill, ...navItems.map((n) => n.querySelector('span'))]
              .filter(Boolean)
              .filter((el) => el.scrollWidth > el.clientWidth + 0.5)
              .map((el) => el.textContent.trim())

          return {
            bodyScrollWidth: document.body.scrollWidth,
            docScrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            navBreakpoint,
            brandHeight: box(brand)?.height ?? null,
            navHeight: box(nav)?.height ?? null,
            navTop: box(nav)?.top ?? null,
            greetingTop: box(greeting)?.top ?? null,
            // The nav is FIXED to the bottom of the screen, so "behind
            // the nav" cannot be a comparison against the nav's own top —
            // that moves as you scroll. What has to hold is that the page
            // column RESERVES the nav's height below its last content,
            // which is exactly what `.lhx-page`'s bottom padding is for.
            // So: how much empty space is there between the last drawn
            // pixel and the bottom of the column?
            reservedBelowContent: (column && Number.isFinite(contentBottom)) ?
              box(column).bottom - contentBottom : null,
            overflowingElement: widest ?
              `${widest.el.tagName.toLowerCase()}.${(widest.el.className || '').toString().split(' ')[0]} (right ${Math.round(widest.r.right)}px)` :
              null,
            clipped,
          }
        }, SIDEBAR_BREAKPOINT)

        // 12b — no horizontal scroll, and nothing hanging off the edge.
        check(
          `${name}: document is no wider than the viewport`,
          m.bodyScrollWidth <= m.innerWidth && m.docScrollWidth <= m.innerWidth,
          `body ${m.bodyScrollWidth}px / doc ${m.docScrollWidth}px vs viewport ${m.innerWidth}px; widest overflow: ${m.overflowingElement || 'none'}`,
        )

        // 12b — the "Paren…" / "Acc" symptoms, named directly.
        check(
          `${name}: no clipped chip or nav label`,
          m.clipped.length === 0,
          `clipped: ${m.clipped.join(', ')}`,
        )

        // 1 / 12a — the brand is a header logo, not a hero image.
        if (m.brandHeight != null) {
          check(
            `${name}: the brand mark is header-sized (≤40px)`,
            m.brandHeight <= 40,
            `${Math.round(m.brandHeight)}px tall — Tailwind preflight beats the height attribute; size it in CSS`,
          )
        }

        // 1 / 12a — the greeting is the first thing a parent reads.
        if (name === 'home') {
          check(
            'home: the greeting is above the fold',
            m.greetingTop != null && m.greetingTop < VIEWPORT_HEIGHT,
            `greeting at ${Math.round(m.greetingTop)}px, viewport ${VIEWPORT_HEIGHT}px`,
          )
        }

        // 12c — the last thing on the page is not behind the tab bar.
        // The nav is `position: fixed`, so the page has to RESERVE its
        // height in padding; `.lhx-page`'s bottom padding is that reserve.
        check(
          `${name}: the page reserves room for the bottom nav`,
          m.reservedBelowContent != null && m.navHeight != null &&
            m.reservedBelowContent >= m.navHeight,
          `only ${Math.round(m.reservedBelowContent ?? -1)}px of clearance below the last content, and the nav is ${Math.round(m.navHeight ?? 0)}px tall`,
        )
      }
    }

    console.log(`\ndesktop · ${DESKTOP_WIDTH}px`)
    await tab.setViewport({ width: DESKTOP_WIDTH, height: VIEWPORT_HEIGHT })
    await tab.setContent(page(markup.home, css), { waitUntil: 'load' })
    await tab.evaluate(() => Promise.all([
      document.fonts?.ready,
      ...[...document.images].filter((i) => !i.complete)
          .map((i) => i.decode().catch(() => {})),
    ]))

    const d = await tab.evaluate(() => {
      const brand = document.querySelector('.pax-brand')
      const greeting = document.querySelector('.pax-greet')
      return {
        brandVisible: brand ? getComputedStyle(brand).display !== 'none' : false,
        brandHeight: brand ? brand.getBoundingClientRect().height : null,
        greetingTop: greeting ? greeting.getBoundingClientRect().top : null,
        bodyScrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
      }
    })

    // 1 — the sidebar already carries the brand at this width, so the
    // top-bar copy is redundant and only steals height from the content.
    check(
      'desktop: the top-bar brand is hidden (the sidebar carries it)',
      !d.brandVisible,
      `brand still ${Math.round(d.brandHeight || 0)}px tall in the content column`,
    )
    check(
      'desktop: the greeting is above the fold',
      d.greetingTop != null && d.greetingTop < VIEWPORT_HEIGHT,
      `greeting at ${Math.round(d.greetingTop)}px`,
    )
    check(
      'desktop: no horizontal scroll',
      d.bodyScrollWidth <= d.innerWidth,
      `${d.bodyScrollWidth}px vs ${d.innerWidth}px`,
    )
  } finally {
    await browser.close()
  }

  if (failures.length) {
    console.error('\n✗ parent layout\n')
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log('\n✓ parent layout: no overflow, no clipping, greeting above the fold, nothing behind the nav')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
