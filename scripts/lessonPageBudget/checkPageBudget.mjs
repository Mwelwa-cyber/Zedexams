/**
 * Measure how many A4 sheets the reference lesson plan actually prints on.
 *
 * This is acceptance criterion §5.1 — "the reference lesson at a 2-page budget
 * exports at ≤ 2 pages; at a 1-page budget ≤ 1 page" — as something that can be
 * re-run rather than asserted once. It bundles the REAL paginator, renders the
 * REAL plan through the REAL stylesheet, and counts sheets in a REAL Chromium.
 * A page count derived any other way is arithmetic, and arithmetic is what the
 * old "Est. 3 pages · A4" badge was.
 *
 * Deliberately NOT named `test:*`: `scripts/run-all-tests.mjs` auto-discovers
 * every `test:*` script whose command starts with `node`, and this one needs a
 * Chromium binary that the Tests CI job does not provide. Run it locally with
 *
 *     npm run check:lesson-page-budget
 *
 * after changing anything that affects the printed page — the renderer, the
 * stylesheet, the typography presets or the word budgets.
 */

import { build } from 'vite'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderPlanHtml } from '../../src/shared/utils/renderPlanHtml.js'
import { formatCssVariableString, lessonPlanPrintCss } from '../../src/utils/lessonPlanPrintCss.js'
import { resolveLessonFormat } from '../../src/utils/lessonPlanFormat.js'
import { REFERENCE_PLAN, REFERENCE_META } from './referencePlan.mjs'

// budget → the most sheets the spec allows. `none` is measured but unbounded.
const EXPECTED = { 1: 1, 2: 2, none: Infinity }

const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'

async function bundlePaginator() {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      lib: {
        entry: new URL('../../src/features/lessonPlanStudio/lib/paginatePlan.js', import.meta.url).pathname,
        formats: ['iife'],
        name: 'LP',
        fileName: () => 'paginate.js',
      },
    },
  })
  return (Array.isArray(out) ? out[0] : out).output[0].code
}

function harnessHtml(budget, bundle) {
  const fmt = resolveLessonFormat({ pageBudget: budget })
  const html = renderPlanHtml(REFERENCE_PLAN, { ...REFERENCE_META, lessonFormat: fmt }, 'cbc')
  return { fmt, page: `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#eee}
${lessonPlanPrintCss(fmt, { includePageRule: false, includeSheets: true })}</style>
<script>${bundle}</script></head>
<body><div id="sheets"></div>
<script>
window.__PAGES__ = LP.paginatePlan({
  container: document.getElementById('sheets'),
  html: ${JSON.stringify(html)},
  marginMm: ${fmt.marginMm},
  cssVars: ${JSON.stringify(formatCssVariableString(fmt))},
})
</script></body></html>` }
}

const { chromium } = await import('playwright-core').catch(() => import('playwright'))

const bundle = await bundlePaginator()
const dir = mkdtempSync(join(tmpdir(), 'lesson-page-budget-'))
const browser = await chromium.launch({ executablePath: CHROMIUM })
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })

let failures = 0
try {
  for (const budget of Object.keys(EXPECTED)) {
    const { page: html } = harnessHtml(budget, bundle)
    const file = join(dir, `page-${budget}.html`)
    writeFileSync(file, html)
    await page.goto(`file://${file}`)
    const sheets = await page.evaluate(() => window.__PAGES__)
    const limit = EXPECTED[budget]
    const ok = sheets >= 1 && sheets <= limit
    if (!ok) failures += 1
    const target = limit === Infinity ? 'no limit' : `≤ ${limit}`
    console.log(`  ${ok ? '✓' : '✗'} budget "${budget}" → ${sheets} sheet(s) (${target})`)
  }
} finally {
  await browser.close()
  rmSync(dir, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} page budget(s) exceeded.`)
  process.exit(1)
}
console.log('\n✅ every page budget is met by the reference lesson.')
