#!/usr/bin/env node
/**
 * Count invalidation: both sides of a move, one side of a create or delete, and
 * the lifecycle transitions that are path changes in disguise.
 *
 * Also proves the separation the whole lifecycle exists for — a working save
 * appears in NO folder-count query result and NO Needs-sorting query.
 *
 * Run: npm run test:library-invalidation
 */

import assert from 'node:assert/strict'
import { LIBRARY_TYPES } from '../../config/library.js'
import { STUDIO_BY_ID } from './studios.js'
import {
  buildFolderCountQueries,
  buildNeedsSortingQuery,
  folderCountKey,
  metaPath,
} from './queries.js'
import {
  invalidateLibraryPaths,
  libraryCountKeysFor,
  libraryPathKeys,
} from './invalidateLibraryPaths.js'
import { libraryCountCache, readCount } from './libraryCountCache.js'

let failures = 0
const queue = []
/** Queued so async cases are awaited in order — an unawaited assertion is a
 *  test that reports success by not having finished yet. */
function test(name, fn) {
  queue.push(async () => {
    try { await fn(); console.log(`  ✓ ${name}`) } catch (err) {
      failures++
      console.error(`  ✗ ${name}\n    ${err.message}`)
    }
  })
}

console.log('\nlibrary/invalidateLibraryPaths')

const UID = 'teacher_1'
const lessonPlans = STUDIO_BY_ID[LIBRARY_TYPES.LESSON_PLANS]

const meta = (overrides = {}) => ({
  createdBy: UID,
  studio: LIBRARY_TYPES.LESSON_PLANS,
  curriculum: 'cbc',
  grade: 'grade-4',
  term: 1,
  subject: 'mathematics',
  academicYear: 2026,
  libraryState: 'classified',
  classificationState: 'complete',
  ...overrides,
})

const keyFor = (path, { academicYear = 2026, bucket = null } = {}) => folderCountKey({
  createdBy: UID, studio: lessonPlans.id, academicYear, path, bucket,
})

/* ── Which counts a document contributes to ────────────────── */

test('a classified document contributes to every prefix of its path', () => {
  const keys = libraryCountKeysFor(meta())
  for (const path of [
    { curriculum: 'cbc' },
    { curriculum: 'cbc', grade: 'grade-4' },
    { curriculum: 'cbc', grade: 'grade-4', term: 1 },
    { curriculum: 'cbc', grade: 'grade-4', term: 1, subject: 'mathematics' },
  ]) {
    assert.ok(keys.includes(keyFor(path)), `missing ${JSON.stringify(path)}`)
  }
})

test('each key is emitted for the document year AND the all-years view', () => {
  const keys = libraryCountKeysFor(meta())
  assert.ok(keys.includes(keyFor({ curriculum: 'cbc' }, { academicYear: 2026 })))
  assert.ok(keys.includes(keyFor({ curriculum: 'cbc' }, { academicYear: null })))
})

test('a path stops at its first null', () => {
  // A plan with a grade but no term is counted by curriculum and grade, and by
  // nothing deeper — there is no term folder that should claim it.
  const keys = libraryCountKeysFor(meta({ term: null, classificationState: 'needs_sorting' }))
  assert.ok(keys.includes(keyFor({ curriculum: 'cbc', grade: 'grade-4' })))
  assert.ok(!keys.some((k) => k.includes(':1:')), 'no term-level key')
})

test('a needs-sorting document also contributes to the Unsorted bucket', () => {
  const keys = libraryCountKeysFor(meta({ grade: null, classificationState: 'needs_sorting' }))
  assert.ok(keys.includes(keyFor({}, { bucket: 'unsorted' })))
  assert.ok(keys.includes(keyFor({}, { academicYear: null, bucket: 'unsorted' })))
})

test('a working document contributes to NOTHING', () => {
  assert.deepEqual(libraryCountKeysFor(meta({ libraryState: 'working' })), [])
  assert.deepEqual(
    libraryCountKeysFor(meta({ libraryState: 'working', classificationState: 'needs_sorting' })),
    [],
    'not even to Needs-sorting',
  )
})

test('an archived document contributes to nothing', () => {
  assert.deepEqual(libraryCountKeysFor(meta({ libraryState: 'archived' })), [])
})

test('an unknown studio or a missing author yields nothing rather than a bad key', () => {
  assert.deepEqual(libraryCountKeysFor(meta({ studio: 'imaginary' })), [])
  assert.deepEqual(libraryCountKeysFor(meta({ createdBy: '' })), [])
  assert.deepEqual(libraryCountKeysFor(null), [])
})

/* ── before/after ──────────────────────────────────────────── */

