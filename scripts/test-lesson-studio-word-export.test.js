/**
 * Regression guard for the Lesson Plan Studio Word export matching the preview
 * (public/studio/10-export.js).
 *
 * The studio preview (#doc) and the .docx download render from the SAME html,
 * yet two things made the download diverge from what teachers saw on screen:
 *
 *   1. PICTURES — the vendored html-docx converter only embeds images whose
 *      src is a `data:` URI. The lesson's AI illustrations are remote
 *      Firebase-Storage <img>s and the template/auto diagrams are inline <svg>,
 *      so Word embedded neither and every picture vanished from the download.
 *      Fix: prepareWordBody() rasterises <svg>→PNG data URI and fetches remote
 *      <img>→data URI before the converter runs.
 *   2. ARRANGEMENT — Word's HTML engine ignores CSS grid, so the grid-based
 *      metadata header (.meta-compact / .official-meta) collapsed. Fix:
 *      prepareWordBody() reflows those grids into 2-column <table>s, and
 *      WORD_DOC_STYLES now carries the classes the renderers actually emit.
 *
 * These are static (text-level) checks — same style as
 * test-lesson-batch-export.test.js — so the wiring can't silently regress.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 * Run: npm run test:lesson-word-export
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const exp = readFileSync(join(root, 'public', 'studio', '10-export.js'), 'utf8')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures += 1
  }
}

// 1. The normalisation pass exists and is wired into BOTH Word builders.
check(/async function prepareWordBody\(/.test(exp), '10-export.js defines async prepareWordBody()')
check(/const body = await prepareWordBody\(doc\.innerHTML\)/.test(exp),
  'single-plan buildWordHtml() runs the doc through prepareWordBody()')
check(/await prepareWordBody\(part\)/.test(exp),
  'batch buildBatchWordHtml() runs each lesson through prepareWordBody()')
check(/async function buildWordHtml\(/.test(exp), 'buildWordHtml() is async (it awaits the picture inlining)')
check(/async function buildBatchWordHtml\(/.test(exp), 'buildBatchWordHtml() is async')
check(/const html = await buildWordHtml\(\)/.test(exp), 'exportWord() awaits buildWordHtml()')
check(/const html = await buildBatchWordHtml\(\)/.test(exp), 'exportBatchWord() awaits buildBatchWordHtml()')

// 2. Pictures: inline <svg> are rasterised to a PNG data URI…
check(/function svgToPngDataUrl\(/.test(exp), '10-export.js rasterises inline <svg> (svgToPngDataUrl)')
check(/canvas\.toDataURL\('image\/png'\)/.test(exp), 'svg rasteriser produces a PNG data URI Word can embed')
check(/rasterizeSvgsForWord\(/.test(exp), 'prepareWordBody() rasterises the lesson diagrams')
// …and remote <img> (Firebase Storage AI illustrations) are fetched + inlined.
check(/async function inlineRemoteImagesForWord\(/.test(exp), '10-export.js inlines remote <img> (inlineRemoteImagesForWord)')
check(/fetch\(src,\s*\{\s*mode:\s*'cors'\s*\}\)/.test(exp), 'remote images are fetched cross-origin for inlining')
check(/readAsDataURL\(/.test(exp), 'fetched image bytes become a data URI (readAsDataURL)')
check(/\^https\?:/.test(exp), 'only http(s) srcs are inlined (already-data: srcs are left alone)')

// 3. Arrangement: the grid metadata header is reflowed into a 2-column table…
check(/function convertMetaGridsToTables\(/.test(exp), '10-export.js reflows grid metadata into tables (convertMetaGridsToTables)')
check(/function buildWordMetaTable\(/.test(exp), '10-export.js builds the 2-column word-meta-table')
check(/\.meta-compact/.test(exp) && /\.official-meta/.test(exp),
  'both metadata grids (.meta-compact + .official-meta) are converted')

// 4. …and WORD_DOC_STYLES carries the classes the renderers emit (so nothing
//    the preview shows is silently unstyled in the download).
for (const cls of ['.word-meta-table', '.field-line', '.diagram-wrap', '.diagram-caption', '.stage-diagrams', '.callout-line']) {
  check(exp.includes(cls), `WORD_DOC_STYLES styles ${cls}`)
}

// 5. prepareWordBody() must be a safe no-op outside a browser (node tests load
//    this file via the studio-style harness) — guard on DOMParser.
check(/if \(typeof DOMParser === 'undefined'\) return html/.test(exp),
  'prepareWordBody() is a no-op when DOMParser is unavailable (non-browser)')

// 6. altChunk→native-OOXML fix (Word for Android/iOS/Web).
//    Both exportWord() and exportBatchWord() must try window.__zxHtmlToDocx
//    BEFORE the html-docx-js path. Check that in each function the bridge call
//    appears before the await loadHtmlDocxLib() call.
check(/window\.__zxHtmlToDocx/.test(exp), 'exportWord/exportBatchWord references window.__zxHtmlToDocx')
check(/loadHtmlDocxLib\(\)/.test(exp), 'html-docx-js fallback (loadHtmlDocxLib) is still present')
// In exportWord(): find the async exportWord function block and verify order.
const exportWordMatch = exp.match(/async function exportWord\(\)[^]*?(?=async function exportBatchWord)/)
check(!!exportWordMatch, 'exportWord() function exists')
if (exportWordMatch) {
  const fn = exportWordMatch[0]
  const bridgePos = fn.indexOf('window.__zxHtmlToDocx')
  const libPos = fn.indexOf('await loadHtmlDocxLib()')
  check(bridgePos !== -1 && libPos !== -1 && bridgePos < libPos,
    'exportWord(): native __zxHtmlToDocx bridge is tried BEFORE html-docx-js fallback')
}
// In exportBatchWord(): check the block after exportWord.
const exportBatchIdx = exp.indexOf('async function exportBatchWord()')
const exportBatchFn = exportBatchIdx !== -1 ? exp.slice(exportBatchIdx) : ''
check(exportBatchFn.includes('window.__zxHtmlToDocx'), 'exportBatchWord() contains the native bridge call')
if (exportBatchFn) {
  const bridgePosB = exportBatchFn.indexOf('window.__zxHtmlToDocx')
  const libPosB = exportBatchFn.indexOf('await loadHtmlDocxLib()')
  check(bridgePosB !== -1 && libPosB !== -1 && bridgePosB < libPosB,
    'exportBatchWord(): native __zxHtmlToDocx bridge is tried BEFORE html-docx-js fallback')
}

// 7. Mobile must NEVER fall back to the altChunk html-docx-js path (mobile Word
//    can't open it). Both functions guard the html-docx fallback behind
//    !isMobileUA() so mobile drops straight to the .doc fallback instead.
check(/function isMobileUA\(/.test(exp), '10-export.js defines isMobileUA()')
for (const [label, fn] of [['exportWord', exportWordMatch && exportWordMatch[0]], ['exportBatchWord', exportBatchFn]]) {
  if (!fn) { check(false, `${label}() found for mobile-guard check`); continue }
  const guardPos = fn.indexOf('isMobileUA()')
  const libPos = fn.indexOf('await loadHtmlDocxLib()')
  check(guardPos !== -1 && libPos !== -1 && guardPos < libPos,
    `${label}(): html-docx-js (altChunk) fallback is gated behind !isMobileUA()`)
}

if (failures) {
  console.error(`\n✗ lesson Word-export guard FAILED (${failures} issue(s)).`)
  process.exit(1)
}
console.log('\n✓ lesson Word-export guard passed.')
