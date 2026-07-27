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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const SRC = join(root, 'src')

// This guard used to name two files. That is how the bug came back: it was
// written when the assessment exporter had no PDF path at all ("intentionally
// absent here"), src/utils/assessmentToPdf.js was added later with the exact
// features string the guard exists to forbid, and the list — being a list —
// said nothing about a file nobody had thought to add to it. A hand-kept
// inventory of the places a rule applies only ever covers the places that
// existed when someone last remembered.
//
// So the rule is now enforced by DISCOVERY: every blank-window `window.open`
// anywhere under src/ is checked, and a new exporter is covered on the day it
// is written rather than on the day someone adds it here.
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { out.push(...walk(full)); continue }
    if (/\.(js|jsx)$/.test(entry) && !/\.(spec|test)\.(js|jsx)$/.test(entry)) out.push(full)
  }
  return out
}

// Matches a window.open('', ...) call (single statement / call args) so we can
// inspect only the blank-window opens — not the navigate-to-URL opens (which
// SHOULD keep noopener for security).
const BLANK_OPEN_RE = /window\.open\(\s*''\s*,[^)]*\)/g

let failures = 0
let checked = 0
const filesWithOpens = []

for (const file of walk(SRC)) {
  const matches = readFileSync(file, 'utf8').match(BLANK_OPEN_RE) || []
  if (matches.length === 0) continue
  const rel = relative(root, file)
  filesWithOpens.push(rel)
  for (const call of matches) {
    checked += 1
    if (/noopener|noreferrer/.test(call)) {
      console.error(`✗ ${rel}: blank-window open passes noopener/noreferrer (nulls the handle → blank white page):\n    ${call}`)
      failures += 1
    }
  }
}

// A discovery-based guard that discovers nothing is a guard that passes for the
// wrong reason. The exporters exist; finding none of them means the pattern
// changed shape and this check stopped covering anything.
if (checked === 0) {
  console.error('✗ no window.open(\'\', ...) call found anywhere under src/ — the guard is no longer looking at the right thing.')
  failures += 1
}

if (failures > 0) {
  console.error(`\nPDF export window guard FAILED with ${failures} problem(s).`)
  process.exit(1)
}

console.log(`✓ PDF export window guard passed (${checked} blank-window open call(s) across ${filesWithOpens.length} discovered file(s), none poisoned with noopener/noreferrer).`)
console.log(`  covered: ${filesWithOpens.join(', ')}`)
