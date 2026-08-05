/**
 * The modules the `Visual scope` job runs must need NO dependencies.
 *
 * That job is deliberately cheap: plain node over pure modules, no `npm ci`, no
 * browser, seconds rather than minutes. It is also the job that decides whether
 * the expensive renders run at all, so it must not itself become expensive.
 *
 * This is a guard rather than a convention because the property broke the first
 * time it was tested. `screenFixtures.test.js` imported `SCREEN_PAGE_CHECKS`
 * from `screenStage.mjs`, the stage top-level imports `pngjs`, and the scope
 * job failed with `Cannot find package 'pngjs'` — on a pull request whose only
 * other failures were the expected ones. The checks moved to
 * `screenPageChecks.js`, which has no imports at all.
 *
 * ## It RESOLVES the graph rather than pattern-matching one file
 *
 * A scan of the entry alone would have passed before the fix: `screenFixtures.test.js`
 * imported a relative path, and the dependency was one hop further on. So this
 * walks the whole transitive graph and fails on the first bare specifier,
 * naming the hop that introduced it.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Exactly the commands the scope job's "Prove the scope rules" step runs. */
export const SCOPE_JOB_ENTRIES = [
  'scripts/visual/screen/screenScope.test.js',
  'scripts/visual/screen/screenFixtures.test.js',
]

const ROOT = resolve(HERE, '../../..')
const isBare = (spec) => !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:')

/** Every static import specifier in a file. */
function importsOf(file) {
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  return [...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
}

/** Walk the transitive graph, returning `{file, spec, via}` for each bare import. */
function bareImports(entry) {
  const seen = new Set()
  const problems = []
  const walk = (file, via) => {
    if (seen.has(file) || !existsSync(file)) return
    seen.add(file)
    for (const spec of importsOf(file)) {
      if (isBare(spec)) { problems.push({ file: file.replace(`${ROOT}/`, ''), spec, via }); continue }
      walk(resolve(dirname(file), spec), file.replace(`${ROOT}/`, ''))
    }
  }
  walk(resolve(ROOT, entry), '(entry)')
  return { problems, visited: seen }
}

let passed = 0
const test = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`) }

console.log('visual — the scope job needs no dependencies')

test('the walker actually visits more than the entry file', () => {
  // A walker that stopped at the entry would report every graph clean, which
  // is exactly the failure that let the real one through.
  const { visited } = bareImports(SCOPE_JOB_ENTRIES[0])
  assert.ok(visited.size >= 4, `expected a real graph, walked ${visited.size} file(s)`)
})

for (const entry of SCOPE_JOB_ENTRIES) {
  test(`${entry} needs no installed package`, () => {
    const { problems } = bareImports(entry)
    assert.deepEqual(problems, [],
      'the Visual scope job installs nothing, so a bare import here fails the job that decides '
      + 'whether the expensive renders run at all')
  })
}

test('the guard CATCHES a bare import one hop away', () => {
  // The control. `screenStage.mjs` legitimately imports pngjs and puppeteer,
  // so walking it must report them — proving a clean result above means clean
  // rather than unlooked-at.
  const { problems } = bareImports('scripts/visual/screen/screenStage.mjs')
  assert.ok(problems.some((p) => p.spec === 'pngjs'), 'pngjs was not detected in the stage')
})

test('the page checks module has no imports at all', () => {
  // It is serialised into a browser; anything it imported would not exist there.
  assert.deepEqual(importsOf(resolve(HERE, 'screenPageChecks.js')), [])
})

console.log(`\nvisual screen purity: ${passed} passed`)
