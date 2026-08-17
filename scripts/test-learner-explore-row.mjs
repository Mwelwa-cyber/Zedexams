#!/usr/bin/env node
/* global console, process, document, window, getComputedStyle, CSS */
/**
 * Layout regression test for the learner Home "Explore" row.
 *
 * The rule it guards is one sentence: Explore is THREE TILES IN ONE
 * HORIZONTAL ROW at every width — phone, tablet and desktop alike.
 *
 * What it replaced: the grid was two-up, so Games wrapped onto a second row
 * and sat alone under the other two. That happened on desktop as well as on a
 * phone, because the ≥1000px `repeat(4, …)` override was dead — equal
 * specificity, earlier in the stylesheet, so the two-up base rule beat it at
 * every width. Hence the `trackCount` assertion below: an override that loses
 * the cascade and an override that is absent look identical from the source,
 * and only the computed value tells them apart.
 *
 * Why a fixture and not the real route: /dashboard is behind ProtectedRoute +
 * LearnerOnlyRoute, and there is no unguarded learner twin of it (the teacher
 * dashboard has /teacher/dashboard-preview, which is why
 * test-dashboard-responsive.mjs can drive the real page). So this builds a
 * fixture that is deliberately NOT a copy of the thing under test:
 *
 *   • the stylesheet is the REAL src/shared/styles/learnerTheme.css, linked
 *     from disk — the layout rule lives entirely in CSS, so the rule being
 *     asserted is the shipped one, not a paraphrase of it;
 *   • the labels are PARSED out of HomeSections.jsx, so renaming a tile or
 *     adding a fourth one is measured rather than missed. A parse failure is
 *     a hard error — falling back to hardcoded labels would leave the guard
 *     green while measuring text the app no longer shows;
 *   • the DOM mirrors the real nesting (.lhx > .lhx-page > .lhx-section >
 *     .lhx-explore > button.lhx-tile), because the page scaffold's max-width
 *     and padding are what decide how much room a tile actually gets.
 *
 * Two tiers of assertion, and the split is the point:
 *
 *   ALWAYS — three tiles, one row, equal widths, three grid tracks, no
 *   horizontal overflow. All font-independent, and all of them the actual ask.
 *
 *   ONLY WITH NUNITO — each label on a single line. Whether "Past Papers"
 *   fits is a question about font metrics, and at 320px it fits with about two
 *   pixels to spare, so measuring it against a fallback face would be
 *   measuring the wrong thing. Nunito comes from Google Fonts over the
 *   network; when it is unavailable this check is SKIPPED AND SAID SO, never
 *   silently counted as a pass.
 *
 * Needs a real Chromium, so — like test-mobile-smoke.mjs and
 * test-dashboard-responsive.mjs — it is NOT a `test:*` script (CI sets
 * PUPPETEER_SKIP_DOWNLOAD=true everywhere except the smoke job). It runs in
 * the "Build + mobile smoke" job. Locally, with no build needed:
 *     npm run smoke:explore
 * (set PUPPETEER_EXECUTABLE_PATH to reuse a system/Playwright Chromium.)
 */
import puppeteer from 'puppeteer'
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const CSS_PATH = join(ROOT, 'src/shared/styles/learnerTheme.css')
const SECTIONS_PATH = join(ROOT, 'src/features/learnerHome/sections/HomeSections.jsx')
const FIXTURE_PATH = join(ROOT, 'node_modules/.cache/learner-explore-fixture.html')

const NUNITO_HREF =
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=block'

// The repo's device matrix (scripts/test-dashboard-responsive.mjs) plus the
// two tablet widths and the reference iPhone. 320 is the floor on purpose:
// it is the narrowest screen the project targets. Below it the row STAYS
// three-up — that is the rule — but the labels wrap, because three tiles
// across 280px leaves ~63px of text per tile and shrinking type far enough to
// fit would cost more legibility than the wrap does.
const VIEWPORTS = [320, 360, 375, 390, 412, 640, 768, 834, 1024, 1280, 1440]

const MAX_OVERFLOW_PX = 4
// Grid tracks are fractional; sub-pixel rounding makes "equal" inexact.
const MAX_WIDTH_SPREAD_PX = 1.5

