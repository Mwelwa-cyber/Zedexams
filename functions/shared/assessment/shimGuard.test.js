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
  // The past-paper quiz's shims. What these re-export decides how long a
  // learner's exam runs: the browser prints the number on the cover and the
  // server stamps `expiresAtMs` from the same module, so a rung added on this
  // side alone is a clock that disagrees with the screen that sold it.
  'src/utils/paperExamSpec.js',
  // The guardian package's shims. Same rule, higher stakes: what these
  // re-export decides whether a child's account is in limited mode, whether
  // one guardian may loosen another's restriction, and who may spend a
  // parent's money. A rule that grew here would be a rule the server never
  // sees.
  'src/utils/guardianLink.js',
  'src/utils/guardianRoles.js',
  'src/utils/guardianControls.js',
  // The billing package's shim. What it re-exports decides whether a parent
  // who is already paying on one rail is offered a second checkout on the
  // other. A rule that grew here would be a rule the server never sees —
  // and the server is the half that has to refuse, because by the time a
  // Play purchase reaches us Google has already taken the money.
  'src/utils/crossRail.js',
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
    // Any package under functions/shared/, not `assessment` alone: this
    // guard started life covering the export rules and now also covers the
    // guardian package, whose shims front rules of exactly the same kind
    // (a decision the SERVER has to make, fronted in src/ for a short
    // import path). Pinning one directory would have quietly excused a
    // shim in the other from ever being checked.
    //
    // `[A-Za-z]` rather than `[a-z]`: the package directories are camelCase
    // (`paperQuiz`), and a lowercase-only pattern silently failed the first
    // shim that fronted one — reported as "the rule has moved somewhere
    // else", which is the opposite of what had happened.
    assert.match(
      code,
      /functions\/shared\/[A-Za-z]+\//,
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
