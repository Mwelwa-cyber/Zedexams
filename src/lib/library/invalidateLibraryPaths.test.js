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

test('a complete document with an optional level unfilled stops at its first null', () => {
  // Class timetables require only a grade, so this document is complete with a
  // null term — and is counted by the levels it actually has.
  const timetableMeta = {
    createdBy: UID,
    studio: LIBRARY_TYPES.CLASS_TIMETABLES,
    curriculum: 'cbc',
    grade: 'grade-4',
    term: null,
    academicYear: 2026,
    libraryState: 'classified',
    classificationState: 'complete',
  }
  const timetables = STUDIO_BY_ID[LIBRARY_TYPES.CLASS_TIMETABLES]
  const keyForTimetable = (path) => folderCountKey({
    createdBy: UID, studio: timetables.id, academicYear: 2026, path,
  })
  const keys = libraryCountKeysFor(timetableMeta)
  assert.ok(keys.includes(keyForTimetable({ curriculum: 'cbc' })))
  assert.ok(keys.includes(keyForTimetable({ curriculum: 'cbc', grade: 'grade-4' })))
  assert.ok(!keys.some((k) => k.endsWith(':1:NONE:NONE')), 'no term-level key')
})

test('a needs-sorting document contributes to the Unsorted bucket and NOTHING else', () => {
  // A partially filed document has one home. Counting it toward the prefix that
  // WAS filled in produced a Grade 4 folder reporting one item whose every term
  // child was empty, and whose document could not be reached by drilling at all.
  const keys = libraryCountKeysFor(meta({ term: null, classificationState: 'needs_sorting' }))
  assert.ok(keys.includes(keyFor({}, { bucket: 'unsorted' })))
  assert.ok(keys.includes(keyFor({}, { academicYear: null, bucket: 'unsorted' })))
  assert.ok(
    !keys.includes(keyFor({ curriculum: 'cbc' })),
    'the curriculum folder must not count a document it cannot show',
  )
  assert.ok(!keys.includes(keyFor({ curriculum: 'cbc', grade: 'grade-4' })))
  assert.equal(keys.length, 2, 'the two year views of the one bucket, and nothing more')
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

test('a transition into needs_sorting drops BOTH the old folders and the bucket', () => {
  const before = meta()
  const after = meta({ subject: null, classificationState: 'needs_sorting' })
  const { countKeys } = libraryPathKeys(before, after)
  // The bucket gains it…
  assert.ok(countKeys.includes(keyFor({}, { bucket: 'unsorted' })))
  // …and every folder it used to be counted in has to be re-read, or those
  // folders keep claiming a document that is no longer in them.
  assert.ok(countKeys.includes(keyFor({ curriculum: 'cbc', grade: 'grade-4' })))
  assert.ok(countKeys.includes(keyFor({ curriculum: 'cbc', grade: 'grade-4', term: 1 })))

  // …and the same in reverse when a teacher files it from the triage screen.
  const cleared = libraryPathKeys(after, before)
  assert.ok(cleared.countKeys.includes(keyFor({}, { bucket: 'unsorted' })))
  assert.ok(cleared.countKeys.includes(keyFor({ curriculum: 'cbc', grade: 'grade-4' })))
})

test('a needs-sorting document invalidates the triage list cache', () => {
  // The triage list caches under its own namespace, so invalidating the folder
  // lists alone would leave Sort-now listing a document the teacher just filed.
  const unsorted = meta({ grade: null, classificationState: 'needs_sorting' })
  const { listPrefixes } = libraryPathKeys(null, unsorted)
  assert.ok(
    listPrefixes.some((p) => p.startsWith('library:needs-sorting:')),
    'the needs-sorting namespace is never invalidated',
  )

  // Filing it clears the triage list too — that is the `before` side.
  const filed = libraryPathKeys(unsorted, meta())
  assert.ok(filed.listPrefixes.some((p) => p.startsWith('library:needs-sorting:')))
})

test('list caches are invalidated by prefix, covering every level', () => {
  const { listPrefixes } = libraryPathKeys(null, meta())
  assert.ok(listPrefixes.length > 0)
  assert.ok(listPrefixes.every((p) => p.startsWith('library:list:')), 'list keys, not count keys')
  assert.ok(listPrefixes.every((p) => p.endsWith(':')), 'prefixes are separator-terminated')
})

test('the keys the invalidator drops match what the queries actually count', () => {
  // The pairing that keeps folder totals honest: a complete document is counted
  // by the folder queries and invalidates folder keys; a needs-sorting one is
  // counted by the Unsorted query and invalidates the Unsorted key.
  const classificationOf = (descriptor) => descriptor.filters
    .find((f) => f[0] === metaPath('classificationState'))?.[2]

  const descriptors = buildFolderCountQueries(lessonPlans, {}, { createdBy: UID })
  for (const descriptor of descriptors.filter((d) => d.bucket === 'candidate')) {
    assert.equal(classificationOf(descriptor), 'complete', descriptor.label)
  }
  const [unsorted] = descriptors.filter((d) => d.bucket === 'unsorted')
  assert.equal(classificationOf(unsorted), 'needs_sorting')
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
