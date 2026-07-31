/**
 * The audit page's Lucide inventory must equal what the app imports.
 *
 * The failure this guards is quiet by construction. A stale list does not
 * break the page — it renders 104 icons perfectly while the app renders 106,
 * and the two it omits are the two most recently added, which are exactly the
 * ones most likely to be off-weight, off-baseline, or the wrong metaphor. An
 * audit that silently stops covering new work is worse than no audit, because
 * it is trusted.
 *
 * The derivation lives here rather than in the shipped module so no scanner
 * code reaches the browser bundle.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../..')
const SRC = join(root, 'src')
const INVENTORY = join(here, 'iconInventory.js')

/**
 * The inventory is PARSED rather than imported, and that is not fussiness:
 * importing it would pull in lucide-react, which turns a plain-node guard
 * into one that needs the frontend's dependency tree installed. Every other
 * `*.test.js` in this suite runs under bare `node`, and this one has no
 * reason to be the exception — it checks a list of strings.
 */
function listedIconNames() {
  const src = readFileSync(INVENTORY, 'utf8')
  const block = src.match(/export const LUCIDE_ICONS = Object\.freeze\(\{([\s\S]*?)\}\)/)
  assert.ok(block, 'no LUCIDE_ICONS map in iconInventory.js — has the module changed shape?')
  return block[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Z][A-Za-z0-9]*$/.test(s))
}

const LUCIDE_ICON_NAMES = listedIconNames()

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', 'android'])
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const file = join(dir, name)
    if (statSync(file).isDirectory()) walk(file, out)
    else if (['.js', '.jsx'].includes(extname(file))) out.push(file)
  }
  return out
}

/**
 * Every identifier imported from lucide-react across src/.
 *
 * The character class is `[^}]` rather than a lazy any-match, and that detail
 * is load-bearing: a lazy `[\s\S]*?` happily spans from an earlier
 * `import { Suspense } from 'react'` all the way to a later lucide import,
 * and reports `Suspense` as a Lucide icon. It is not one, the module has no
 * such export, and the page would crash on an undefined component.
 */
function importedLucideNames() {
  const names = new Set()
  for (const file of walk(SRC)) {
    // The inventory itself imports the whole set; counting it would make the
    // guard tautological.
    if (file.endsWith('iconInventory.js')) continue
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g)) {
      for (const part of m[1].split(',')) {
        const ident = part.trim().split(/\s+as\s+/)[0].trim()
        if (/^[A-Z][A-Za-z0-9]*$/.test(ident)) names.add(ident)
      }
    }
  }
  return [...names].sort()
}

console.log('\nthe audit page renders every Lucide icon the app imports')

test('the inventory matches the source tree exactly', () => {
  const actual = importedLucideNames()
  const listed = new Set(LUCIDE_ICON_NAMES)
  const used = new Set(actual)

  const missing = actual.filter((n) => !listed.has(n))
  const stale = LUCIDE_ICON_NAMES.filter((n) => !used.has(n))

  assert.deepEqual(
    { missing, stale },
    { missing: [], stale: [] },
    'src/components/dev/uiAudit/iconInventory.js has drifted from the codebase.\n' +
      (missing.length ? `  imported but NOT on the audit page: ${missing.join(', ')}\n` : '') +
      (stale.length ? `  on the audit page but no longer imported: ${stale.join(', ')}\n` : '') +
      '  Add or remove them in BOTH the import block and the LUCIDE_ICONS map.',
  )
})

test('the list is sorted, so a diff shows what changed', () => {
  assert.deepEqual(
    [...LUCIDE_ICON_NAMES],
    [...LUCIDE_ICON_NAMES].sort(),
    'LUCIDE_ICON_NAMES is not sorted — an unsorted list makes every regeneration a full-file diff.',
  )
})

test('the list has no duplicates', () => {
  assert.equal(new Set(LUCIDE_ICON_NAMES).size, LUCIDE_ICON_NAMES.length)
})

test('the inventory is not empty', () => {
  // A regex that stops matching returns an empty set, and an empty expected
  // set would make the equality check above pass against an empty list.
  assert.ok(
    LUCIDE_ICON_NAMES.length > 50,
    `only ${LUCIDE_ICON_NAMES.length} icons listed — the scanner has probably stopped matching`,
  )
})

console.log(`\n${passed} assertions passed.\n`)
