/**
 * The shared past-paper quiz + text packages must run in BOTH runtimes.
 *
 * Modelled on `functions/shared/assessment/neutrality.test.js` and covering
 * the two areas that landed with the quiz redesign: `paperQuiz/` (the answer
 * key, the explanation gate, marking) and `text/` (plain-text projection).
 * The browser imports them by relative path out of `src/`; Cloud Functions
 * imports them with `await import(...)`. One React import, one `document`, one
 * `firebase-admin` and one of those two stops working — and the failure is not
 * a missing module, it is an exam marked by only one of the two copies of a
 * rule there is supposed to be one of.
 *
 * ── One rule differs from the assessment package's, deliberately ─────────
 *
 * That package permits SAME-DIRECTORY imports only. This one additionally
 * permits `../<area>/<file>` within `functions/shared/`, because `paperQuiz/
 * answerKey.js` genuinely needs `text/richPlainText.js` and the alternative
 * was a third hand-copied plain-text extractor under `functions/` (there are
 * already two, "kept in sync" by comment, in agents/runners/). The stated
 * reason for the original rule — "both runtimes get the same code with no
 * resolution to configure" — is untouched: a relative path to a sibling
 * directory resolves identically under node ESM and under Vite.
 *
 * Run: node functions/shared/paperQuiz/neutrality.test.js
 *      (test:shared-paper-quiz-neutral)
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHARED = resolve(HERE, '..')
const AREAS = ['paperQuiz', 'text']

const FORBIDDEN = [
  [/\bfrom\s+['"]react(-dom)?['"]/, 'React — the server has no renderer'],
  [/\bdocument\s*\./, 'the DOM — there is no document in a Cloud Function'],
  [/\bwindow\s*\./, 'the DOM — there is no window in a Cloud Function'],
  [/\bnew\s+DOMParser\b/, 'DOMParser — browser-only'],
  [/\blocalStorage\b/, 'localStorage — browser-only'],
  [/\bfrom\s+['"]firebase(-admin)?/, 'a Firebase SDK — the caller supplies the data'],
  [/\bfrom\s+['"]docx['"]/, 'docx — that is an exporter concern'],
  [/\bfrom\s+['"]katex/, 'KaTeX — rendering is the browser\'s'],
  [/\brequire\s*\(/, 'CommonJS require — this package is ESM in both runtimes'],
  [/\bfrom\s+['"][^'"]*\/src\//, 'something in src/ — the server cannot reach it'],
]

let passed = 0
let checked = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`)
    process.exitCode = 1
  }
}

for (const area of AREAS) {
  const dir = join(SHARED, area)
  const files = readdirSync(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  assert.ok(files.length > 0, `${area} has modules to check`)

  for (const file of files) {
    checked += 1
    const source = readFileSync(join(dir, file), 'utf8')
    // Strip comments before matching, so a note ABOUT the DOM is not a use of it.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

    test(`${area}/${file} imports nothing environment-specific`, () => {
      for (const [pattern, why] of FORBIDDEN) {
        const hit = code.match(pattern)
        assert.equal(hit, null, `${area}/${file} reaches for ${why}`)
      }
    })

    test(`${area}/${file} imports only siblings, shared areas and node: builtins`, () => {
      const imports = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
      for (const spec of imports) {
        const sibling = spec.startsWith('./') && !spec.slice(2).includes('/')
        const sharedArea = /^\.\.\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(spec)
          && AREAS.includes(spec.split('/')[1])
        const builtin = spec.startsWith('node:')
        assert.ok(
          sibling || sharedArea || builtin,
          `${area}/${file} imports "${spec}" — only its own siblings, another `
          + `functions/shared area (${AREAS.join(', ')}), and node: builtins resolve in both runtimes`,
        )
      }
    })
  }
}

// A regex check is not enough: a top-level statement that only works in one
// runtime passes every pattern above. So each module is also LOADED here,
// under plain node, which is the runtime the browser's is furthest from.
await Promise.all(AREAS.flatMap((area) => readdirSync(join(SHARED, area))
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  .map(async (f) => {
    try {
      await import(`../${area}/${f}`)
      passed += 1
    } catch (err) {
      console.error(`  ✗ ${area}/${f} does not load under node\n    ${err.message}`)
      process.exitCode = 1
    }
  })))

if (process.exitCode) {
  console.error('\n✗ shared paper-quiz package neutrality FAILED')
} else {
  console.log(`\n✓ shared paper-quiz + text packages are environment-neutral — ${passed} checks across ${checked} modules`)
}
