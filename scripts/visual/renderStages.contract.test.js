/**
 * The visual gate's renderers import the SHIPPING exporters. This checks the
 * names it imports still exist.
 *
 * ## Why this test exists
 *
 * `assessmentToDocx`'s `buildAssessmentDocument` was renamed `buildDocxDocument`
 * (the old name now belongs to the canonical document model). Every call site in
 * `src/` was updated and every one of the 500-odd node scripts and 2 900-odd
 * Vitest tests passed — because `scripts/visual/renderStages.js` is imported by
 * NONE of them. It is loaded only by `runVisualGate.mjs`, which needs Chromium
 * and LibreOffice and therefore runs only in CI.
 *
 * So the break was invisible locally and surfaced eight minutes into a CI job as
 * `TypeError: buildAssessmentDocument is not a function`, on a required check.
 *
 * The gap is structural rather than a one-off: any module the standard suites do
 * not load can be broken by a rename with every test still green. This closes it
 * for the one place it has actually happened, in the cheapest way that is still
 * real — by reading the names `renderStages.js` destructures out of the exporter
 * modules and asserting each is genuinely exported.
 *
 * Deliberately a SOURCE check rather than an import of `renderStages.js` itself:
 * that module sets up jsdom and a canvas rasteriser at import time, which is a
 * lot of machinery to stand up in order to learn whether a name exists — and it
 * would then be a test that fails for reasons other than the one it is for.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'renderStages.js'), 'utf8')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

/**
 * The names `renderStages.js` destructures from one module path.
 *
 * Matches `const { a, b } = await import('…path…')`. A dynamic import written
 * any other way is not found — which is why the count is asserted below, so a
 * refactor that changes the shape fails here rather than silently checking
 * nothing.
 */
function importedNames(modulePath) {
  const pattern = new RegExp(
    `const\\s*\\{([^}]*)\\}\\s*=\\s*await\\s+import\\(\\s*['"]${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*\\)`,
    'g',
  )
  const names = new Set()
  for (const match of SOURCE.matchAll(pattern)) {
    for (const part of match[1].split(',')) {
      const name = part.split(':')[0].trim()
      if (name) names.add(name)
    }
  }
  return [...names]
}

const MODULES = [
  { path: '../../src/utils/assessmentToDocx.js', load: () => import('../../src/utils/assessmentToDocx.js') },
  { path: '../../src/utils/assessmentToPdf.js', load: () => import('../../src/utils/assessmentToPdf.js') },
]

console.log('\n— the visual gate imports names that exist —')

// Importing the exporters needs a DOM (safeRender parses HTML at module load).
// The same minimal jsdom the gate itself installs, and nothing more: this test
// is about names, not rendering.
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node

let checkedNames = 0
for (const entry of MODULES) {
  const names = importedNames(entry.path)
  test(`renderStages.js imports something from ${entry.path}`, () => {
    assert.ok(
      names.length > 0,
      `no destructured import found for ${entry.path} — has the import shape changed? `
      + 'This test would then be checking nothing.',
    )
  })
  const module = await entry.load()
  for (const name of names) {
    checkedNames += 1
    test(`${entry.path} exports ${name}`, () => {
      assert.equal(
        typeof module[name], 'function',
        `renderStages.js destructures "${name}" from ${entry.path}, but it is not exported. `
        + 'A rename in the exporter needs the visual gate updated with it — nothing else loads that file.',
      )
    })
  }
}

test('the two exporters the gate needs are both covered', () => {
  // A guard on the guard: if someone deletes a MODULES entry, this fails rather
  // than the suite quietly shrinking to nothing.
  assert.ok(checkedNames >= 2, `only ${checkedNames} imported name(s) checked — expected at least 2`)
})

console.log(`\n✓ visual gate exporter contract — ${passed} checks passed`)
