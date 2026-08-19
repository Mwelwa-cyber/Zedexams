#!/usr/bin/env node
/**
 * Layout acceptance for the learner Games hub (/games).
 *
 * The three faults this guards were all INVISIBLE to a unit test, because
 * each is a property of the rendered box model rather than of the markup:
 *
 *   1. Content rendering UNDER the fixed bottom nav. The nav was
 *      translucent and the page reserved no room for it, so "Your games",
 *      the leaderboard link and the first card showed through it.
 *   2. Content under the floating Ask Zed pill, which sat at a hard-coded
 *      96px that predated --lhx-nav-h growing to 76px.
 *   3. Game cards of differing heights — two wrapping chips made one card
 *      ~40px taller than its neighbours, so the list stepped.
 *
 * Run: npm run smoke:games-hub   (part of `npm run smoke`, which builds
 * first; it serves dist/ through vite preview exactly as the mobile smoke
 * does)
 *
 * NAMED `smoke:`, NOT `test:`, and that is load-bearing rather than
 * cosmetic. scripts/run-all-tests.mjs auto-discovers EVERY `test:*` script
 * whose command starts with `node` and runs it as part of `test:all` — a
 * suite that never builds. Registered as `test:games-hub-layout`, this file
 * was picked up there and failed the required Tests job on `dist/ is
 * missing`, despite a comment in this very header claiming it was excluded.
 * A comment is not a mechanism; the namespace is. `smoke:mobile` and
 * `smoke:dashboard` are the same shape for the same reason.
 */
import { preview } from 'vite'
import puppeteer from 'puppeteer'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.GAMES_HUB_SHOTS || join(ROOT, 'tmp-games-hub-shots')

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
]
const THEMES = ['light', 'night']

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('[games-hub] dist/ is missing — run `npm run build` (or `npm run smoke:build`) first.')
  process.exit(1)
}
mkdirSync(SHOTS, { recursive: true })

const server = await preview({
  root: ROOT,
  preview: { port: 0, strictPort: false, host: '127.0.0.1' },
})
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
console.log(`[games-hub] preview at ${base}`)

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})

let failures = 0
const rows = []