/**
 * Pull the Explore tile labels out of the feature source.
 * @param {string} src HomeSections.jsx contents
 * @returns {{title: string, sub: string, tone: string}[]}
 */
export function parseExploreTiles(src) {
  const block = src.match(/const EXPLORE_TILES = \[([\s\S]*?)\n\]/)
  if (!block) throw new Error('could not find EXPLORE_TILES in HomeSections.jsx')
  const tiles = []
  for (const line of block[1].split('\n')) {
    const title = line.match(/title:\s*'((?:[^'\\]|\\.)*)'/)
    const sub = line.match(/sub:\s*'((?:[^'\\]|\\.)*)'/)
    const tone = line.match(/tone:\s*'([^']*)'/)
    if (title && sub) {
      tiles.push({ title: title[1], sub: sub[1], tone: tone ? tone[1] : '' })
    }
  }
  if (tiles.length === 0) throw new Error('EXPLORE_TILES parsed to zero tiles')
  return tiles
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * @param {{title: string, sub: string, tone: string}[]} tiles
 * @param {boolean} withFont whether to request Nunito over the network
 */
function buildFixture(tiles, withFont) {
  const buttons = tiles
    .map(
      (t) => `      <button type="button" class="lhx-tile ${t.tone} lhx-press"
              aria-label="${escapeHtml(`${t.title} — ${t.sub}`)}">
        <span class="lhx-tile-icon" aria-hidden="true">*</span>
        <span class="lhx-tile-name">${escapeHtml(t.title)}</span>
        <span class="lhx-tile-sub">${escapeHtml(t.sub)}</span>
      </button>`,
    )
    .join('\n')
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${withFont ? `<link rel="stylesheet" href="${NUNITO_HREF}">` : ''}
<link rel="stylesheet" href="${new URL(`file://${CSS_PATH}`).href}">
</head><body>
<div class="lhx"><div class="lhx-page">
  <section class="lhx-section" aria-labelledby="x">
    <div class="lhx-section-head"><h2 id="x" class="lhx-section-title">Explore</h2></div>
    <div class="lhx-explore">
${buttons}
    </div>
  </section>
</div></div>
</body></html>
`
}

/** Runs in the page: one measurement of the Explore row. */
function measureRow() {
  const grid = document.querySelector('.lhx-explore')
  const tiles = [...document.querySelectorAll('.lhx-tile')]
  const doc = document.documentElement
  const readText = (el) => {
    const cs = getComputedStyle(el)
    const range = document.createRange()
    range.selectNodeContents(el)
    // Line count from the text's own client rects — one rect per line box.
    // Dividing height by line-height mis-rounds when line-height is `normal`
    // (Nunito's normal is ~1.36em, not the 1.2 a fallback would assume).
    const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
    return {
      text: el.textContent.trim(),
      fontPx: Math.round(parseFloat(cs.fontSize) * 10) / 10,
      lines: tops.size || 1,
      clipped: el.scrollWidth > el.clientWidth + 1,
    }
  }
  return {
    supportsContainerQueries: CSS.supports('container-type', 'inline-size'),
    nunitoLoaded: document.fonts.check('900 13.5px Nunito'),
    viewportWidth: doc.clientWidth,
    overflowPx: doc.scrollWidth - doc.clientWidth,
    trackCount: grid
      ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length
      : 0,
    tileCount: tiles.length,
    rowCount: new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top))).size,
    widths: tiles.map((t) => Math.round(t.getBoundingClientRect().width * 10) / 10),
    names: [...document.querySelectorAll('.lhx-tile-name')].map(readText),
    subs: [...document.querySelectorAll('.lhx-tile-sub')].map(readText),
  }
}

/**
 * @param {ReturnType<typeof measureRow>} m
 * @param {number} expectedTiles
 * @param {boolean} checkWrap
 * @returns {string[]} problems
 */
export function checkRow(m, expectedTiles, checkWrap) {
  const problems = []
  if (m.tileCount !== expectedTiles) {
    problems.push(`${m.tileCount} tiles rendered, expected ${expectedTiles}`)
    return problems
  }
  if (m.rowCount !== 1) {
    problems.push(`tiles span ${m.rowCount} rows — Explore must be ONE horizontal row`)
  }
  if (m.trackCount !== expectedTiles) {
    problems.push(
      `grid has ${m.trackCount} column tracks for ${expectedTiles} tiles ` +
        `(an empty track leaves a gap where a tile should be)`,
    )
  }
  const spread = Math.max(...m.widths) - Math.min(...m.widths)
  if (spread > MAX_WIDTH_SPREAD_PX) {
    problems.push(`tile widths uneven by ${spread}px (${m.widths.join(', ')})`)
  }
  if (m.overflowPx > MAX_OVERFLOW_PX) {
    problems.push(`horizontal overflow ${m.overflowPx}px past the ${m.viewportWidth}px viewport`)
  }
  if (checkWrap) {
    for (const label of [...m.names, ...m.subs]) {
      if (label.lines > 1) {
        problems.push(`"${label.text}" wraps onto ${label.lines} lines at ${label.fontPx}px`)
      }
      if (label.clipped) problems.push(`"${label.text}" is clipped at ${label.fontPx}px`)
    }
  }
  return problems
}

async function main() {
  const tiles = parseExploreTiles(readFileSync(SECTIONS_PATH, 'utf8'))
  console.log(
    `[explore-row] ${tiles.length} tiles from HomeSections.jsx: ` +
      tiles.map((t) => t.title).join(' · '),
  )

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // The fixture is a file:// page; a proxied CI network needs telling.
      ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : []),
    ],
  })

  let failed = 0
  try {
    // One page for the whole matrix: the fixture is static, so resizing is
    // enough and the webfont is fetched once.
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true })
    writeFileSync(FIXTURE_PATH, buildFixture(tiles, true))
    const page = await browser.newPage()
    await page.goto(`file://${FIXTURE_PATH}`, { waitUntil: 'networkidle0', timeout: 30_000 })
    await page.evaluate(() => document.fonts.ready)

    const probe = await page.evaluate(measureRow)
    if (!probe.supportsContainerQueries) {
      // The type scale is written in `cqi`. Without container-query support
      // every label falls to the clamp minimum and the wrap check would be
      // measuring a browser this app does not ship to.
      console.error('[explore-row] FAIL: this Chromium has no container-query support')
      process.exitCode = 1
      return
    }
    const checkWrap = probe.nunitoLoaded
    console.log(
      checkWrap
        ? '[explore-row] Nunito loaded — checking single-line labels'
        : '[explore-row] Nunito UNAVAILABLE (offline?) — single-line label check SKIPPED; ' +
            'row geometry still checked',
    )

    for (const width of VIEWPORTS) {
      await page.setViewport({ width, height: 700, deviceScaleFactor: 2 })
      const m = await page.evaluate(measureRow)
      const problems = checkRow(m, tiles.length, checkWrap)
      const shape = `${m.rowCount} row · ${m.trackCount} tracks · tile ${m.widths[0]}px`
      if (problems.length === 0) {
        console.log(`  ✓ ${String(width).padStart(4)}px  ${shape}`)
      } else {
        failed += 1
        console.log(`  ✗ ${String(width).padStart(4)}px  ${shape}`)
        for (const p of problems) console.log(`      - ${p}`)
        console.log(
          `      names: ${m.names.map((n) => `${n.text} @${n.fontPx}px L${n.lines}`).join(' | ')}`,
        )
        console.log(
          `      subs:  ${m.subs.map((n) => `${n.text} @${n.fontPx}px L${n.lines}`).join(' | ')}`,
        )
      }
    }
  } finally {
    await browser.close()
    try {
      rmSync(FIXTURE_PATH, { force: true })
    } catch {}
  }

  if (failed > 0) {
    console.error(`\n[explore-row] FAILED at ${failed}/${VIEWPORTS.length} widths`)
    process.exitCode = 1
    return
  }
  console.log(`\n[explore-row] PASS — one three-up row at all ${VIEWPORTS.length} widths`)
}

main().catch((err) => {
  console.error('[explore-row] crashed:', err)
  process.exitCode = 1
})
