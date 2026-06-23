/**
 * Regression guard for the Lesson Plan Studio "whole-series" batch export.
 *
 * A multi-lesson run (Multiple / Full week / Let AI suggest) generates and
 * saves every lesson, but #doc only holds the last one (each loop iteration in
 * 06-generate.js overwrites it). The batch-export feature collects each
 * lesson's HTML into window.__lpBatch so the teacher can download the whole
 * series as ONE Word document (cover sheet + one lesson per page). The studio
 * is Word-only (PDF/HTML export was removed), so the batch export is Word-only
 * too. These are static (text-level) checks — same style as
 * test-studio-downloads.test.js — that the wiring can't silently regress.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

let failures = 0
const read = (rel) => readFileSync(join(root, rel), 'utf8')
function check(cond, msg) {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures += 1
  }
}

// 1. The generate loop seeds and fills the batch store.
const gen = read('public/studio/06-generate.js')
check(/window\.__lpBatch\s*=\s*\{/.test(gen), '06-generate.js initialises window.__lpBatch for each run')
check(/__lpBatch\.lessons\.push\(/.test(gen), '06-generate.js pushes each generated lesson into __lpBatch.lessons')
check(/lessons:\s*\[\]/.test(gen), '06-generate.js resets the lessons array at the start of a run')
// The pushed lesson must carry the rendered html (the export reads it).
check(/__lpBatch\.lessons\.push\(\{[\s\S]*?html,/.test(gen), '06-generate.js stores each lesson html in the batch store')

// 2. The export module builds + offers the whole-series Word download.
const exp = read('public/studio/10-export.js')
for (const fn of [
  'function lpBatchActive',
  'function buildBatchCoverHtml',
  'function buildBatchWordHtml',
  'function batchFilename',
  'async function exportBatchWord',
  'function refreshBatchExportButtons',
]) {
  check(exp.includes(fn), `10-export.js defines ${fn}()`)
}

// 3. Batch export only appears for a genuine multi-lesson run (> 1).
check(/lessons\.length\s*>\s*1/.test(exp), '10-export.js gates batch export on more than one lesson')

// 4. Lessons are split onto their own pages in the Word document.
check(/page-break-before:always/.test(exp), '10-export.js page-breaks between lessons in the Word export')

// 5. The popover refreshes the batch button when it opens.
check(/refreshBatchExportButtons\(\)/.test(exp) && /__studioInitExport/.test(exp), '10-export.js refreshes the batch button on popover open')

// 6. Word styles are shared (not duplicated) between single + batch exports.
check(/const WORD_DOC_STYLES\s*=/.test(exp), '10-export.js extracts shared WORD_DOC_STYLES')
const wordStyleUses = (exp.match(/\$\{WORD_DOC_STYLES\}/g) || []).length
check(wordStyleUses >= 2, 'both single + batch Word builders reuse WORD_DOC_STYLES')

// 7. The batch Word export keeps the .doc fallback (mirrors the single path).
check(/asBlob\([\s\S]*?\)/.test(exp) && /application\/msword/.test(exp), '10-export.js batch export keeps the .doc fallback')

if (failures) {
  console.error(`\n✗ lesson batch-export guard FAILED (${failures} issue(s)).`)
  process.exit(1)
}
console.log('\n✓ lesson batch-export guard passed.')
