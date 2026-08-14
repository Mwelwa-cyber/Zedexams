/**
 * The classification that decides whether a pull request renders papers.
 *
 * It replaced a `paths:` filter, and the risk in that move is silent: a pattern
 * that compiles differently here selects a different file set, the gate reports
 * green on a pull request it should have rendered, and nothing anywhere says so.
 * So the dialect is pinned case by case, and the list is checked for the two
 * ways it can be wrong — a print-affecting file missing from it, and a
 * self-reference missing so the gate can be weakened without running.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PRINT_AFFECTING_PATHS, isPrintAffecting, classifyPrintScope, patternToRegExp,
} from './printAffectingPaths.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

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

console.log('\n— the glob dialect matches the one it replaced —')

test('* does not cross a directory boundary, ** does', () => {
  assert.ok(patternToRegExp('src/*.js').test('src/a.js'))
  assert.ok(!patternToRegExp('src/*.js').test('src/deep/a.js'), '* must not cross /')
  assert.ok(patternToRegExp('src/**').test('src/deep/a.js'))
  assert.ok(patternToRegExp('src/**/*.css').test('src/a/b/c.css'))
  // `**/` may match nothing, so a/**/b also matches a/b — the behaviour that
  // decides whether `src/**/*print*.css` covers `src/print.css`.
  assert.ok(patternToRegExp('src/**/*.css').test('src/c.css'))
})

test('a dot in a pattern is a literal dot, not any character', () => {
  assert.ok(patternToRegExp('package-lock.json').test('package-lock.json'))
  assert.ok(!patternToRegExp('package-lock.json').test('package-lockXjson'))
})

console.log('\n— what is on the list —')

test('the renderers, the geometry and the diagram catalogue are all covered', () => {
  for (const file of [
    'src/utils/assessmentToPdf.js',
    'src/utils/assessmentToDocx.js',
    'src/utils/assessmentPaperLayout.js',
    'src/config/paperPageGeometry.js',
    'src/utils/paperPaginationCore.js',
    'src/curriculum/diagrams/anything.js',
    'functions/shared/assessment/diagramCatalogCore.js',
    'public/fonts/serif.woff2',
    'src/theme/print.css',
    'package-lock.json',
  ]) {
    assert.ok(isPrintAffecting(file), `${file} must be treated as print-affecting`)
  }
})

test('the gate watches itself', () => {
  // Without these, a pull request could widen a tolerance, drop a fixture or
  // delete a path and never run the gate that proves it is still safe.
  for (const file of [
    'scripts/visual/runVisualGate.mjs',
    'scripts/visual/printAffectingPaths.js',
    'tests/visual/baselines/browser-print/x/vr-001/paper/page-01.png',
    '.github/workflows/visual-regression.yml',
    '.github/workflows/visual-baseline-update.yml',
    '.github/workflows/visual-baseline-bootstrap.yml',
  ]) {
    assert.ok(isPrintAffecting(file), `${file} must be on the list`)
  }
})

test('ordinary changes are not print-affecting', () => {
  for (const file of [
    'README.md',
    'src/components/dashboard/StudentDashboard.jsx',
    'functions/index.js',
    'firestore.rules',
    '.github/workflows/ci.yml',
    'src/utils/lencoPayments.js',
  ]) {
    assert.ok(!isPrintAffecting(file), `${file} must NOT trigger a render`)
  }
})

test('every listed path that names one file actually exists', () => {
  // A pattern for a file that has been renamed or deleted protects nothing, and
  // reads exactly like a pattern that does. Only the non-glob entries can be
  // checked this way; the glob entries are covered by the cases above.
  const missing = PRINT_AFFECTING_PATHS
    .filter((p) => !p.includes('*'))
    .filter((p) => !existsSync(join(ROOT, p)))
  assert.deepEqual(missing, [], `these listed paths no longer exist: ${missing.join(', ')}`)
})

console.log('\n— the verdict a pull request gets —')

test('a print-affecting change asks for the full suite, and names why', () => {
  const scope = classifyPrintScope(['README.md', 'src/utils/assessmentToPdf.js'])
  assert.equal(scope.requiresVisual, true)
  assert.equal(scope.reason, 'print-affecting')
  assert.deepEqual(scope.matched, ['src/utils/assessmentToPdf.js'])
  assert.match(scope.summary, /can affect printed output/)
})

test('an unrelated change does not, and says it looked', () => {
  const scope = classifyPrintScope(['README.md', 'src/components/dashboard/Badges.jsx'])
  assert.equal(scope.requiresVisual, false)
  assert.equal(scope.reason, 'unaffected')
  assert.match(scope.summary, /Printed output not affected/)
  assert.match(scope.summary, /none of the 2 changed files/)
})

test('an EMPTY changed-file set renders rather than passing', () => {
  // An empty list is far more likely to mean "the diff could not be derived"
  // than "this pull request changes nothing", and the safe reading of "I could
  // not tell" is to render. Passing here would be the gate's own version of
  // treating a failed check as success.
  for (const input of [[], null, undefined, ['', '   ']]) {
    const scope = classifyPrintScope(input)
    assert.equal(scope.requiresVisual, true, JSON.stringify(input))
    assert.equal(scope.reason, 'no-changed-files')
  }
})

test('one changed file reads as singular, on both sides of the verdict', () => {
  assert.match(classifyPrintScope(['README.md']).summary, /the one changed file cannot/)
  assert.match(classifyPrintScope(['src/utils/assessmentToPdf.js']).summary, /^1 changed file can affect/)
})

if (!process.exitCode) {
  console.log(`\n✓ print-affecting paths — ${passed} checks passed over ${PRINT_AFFECTING_PATHS.length} patterns`)
}
