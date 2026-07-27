/**
 * The shared assessment package's contract, enforced.
 *
 * These modules are imported by the React app AND by Cloud Functions. That only
 * works while they stay environment-neutral, and "stays neutral" is not a thing
 * a docblock can guarantee — one `import { db } from '../../config'` added in
 * good faith takes the whole package out of the Node runtime, and the failure
 * surfaces at a Cloud Functions cold start rather than in review.
 *
 * So the contract is a test. It is deliberately a SOURCE scan rather than an
 * import-and-see: importing proves the module loads in THIS environment, which
 * is the one environment we already know works.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Each entry is [pattern, why it is forbidden]. The "why" is printed on
 * failure, because a bare "forbidden token" tells whoever hits this nothing
 * about which of the two runtimes they just broke.
 */
const FORBIDDEN = [
  [/\bfrom\s+['"]react['"]/, 'React — this package runs in the Cloud Functions runtime, which has no React'],
  [/\bfrom\s+['"]react-dom/, 'react-dom — same reason'],
  [/\bfrom\s+['"]firebase\//, 'the Firebase client SDK — the server uses firebase-admin and the browser must not ship admin'],
  [/\bfrom\s+['"]firebase-admin/, 'firebase-admin — it would be bundled into the browser'],
  [/\bfrom\s+['"]docx['"]/, '`docx` — a 2MB exporter dependency in a readiness check is how the studio\'s first paint got slow'],
  [/\bfrom\s+['"]katex/, 'KaTeX — a rendering concern, and a CDN dependency at that'],
  [/\bfrom\s+['"][^'"]*\/src\//, 'a module under src/ — src/ is not uploaded by `firebase deploy`, so the import would resolve locally and fail in production'],
  [/\bfrom\s+['"]\.\.\/\.\.\/\.\.\/src\//, 'a module under src/ — see above'],
  [/\bdocument\s*\./, 'the DOM — there is no document in the Cloud Functions runtime'],
  [/\bwindow\s*\./, 'the DOM — there is no window in the Cloud Functions runtime'],
  [/\bnavigator\s*\./, 'the DOM'],
  [/\bDOMParser\b/, 'DOMParser — the DOM-free path has to be the only path here, or the two runtimes disagree about the same paper'],
  [/\bnew\s+Image\b/, 'the DOM'],
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
  // A scan over an empty directory passes for the wrong reason. If the package
  // is ever renamed or moved, this fails instead of quietly approving nothing.
  assert.ok(files.length >= 3, `expected the shared package's modules, found ${files.length}`)
})

for (const file of files) {
  const source = readFileSync(join(HERE, file), 'utf8')
  // Comments legitimately mention `document`, `window` and the rest — the
  // contract is about what the CODE reaches for, and a docblock explaining why
  // the DOM is absent must not fail the test that keeps it absent.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  test(`${file} is environment-neutral`, () => {
    for (const [pattern, why] of FORBIDDEN) {
      const hit = code.match(pattern)
      assert.ok(
        !hit,
        `${file} reaches for ${hit?.[0]} — not allowed: ${why}`,
      )
    }
  })

  test(`${file} imports nothing outside the package`, () => {
    const imports = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const spec of imports) {
      const local = spec.startsWith('./') && !spec.slice(2).includes('/')
      const builtin = spec.startsWith('node:')
      assert.ok(
        local || builtin,
        `${file} imports "${spec}" — the package may only import its own siblings and node: builtins, `
        + 'so that both runtimes get the same code with no resolution to configure',
      )
    }
  })
}

if (process.exitCode) {
  console.error('\n✗ shared assessment package neutrality FAILED')
} else {
  console.log(`\n✓ shared assessment package is environment-neutral — ${passed} checks passed across ${files.length} modules`)
}
