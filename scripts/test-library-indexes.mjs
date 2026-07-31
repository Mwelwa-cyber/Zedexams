#!/usr/bin/env node
/* global console, process */
/**
 * The library's composite indexes are DERIVED from its query contracts, and the
 * rules' grade allowlist is DERIVED from the education ladder. This script is
 * what makes "derived" true rather than aspirational: it recomputes both from
 * the source modules and fails if `firestore.indexes.json` or `firestore.rules`
 * has fallen behind.
 *
 * Why it matters more here than usual. A missing composite index does not fail
 * at deploy — it fails in a teacher's browser, at the moment they open a folder,
 * as an opaque FAILED_PRECONDITION. A grade id the rules do not know does not
 * fail visibly either: the write is denied and the document simply never
 * appears. Both are silent in exactly the way virtual folders cannot afford.
 *
 * Scope note: only queries with an `orderBy` are checked against the index file.
 * Firestore serves equality-only queries by merging single-field indexes, so the
 * count queries — which are the bulk of what the builders emit — need no
 * composite index at all. Declaring them anyway would add write amplification to
 * a shared collection for nothing.
 *
 * Run: npm run test:library-indexes
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import { STUDIOS } from '../src/lib/library/studios.js'
import { enumerateQueryShapes } from '../src/lib/library/queries.js'
import { LIBRARY_GRADES } from '../src/lib/library/taxonomy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const indexes = JSON.parse(readFileSync(join(ROOT, 'firestore.indexes.json'), 'utf8'))
const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8')

// `requiredIndexes` below is also imported by tooling that regenerates the
// index file, so the assertions only run when this file is the entry point —
// importing it must not exit the importing process.
const IS_MAIN = resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  if (!IS_MAIN) return
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/* ── The index set the query contracts require ─────────────── */

/**
 * A studio that never accepts a teacher write can never hold the metadata, so
 * indexing its collection for it would be indexing a field that is never set.
 */
const WRITABLE_STUDIOS = STUDIOS.filter((s) => !s.readOnly)

export function requiredIndexes() {
  const required = new Map()
  for (const studio of WRITABLE_STUDIOS) {
    for (const shape of enumerateQueryShapes(studio)) {
      // Equality-only queries are served by single-field index merging.
      if (!shape.orderBy) continue
      const fields = [
        ...shape.equalityFields.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' })),
        {
          fieldPath: shape.orderBy.field,
          order: shape.orderBy.direction === 'desc' ? 'DESCENDING' : 'ASCENDING',
        },
      ]
      const signature = `${shape.collection}|${fields.map((f) => `${f.fieldPath}:${f.order}`).join(',')}`
      if (!required.has(signature)) {
        required.set(signature, {
          collectionGroup: shape.collection,
          queryScope: 'COLLECTION',
          fields,
        })
      }
    }
  }
  return [...required.values()]
}

const signatureOf = (index) => [
  index.collectionGroup,
  (index.fields || []).map((f) => `${f.fieldPath}:${f.order || f.arrayConfig}`).join(','),
].join('|')

const declared = new Set(indexes.indexes.map(signatureOf))

test('every library query with an orderBy has a composite index declared', () => {
  const missing = requiredIndexes().filter((idx) => !declared.has(signatureOf(idx)))
  assert(
    missing.length === 0,
    `${missing.length} library index(es) missing from firestore.indexes.json:\n` +
    missing.map((m) => `  ${JSON.stringify(m)}`).join('\n'),
  )
})

test('the library indexes stay within a sane budget for a shared collection', () => {
  // Eleven of the twelve studios share `aiGenerations`, so each index here is
  // write amplification on every generation. This is a tripwire, not a limit —
  // if it fires, ask whether the new query is worth its index before raising it.
  const libraryIndexes = requiredIndexes()
  assert(
    libraryIndexes.length <= 40,
    `the query contracts now need ${libraryIndexes.length} composite indexes; ` +
    'adding a sort or a hierarchy level multiplies this — confirm it is wanted',
  )
})

test('the whole index file stays under the Firestore per-database ceiling', () => {
  assert(
    indexes.indexes.length <= 200,
    `firestore.indexes.json declares ${indexes.indexes.length} composite indexes; ` +
    'Firestore allows 200 per database',
  )
})

test('every library index is scoped by its collection\'s owner field', () => {
  // The first field must be the owner, because that is what the read rules gate
  // list and count queries on — an index that leads with anything else backs a
  // query Firestore will refuse before it ever reaches the index.
  const ownerFields = new Set(WRITABLE_STUDIOS.map((s) => s.ownerField))
  for (const index of requiredIndexes()) {
    assert(
      ownerFields.has(index.fields[0].fieldPath),
      `library index leads with "${index.fields[0].fieldPath}", not an owner field`,
    )
    for (const field of index.fields.slice(1)) {
      assert(
        field.fieldPath.startsWith('libraryMeta.'),
        `library index field "${field.fieldPath}" is not part of the metadata block`,
      )
    }
  }
})

/* ── The rules' grade allowlist mirrors the ladder ─────────── */

test('firestore.rules _validLibraryGrade mirrors the education ladder exactly', () => {
  const match = rules.match(/function _validLibraryGrade\(value\)\s*\{[\s\S]*?\}/)
  assert(match, '_validLibraryGrade not found in firestore.rules')
  const declaredIds = [...match[0].matchAll(/'([a-z][a-z0-9-]*)'/g)].map((m) => m[1])
  const expected = LIBRARY_GRADES.map((g) => g.id)

  const missing = expected.filter((id) => !declaredIds.includes(id))
  const extra = declaredIds.filter((id) => !expected.includes(id))
  assert(missing.length === 0, `rules reject grade id(s) the ladder declares: ${missing.join(', ')}`)
  assert(extra.length === 0, `rules allow grade id(s) the ladder does not declare: ${extra.join(', ')}`)
})

test('firestore.rules pins the library block to personal scope', () => {
  // Until a school membership model exists, a client that could write
  // scope:'school' would create documents no other teacher can safely reach.
  assert(
    /libMeta\(\)\.scope == 'personal'/.test(rules),
    'the personal-scope pin is missing from validLibraryMeta',
  )
  assert(
    /libMeta\(\)\.schoolId == null/.test(rules),
    'the null-schoolId pin is missing from validLibraryMeta',
  )
})

if (IS_MAIN) {
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) {
    console.error('\nFailures:')
    for (const f of failures) console.error(`  • ${f.name}: ${f.message}`)
    process.exit(1)
  }
}
