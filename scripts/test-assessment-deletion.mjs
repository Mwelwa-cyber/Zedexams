// Regression tests for the assessment deletion registry's pure core
// (src/utils/assessmentDeletionCore.js) and the autosave deletion guard
// (src/features/assessmentStudio/lib/assessmentAutosave.js).
//
// The bug these guard: a paper deleted from the Assessment Studio library came
// back after a refresh / re-entry, because nothing stopped the editor's
// continuous library autosave from re-persisting it and nothing masked a stale
// offline-cache read. The registry records a tombstone (persisted across a
// refresh, broadcast across tabs) that the read paths filter and the write
// paths refuse.

import assert from 'node:assert/strict'
import {
  parseTombstones,
  serializeTombstones,
  addTombstone,
  removeTombstone,
  filterDeleted,
  shouldSkipPersist,
  buildDeletionLogEntry,
  MAX_TOMBSTONES,
} from '../src/utils/assessmentDeletionCore.js'
import { shouldAutosaveToLibrary } from '../src/features/assessmentStudio/lib/assessmentAutosave.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('parse / serialize')

test('parseTombstones tolerates junk and dedupes/trims', () => {
  assert.deepEqual(parseTombstones('not json'), [])
  assert.deepEqual(parseTombstones('{"a":1}'), [])
  assert.deepEqual(parseTombstones(null), [])
  assert.deepEqual(parseTombstones('["a"," a ","a","",null,"b"]'), ['a', 'b'])
})

test('serializeTombstones round-trips and caps to the newest MAX', () => {
  const many = Array.from({ length: MAX_TOMBSTONES + 10 }, (_, i) => `id-${i}`)
  const parsed = parseTombstones(serializeTombstones(many))
  assert.equal(parsed.length, MAX_TOMBSTONES)
  // Oldest fall off the front; newest survive.
  assert.equal(parsed[parsed.length - 1], `id-${MAX_TOMBSTONES + 9}`)
  assert.equal(parsed[0], 'id-10')
})

console.log('add / remove (immutable)')

test('addTombstone appends, dedupes, and never mutates the input', () => {
  const base = ['a']
  const r1 = addTombstone(base, 'b')
  assert.deepEqual(r1.ids, ['a', 'b'])
  assert.equal(r1.changed, true)
  assert.deepEqual(base, ['a'], 'input untouched')
  const r2 = addTombstone(r1.ids, 'a')
  assert.equal(r2.changed, false)
  assert.deepEqual(r2.ids, ['a', 'b'])
  assert.equal(addTombstone(base, '   ').changed, false)
})

test('removeTombstone drops an id and reports change', () => {
  const r = removeTombstone(['a', 'b'], 'a')
  assert.deepEqual(r.ids, ['b'])
  assert.equal(r.changed, true)
  assert.equal(removeTombstone(['a'], 'zzz').changed, false)
})

console.log('filterDeleted')

test('filterDeleted removes tombstoned items (Set or Array source)', () => {
  const items = [{ id: 'keep' }, { id: 'gone' }, { id: 'keep2' }]
  assert.deepEqual(filterDeleted(items, new Set(['gone'])).map(i => i.id), ['keep', 'keep2'])
  assert.deepEqual(filterDeleted(items, ['gone']).map(i => i.id), ['keep', 'keep2'])
  assert.deepEqual(filterDeleted(items, new Set()).map(i => i.id), ['keep', 'gone', 'keep2'])
  // Custom id accessor + empty input.
  assert.deepEqual(filterDeleted([{ pid: 'x' }], new Set(['x']), i => i.pid), [])
  assert.deepEqual(filterDeleted([], new Set(['x'])), [])
})

console.log('shouldSkipPersist')

test('a tombstoned target is refused; a new paper (no id) is allowed', () => {
  assert.equal(shouldSkipPersist('X', () => true), true)
  assert.equal(shouldSkipPersist('X', () => false), false)
  assert.equal(shouldSkipPersist('X', true), true)
  // A brand-new paper has no target id → always allowed to persist.
  assert.equal(shouldSkipPersist('', () => true), false)
  assert.equal(shouldSkipPersist(null, () => true), false)
})

console.log('buildDeletionLogEntry — no PII leak')

test('only whitelisted fields survive; question content is dropped', () => {
  const entry = buildDeletionLogEntry({
    event: 'assessment_delete',
    assessmentId: 'a1',
    userId: 'u1',
    deletionMode: 'permanent',
    source: 'assessment-studio',
    startedAt: 1000,
    completedAt: 1200,
    success: true,
    // Sensitive junk a caller might accidentally pass — must NOT appear.
    questionText: 'What is 2+2?',
    learnerAnswer: '4',
    token: 'secret',
    title: 'Confidential Exam',
  })
  assert.deepEqual(Object.keys(entry).sort(), [
    'assessmentId', 'completedAt', 'deletionMode', 'durationMs',
    'event', 'source', 'startedAt', 'success', 'userId',
  ])
  assert.equal(entry.durationMs, 200)
  assert.equal('questionText' in entry, false)
  assert.equal('learnerAnswer' in entry, false)
  assert.equal('token' in entry, false)
  assert.equal('title' in entry, false)
})

test('defaults event and omits durationMs when timings are partial', () => {
  const entry = buildDeletionLogEntry({ assessmentId: 'a1', success: false, errorCode: 'permission-denied' })
  assert.equal(entry.event, 'assessment_delete')
  assert.equal('durationMs' in entry, false)
  assert.equal(entry.errorCode, 'permission-denied')
})

console.log('shouldAutosaveToLibrary — deletion guard')

const baseAutosave = {
  uid: 'teacher-1',
  // Questions with content in them — the gate deliberately does not read the
  // raw count, which includes the blank starter question a new paper is seeded
  // with (that is what filed phantom papers on every visit to /new).
  authoredQuestionCount: 3,
  libraryDirty: true,
  saving: false,
  exporting: false,
  editLoading: false,
  importing: false,
  generating: false,
}

test('a deleted paper is never autosaved (the resurrection guard)', () => {
  assert.equal(shouldAutosaveToLibrary({ ...baseAutosave, deleted: true }), false)
  // Sanity: the same paper WOULD autosave when not deleted.
  assert.equal(shouldAutosaveToLibrary({ ...baseAutosave, deleted: false }), true)
})

console.log(`\n${passed} assertions passed.`)