test('a grade+term move invalidates BOTH trees', () => {
  const before = meta({ grade: 'grade-4', term: 1 })
  const after = meta({ grade: 'grade-5', term: 2 })
  const { countKeys } = libraryPathKeys(before, after)

  assert.ok(countKeys.includes(keyFor({ curriculum: 'cbc', grade: 'grade-4' })), 'old grade')
  assert.ok(countKeys.includes(keyFor({ curriculum: 'cbc', grade: 'grade-5' })), 'new grade')
  assert.ok(countKeys.includes(keyFor({ curriculum: 'cbc', grade: 'grade-4', term: 1 })), 'old term')
  assert.ok(countKeys.includes(keyFor({ curriculum: 'cbc', grade: 'grade-5', term: 2 })), 'new term')
})

test('a create yields the new paths only; a delete yields the old paths only', () => {
  const created = libraryPathKeys(null, meta())
  const deleted = libraryPathKeys(meta(), null)
  assert.deepEqual(created.countKeys.sort(), deleted.countKeys.sort())
  assert.ok(created.countKeys.length > 0)
  assert.deepEqual(libraryPathKeys(null, null), { countKeys: [], listPrefixes: [] })
})

test('working → classified invalidates the AFTER paths only', () => {
  const before = meta({ libraryState: 'working' })
  const after = meta({ libraryState: 'classified' })
  const { countKeys } = libraryPathKeys(before, after)
  assert.deepEqual(countKeys.sort(), libraryCountKeysFor(after).sort())
})

test('classified → archived invalidates the BEFORE paths only', () => {
  const before = meta({ libraryState: 'classified' })
  const after = meta({ libraryState: 'archived' })
  const { countKeys } = libraryPathKeys(before, after)
  assert.deepEqual(countKeys.sort(), libraryCountKeysFor(before).sort())
})

test('a transition into needs_sorting invalidates the Unsorted bucket', () => {
  const before = meta()
  const after = meta({ subject: null, classificationState: 'needs_sorting' })
  const { countKeys } = libraryPathKeys(before, after)
  assert.ok(countKeys.includes(keyFor({}, { bucket: 'unsorted' })))
  // …and so does a document leaving it.
  const cleared = libraryPathKeys(after, before)
  assert.ok(cleared.countKeys.includes(keyFor({}, { bucket: 'unsorted' })))
})

test('list caches are invalidated by prefix, covering every level', () => {
  const { listPrefixes } = libraryPathKeys(null, meta())
  assert.ok(listPrefixes.length > 0)
  assert.ok(listPrefixes.every((p) => p.startsWith('library:list:')), 'list keys, not count keys')
  assert.ok(listPrefixes.every((p) => p.endsWith(':')), 'prefixes are separator-terminated')
})

/* ── The keys a folder view actually reads ─────────────────── */

test('the keys the invalidator drops are the keys the folder view reads', () => {
  // If these two ever disagree, every count in the library goes stale silently.
  const descriptors = buildFolderCountQueries(
    lessonPlans, { curriculum: 'cbc', grade: 'grade-4' }, { createdBy: UID, academicYear: 2026 },
  )
  const term1 = descriptors.find((d) => d.value === 1)
  assert.ok(libraryCountKeysFor(meta()).includes(term1.key))
})

test('a working save appears in no folder-count query and no Needs-sorting query', () => {
  // The classification-state separation, asserted against the query contracts:
  // both carry `libraryState == 'classified'`, which a working document is not.
  const stateFilter = (q) => q.filters.find((f) => f[0] === metaPath('libraryState'))[2]
  for (const descriptor of buildFolderCountQueries(lessonPlans, {}, { createdBy: UID })) {
    assert.equal(stateFilter(descriptor), 'classified')
  }
  assert.equal(stateFilter(buildNeedsSortingQuery(lessonPlans, { createdBy: UID })), 'classified')
})

/* ── The cache itself ──────────────────────────────────────── */

test('invalidateLibraryPaths actually drops the cached counts', async () => {
  libraryCountCache.clear()
  const key = keyFor({ curriculum: 'cbc' })
  await readCount(key, async () => 3)
  assert.equal(libraryCountCache.get(key), 3)

  invalidateLibraryPaths(null, meta())
  assert.equal(libraryCountCache.get(key), undefined, 'the stale count is gone')

  // …and the next read fetches again rather than serving the old number.
  const fresh = await readCount(key, async () => 4)
  assert.equal(fresh, 4)
  libraryCountCache.clear()
})

test('an unrelated teacher’s counts are untouched', async () => {
  libraryCountCache.clear()
  const mine = keyFor({ curriculum: 'cbc' })
  const theirs = folderCountKey({
    createdBy: 'teacher_2', studio: lessonPlans.id, academicYear: 2026, path: { curriculum: 'cbc' },
  })
  await readCount(mine, async () => 1)
  await readCount(theirs, async () => 9)

  invalidateLibraryPaths(null, meta())
  assert.equal(libraryCountCache.get(mine), undefined)
  assert.equal(libraryCountCache.get(theirs), 9)
  libraryCountCache.clear()
})

for (const run of queue) await run()

if (failures) {
  console.error(`\n${failures} test(s) failed\n`)
  process.exit(1)
}
console.log('\nAll library/invalidateLibraryPaths tests passed\n')