try {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      // An isolated context per state. Pages from browser.newPage() share
      // the default context's localStorage, so the Night run's stored theme
      // leaked into the next LIGHT run — which then rendered midnight and
      // was reported as a light pass. Two states, one appearance, no
      // warning: exactly the class of quiet wrongness this file exists to
      // catch, so the harness must not commit it either.
      const ctx = await browser.createBrowserContext()
      const page = await ctx.newPage()
      await page.setViewport({ width: vp.width, height: vp.height })
      // The reading theme is a per-device preference, so it has to be in
      // storage before the app boots.
      await page.evaluateOnNewDocument((t) => {
        try {
          // `examprep:theme` is ThemeContext's LS_KEY, and `midnight` is the
          // dark reading theme (DARK_THEME_IDS). Guessed keys here would
          // render LIGHT twice and report a Night pass for a state never
          // actually drawn — so this is read from the context, not invented.
          if (t === 'night') localStorage.setItem('examprep:theme', 'midnight')
          // Dismiss the first-visit tour. It is a full-screen scrim, so on a
          // fresh profile it covers the very layout under test — and every
          // real learner past their first visit sees the page without it.
          localStorage.setItem('zedexams:games-onboarded', '1')
        } catch { /* storage may be disabled */ }
      }, theme)

      // `domcontentloaded`, not `networkidle0` — the same choice the mobile
      // smoke makes. The app holds Firebase listeners open and retries them
      // against the smoke build's placeholder config, so the network never
      // goes idle and networkidle0 times out on a page that rendered fine.
      await page.goto(`${base}/games`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      // The hub is lazy-loaded and fetches before it lists, so wait for a
      // real card rather than a fixed delay.
      await page.waitForSelector('.ghx-game', { timeout: 30000 })
      await new Promise((r) => setTimeout(r, 800))
      // The overlap only shows at the END of the list — which is precisely
      // where the old page hid cards behind the chrome.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await new Promise((r) => setTimeout(r, 700))

      const r = await page.evaluate(() => {
        const de = document.documentElement
        const cards = [...document.querySelectorAll('.ghx-game')]
        const heights = cards.map((c) => c.offsetHeight)
        const nav = document.querySelector('.lhx-nav')
        const fab = document.querySelector('.lhx-zed-fab')
        const hit = (a, b) => a && b &&
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
        // CONTENT only — fixed chrome is allowed to occupy its own space.
        // CONTENT means elements in the normal flow. A `position: fixed`
        // full-screen overlay (a modal scrim, a toast rail) covers the nav
        // by design and is not the bug being hunted — the bug is a CARD
        // that scrolls under fixed chrome and cannot be scrolled clear.
        const content = [...document.querySelectorAll('.lhx-page *')].filter((el) => {
          if (el.closest('.lhx-nav') || el.closest('.lhx-zed-fab')) return false
          if (el.getBoundingClientRect().height <= 0) return false
          for (let n = el; n && n !== document.body; n = n.parentElement) {
            if (getComputedStyle(n).position === 'fixed') return false
          }
          return true
        })
        const under = (chrome) => {
          if (!chrome) return []
          const rect = chrome.getBoundingClientRect()
          return content
            .filter((el) => hit(el.getBoundingClientRect(), rect))
            .map((el) => String(el.className || el.tagName).slice(0, 44))
            .slice(0, 5)
        }
        return {
          bodyTheme: (String(document.body.className).match(/theme-[\w-]+/) || ['none'])[0],
          overflow: de.scrollWidth - de.clientWidth,
          cardCount: cards.length,
          heights: [...new Set(heights)],
          uniform: heights.length ? heights.every((h) => h === heights[0]) : true,
          navPresent: Boolean(nav),
          fabPresent: Boolean(fab),
          underNav: under(nav),
          underFab: under(fab),
        }
      })

      const label = `${vp.name}/${theme}`
      const bad = []
      if (r.overflow !== 0) bad.push(`horizontal overflow ${r.overflow}px`)
      if (!r.uniform) bad.push(`card heights differ: ${r.heights.join(', ')}`)
      if (r.underNav.length) bad.push(`under nav: ${r.underNav.join(' , ')}`)
      if (r.underFab.length) bad.push(`under Ask Zed: ${r.underFab.join(' , ')}`)
      // A theme that silently failed to apply would mean two identical
      // light runs reported as light AND night.
      if (theme === 'night' && r.bodyTheme !== 'theme-midnight') {
        bad.push(`night theme did not apply (body is ${r.bodyTheme})`)
      }
      if (theme === 'light' && r.bodyTheme === 'theme-midnight') {
        bad.push('light run rendered the dark theme — state leaked between runs')
      }
      if (bad.length) failures += 1
      rows.push({ label, r, verdict: bad.length ? `FAIL — ${bad.join(' | ')}` : 'pass' })

      await page.screenshot({ path: join(SHOTS, `games-${vp.name}-${theme}-bottom.png`) })
      await page.evaluate(() => window.scrollTo(0, 0))
      await new Promise((r) => setTimeout(r, 400))
      await page.screenshot({ path: join(SHOTS, `games-${vp.name}-${theme}-top.png`) })
      await page.close()
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}

for (const { label, r, verdict } of rows) {
  console.log(
    `  ${label.padEnd(15)} overflow=${String(r.overflow).padStart(3)}  ` +
    `cards=${r.cardCount} heights=[${r.heights.join(',')}]  ` +
    `nav=${r.navPresent} fab=${r.fabPresent} ${r.bodyTheme.padEnd(15)} ${verdict}`,
  )
}
console.log(`\nscreenshots: ${SHOTS}`)
if (failures) {
  console.error(`\n✖ ${failures} of ${rows.length} states FAILED`)
  process.exit(1)
}
console.log(`\n─── ${rows.length} states · all pass ───`)
