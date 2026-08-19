/**
 * The shared GUARDIAN package's contract, enforced.
 *
 * Same reasoning as functions/shared/consent/neutrality.test.js, applied
 * to its sibling: guardianLinkCore, guardianControlsCore, guardianRolesCore
 * and guardianMessageCore are imported by the React app AND by Cloud
 * Functions. What they decide is whether a child's account is in limited
 * mode, whether a second adult may loosen a first adult's restriction, and
 * who may spend money — so if the server copy stopped loading, the
 * surviving enforcement would be the browser's, which is no enforcement.
 *
 * A SOURCE scan rather than an import-and-see: importing proves the module
 * loads in THIS environment, which is the one we already know works.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

const FORBIDDEN = [
  [/\bfrom\s+['"]react['"]/, 'React — this package runs in the Cloud Functions runtime, which has no React'],
  [/\bfrom\s+['"]react-dom/, 'react-dom — same reason'],
  [/\bfrom\s+['"]firebase\//, 'the Firebase client SDK — the server uses firebase-admin and the browser must not ship admin'],
  [/\bfrom\s+['"]firebase-admin/, 'firebase-admin — it would be bundled into the browser'],
  [/\bfrom\s+['"][^'"]*\/src\//, 'a module under src/ — src/ is not uploaded by `firebase deploy`, so the import would resolve locally and fail in production'],
  [/\bdocument\s*\./, 'the DOM — there is no document in the Cloud Functions runtime'],
  [/\bwindow\s*\./, 'the DOM — there is no window in the Cloud Functions runtime'],
  [/\bnavigator\s*\./, 'the DOM'],
  [/\blocalStorage\b/, 'browser storage — a consent decision read from the client is a consent decision the client can forge'],
  [/\bcreateElement\b/, 'the DOM'],
]

const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  .sort()

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

test('the package has modules to check', () => {
  // A scan over an empty directory passes for the wrong reason.
  assert.ok(files.length >= 4, `expected the shared guardian modules, found ${files.length}`)
})

for (const file of files) {
  const source = readFileSync(join(HERE, file), 'utf8')
  // Comments legitimately mention `window`, `localStorage` and the rest — the
  // contract is about what the CODE reaches for.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  test(`${file} is environment-neutral`, () => {
    for (const [pattern, why] of FORBIDDEN) {
      const hit = code.match(pattern)
      assert.ok(!hit, `${file} reaches for ${hit?.[0]} — not allowed: ${why}`)
    }
  })

  test(`${file} imports nothing outside the package`, () => {
    const imports = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const spec of imports) {
      const local = spec.startsWith('./') && !spec.slice(2).includes('/')
      const builtin = spec.startsWith('node:')
      assert.ok(
        local || builtin,
        `${file} imports "${spec}" — the package may only import its own siblings and node: builtins`,
      )
    }
  })
}

console.log(`\nshared/guardian neutrality: ${passed} passed`)
