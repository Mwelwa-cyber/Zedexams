/**
 * A shim must stay a shim.
 *
 * `src/utils/unresolvedFigures.js` and its siblings exist so call sites keep
 * their import path while the rules live in the shared package. That works
 * exactly as long as they contain nothing but re-exports. The failure mode is
 * quiet and it is the one this whole refactor exists to prevent: someone opens
 * the file the studio imports, adds a condition there because that is where the
 * bug appeared, and the server never sees it. Both sides then enforce
 * "the same" rules and disagree.
 *
 * So the shims are checked for IMPLEMENTATION — a function body, a branch, a
 * constant with a rule in it — rather than trusted to a comment asking nicely.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Every file in src/ whose only job is to point at the shared package. */
const SHIMS = [
  'src/utils/unresolvedFigures.js',
  'src/utils/assessmentExportGate.js',
  'src/utils/questionType.js',
  'src/utils/fillBlanks.js',
  'src/utils/comprehensionGrouping.js',
  'src/utils/mcqChoices.js',
  'src/utils/paperMarksModel.js',
  'src/curriculum/diagrams/diagramCatalog.js',
]

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

/** Source with comments and strings removed, so only real code is examined. */
function codeOf(file) {
  return readFileSync(join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .trim()
}

for (const shim of SHIMS) {
  test(`${shim} is re-exports only`, () => {
    const code = codeOf(shim)
    assert.ok(code.length > 0, `${shim} has no code at all — is it still a shim?`)

    // Every non-blank line must be part of an export/from statement. Written as
    // "what is allowed" rather than "what is banned": a list of banned
    // constructs is a list of the ones someone thought of.
    const lines = code.split('\n').map((l) => l.trim()).filter(Boolean)
    const offenders = lines.filter((line) => !(
      /^export\s*\{/.test(line)
      || /^export\s+\*/.test(line)
      || /^\}\s*from\s+['"]/.test(line)
      || /^from\s+['"]/.test(line)
      // A bare identifier or `name,` inside a multi-line export list.
      || /^[A-Za-z_$][\w$]*\s*,?$/.test(line)
    ))
    assert.deepEqual(
      offenders, [],
      `${shim} contains implementation, not just re-exports:\n        ${offenders.join('\n        ')}`,
    )
  })

  test(`${shim} points at the shared package`, () => {
    const code = codeOf(shim)
    assert.match(
      code,
      /functions\/shared\/assessment\//,
      `${shim} no longer re-exports from the shared package — the rule it fronts has moved somewhere else`,
    )
  })
}

test('the shim list is not silently empty', () => {
  assert.ok(SHIMS.length >= 6, 'the guard must actually be checking the shims')
})

if (process.exitCode) {
  console.error('\n✗ shim guard FAILED — a rule has been added outside the shared package')
} else {
  console.log(`\n✓ shims are re-exports only — ${passed} checks across ${SHIMS.length} files`)
}
