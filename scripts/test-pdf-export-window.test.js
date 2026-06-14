/**
 * Regression guard for the "Download PDF shows a blank white page" bug.
 *
 * Every PDF/print export on the site opens a blank window and writes a
 * formatted HTML document into it, then calls `window.print()` so the user can
 * "Save as PDF". This only works if `window.open` hands back a live window
 * reference.
 *
 * The trap: if the features string passed to `window.open` contains `noopener`
 * (or `noreferrer`, which implies it), the browser opens the window but returns
 * `null` — by design, to sever the opener relationship. The export code then
 * either throws "browser blocked the print window" or simply leaves the blank
 * tab sitting there as a white page. That is exactly what users saw across
 * lesson plans, assessments, timetables, etc.
 *
 * This test asserts that the blank-window PDF builders never reintroduce
 * `noopener`/`noreferrer` into their `window.open` calls.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Files that open a blank window (window.open('', ...)) and write a document
// into the returned handle. These MUST keep a usable handle.
const FILES = [
  'src/utils/lessonPlanToPdf.js',
  'src/utils/assessmentToPdf.js',
  'src/utils/classTimetableToPdf.js',
]

// Matches a window.open('', ...) call (single statement / call args) so we can
// inspect only the blank-window opens — not the navigate-to-URL opens (which
// SHOULD keep noopener for security).
const BLANK_OPEN_RE = /window\.open\(\s*''\s*,[^)]*\)/g

let failures = 0
let checked = 0

for (const rel of FILES) {
  const src = readFileSync(join(root, rel), 'utf8')
  const matches = src.match(BLANK_OPEN_RE) || []
  if (matches.length === 0) {
    console.error(`✗ ${rel}: expected at least one window.open('', ...) call — did the export change shape?`)
    failures += 1
    continue
  }
  for (const call of matches) {
    checked += 1
    if (/noopener|noreferrer/.test(call)) {
      console.error(`✗ ${rel}: blank-window open passes noopener/noreferrer (nulls the handle → blank white page):\n    ${call}`)
      failures += 1
    }
  }
}

if (failures > 0) {
  console.error(`\nPDF export window guard FAILED with ${failures} problem(s).`)
  process.exit(1)
}

console.log(`✓ PDF export window guard passed (${checked} blank-window open call(s) across ${FILES.length} files, none poisoned with noopener/noreferrer).`)
