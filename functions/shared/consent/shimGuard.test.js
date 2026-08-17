/**
 * The consent shims must stay shims.
 *
 * `src/utils/guardianConsent.js` and `src/utils/guardianControls.js` exist so
 * call sites in src/ keep a short import path. That works exactly as long as
 * they contain nothing but re-exports — the same argument
 * functions/shared/assessment/shimGuard.test.js makes for the export rules,
 * and a sharper one here: what this package decides is whether a child's
 * account may reach an AI and what their guardian has taken away. A rule added
 * to the browser copy is a rule the Cloud Function never applies, so the
 * banner and the refusal disagree — and the one that matters is the refusal.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const SHIMS = [
  'src/utils/guardianConsent.js',
  'src/utils/guardianControls.js',
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

/** Source with comments removed, so prose never reads as implementation. */
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

    // "What is allowed", not "what is banned": a list of banned constructs is
    // a list of the ones someone thought of.
    const lines = code.split('\n').map((l) => l.trim()).filter(Boolean)
    const offenders = lines.filter((line) => !(
      /^export\s*\{/.test(line)
      || /^export\s+\*/.test(line)
      || /^\}\s*from\s+['"]/.test(line)
      || /^from\s+['"]/.test(line)
      || /^[A-Za-z_$][\w$]*\s*,?$/.test(line)
    ))
    assert.deepEqual(
      offenders, [],
      `${shim} contains implementation, not just re-exports:\n        ${offenders.join('\n        ')}`,
    )
  })

  test(`${shim} points at the shared consent package`, () => {
    assert.match(
      codeOf(shim),
      /functions\/shared\/consent\//,
      `${shim} no longer re-exports from the shared package — the rule it fronts has moved`,
    )
  })
}

test('the shim list is not silently empty', () => {
  assert.ok(SHIMS.length >= 2, 'the guard must actually be checking the shims')
})

if (process.exitCode) {
  console.error('\n✗ consent shim guard FAILED — a rule has been added outside the shared package')
} else {
  console.log(`\n✓ consent shims are re-exports only — ${passed} checks across ${SHIMS.length} files`)
}
