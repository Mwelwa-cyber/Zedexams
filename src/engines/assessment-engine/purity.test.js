/**
 * The engine's pure layers stay pure — enforced by a SOURCE scan.
 *
 * ## Why a scan and not an import
 *
 * An earlier draft of this guard imported the front door under `node` and
 * called that neutrality. A control disproved it in one run: adding
 * `import { useState } from 'react'` to an adapter changed nothing, because
 * `react` resolves perfectly well under node. Importing proves a module loads
 * in the environment already known to work, which is not the property in
 * question. `functions/shared/assessment/neutrality.test.js` says the same
 * thing in its own docblock, and it was right.
 *
 * ## What is scanned, and what deliberately is not
 *
 * `schemas/` and `normalise/` only — the contract and the adapters. These are
 * the layers the plain-node suite tests, and they stay testable only while they
 * import nothing that needs a browser.
 *
 * `render/` is NOT scanned and must not be: §4 gives the engine question
 * renderers, and those are React components by definition. The rule is not "no
 * React in the engine", which would be false; it is "no React in the layers
 * that must run under node". Adding a directory here is a deliberate act, which
 * is the point — the list names what it protects.
 *
 * Firebase is forbidden everywhere in the engine by the Phase 1 ESLint rule,
 * but that rule matches DIRECT specifiers only. This scan is the second line
 * for the two directories where a violation would also break `test:all`.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The directories whose contents must run under plain node. */
const PURE_DIRS = ['schemas', 'normalise']

/** [pattern, why]. The "why" prints on failure — a bare token teaches nothing. */
const FORBIDDEN = [
  [/\bfrom\s+['"]react['"]/, 'React — these layers are tested under plain node, and the contract must stay renderer-agnostic'],
  [/\bfrom\s+['"]react-dom/, 'react-dom — same reason'],
  [/\bfrom\s+['"]firebase[/'"]/, 'the Firebase client SDK — an engine reaches Firebase through src/services/ (§14.2)'],
  [/\bfrom\s+['"]firebase-admin/, 'firebase-admin — server-only, and it would be bundled into the browser'],
  [/\bfrom\s+['"][^'"]*\/(features|app)\//, 'a feature or the app shell — an engine is consumed BY features (§2); importing one inverts the layering'],
  [/\bdocument\s*\./, 'the DOM — there is no document under node'],
  [/\bwindow\s*\./, 'the DOM — there is no window under node'],
  [/\bnavigator\s*\./, 'the DOM'],
  [/\bDOMParser\b/, 'DOMParser — the DOM-free path has to be the only path in the contract'],
  [/\blocalStorage\b/, 'localStorage — persistence is a session/service concern, not a contract one'],
]

/**
 * Strip block and line comments before scanning.
 *
 * A word in prose is not an import. Without this the scan flagged this very
 * engine's own docblocks — `fromQuiz` explains that a quiz attempt is resumable
 * "(localStorage today)", and `fromGame` describes a `games/{id}` document — and
 * a guard that fires on its own documentation gets silenced rather than fixed.
 * `test-rules-collection-coverage` strips for the same reason.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function filesIn(dir) {
  const abs = join(HERE, dir)
  const out = []
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry)
    if (statSync(full).isDirectory()) continue
    if (!entry.endsWith('.js') || entry.endsWith('.test.js')) continue
    out.push(full)
  }
  return out
}

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

console.log('assessment engine — purity of the node-tested layers')

const scanned = PURE_DIRS.flatMap(filesIn)

// A scan over nothing passes vacuously, which is the failure mode that makes a
// guard look green while guarding an empty set.
test('the scan actually found files to scan', () => {
  assert.ok(scanned.length >= 3, `expected at least 3 source files, found ${scanned.length}`)
})

for (const file of scanned) {
  const rel = relative(HERE, file)
  const src = stripComments(readFileSync(file, 'utf8'))
  test(`${rel} imports nothing that needs a browser`, () => {
    for (const [pattern, why] of FORBIDDEN) {
      const match = pattern.exec(src)
      assert.equal(match, null, match ? `${rel} contains ${JSON.stringify(match[0])} — ${why}` : '')
    }
  })
}

// The contract's own dependency direction: it may reach the shared package and
// the editor's pure schema, and nothing above it.
test('the contract is seeded from functions/shared/assessment, not a fork of it', () => {
  const schemas = readFileSync(join(HERE, 'schemas', 'index.js'), 'utf8')
  assert.ok(
    /functions\/shared\/assessment\/questionTypeCore\.js/.test(schemas),
    'the question-type vocabulary must come from the shared package (§4.1 note 5, §14.10)',
  )
  assert.ok(
    /functions\/shared\/assessment\/richTextContentCore\.js/.test(schemas),
    'RichContent handling must come from the shared package',
  )
})

console.log(`\nassessment engine purity: ${passed} passed`)
