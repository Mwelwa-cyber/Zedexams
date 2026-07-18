/**
 * Unit tests for pagination query keys — the "different query = different
 * session" guarantee.
 *
 *   node src/utils/pagination/queryKeys.test.js
 */
import assert from 'node:assert/strict'
import { createPaginationKey } from './queryKeys.js'

let passed = 0
function test(name, fn) { fn(); passed++ }

const base = {
  scope: 'question-bank', userId: 'u1', schoolId: 's1',
  curriculumId: 'CBC', gradeId: 'G4', subjectId: 'math',
  sortField: 'updatedAt', sortDirection: 'desc', pageSize: 25,
}

test('scope is required', () => {
  assert.throws(() => createPaginationKey({}), /requires a scope/)
})

test('identical inputs produce identical keys', () => {
  assert.equal(createPaginationKey(base), createPaginationKey({ ...base }))
})

test('changing the tenant changes the key (no cross-user cursor reuse)', () => {
  assert.notEqual(createPaginationKey(base), createPaginationKey({ ...base, userId: 'u2' }))
  assert.notEqual(createPaginationKey(base), createPaginationKey({ ...base, schoolId: 's2' }))
})

test('changing a curriculum facet changes the key', () => {
  assert.notEqual(createPaginationKey(base), createPaginationKey({ ...base, gradeId: 'G7' }))
  assert.notEqual(createPaginationKey(base), createPaginationKey({ ...base, subjectId: 'science' }))
})

test('changing sort field or direction changes the key', () => {
  assert.notEqual(createPaginationKey(base), createPaginationKey({ ...base, sortField: 'createdAt' }))
  assert.notEqual(createPaginationKey(base), createPaginationKey({ ...base, sortDirection: 'asc' }))
})

test('changing page size changes the key', () => {
  assert.notEqual(createPaginationKey(base), createPaginationKey({ ...base, pageSize: 50 }))
})

test('search text is normalised into the key (whitespace/case-insensitive)', () => {
  assert.equal(
    createPaginationKey({ ...base, search: '  Fractions ' }),
    createPaginationKey({ ...base, search: 'fractions' }),
  )
  assert.notEqual(
    createPaginationKey({ ...base, search: 'fractions' }),
    createPaginationKey({ ...base, search: 'decimals' }),
  )
})

test('filters are order-independent in the key', () => {
  assert.equal(
    createPaginationKey({ ...base, filters: { difficulty: 'easy', type: 'mcq' } }),
    createPaginationKey({ ...base, filters: { type: 'mcq', difficulty: 'easy' } }),
  )
  assert.notEqual(
    createPaginationKey({ ...base, filters: { difficulty: 'easy' } }),
    createPaginationKey({ ...base, filters: { difficulty: 'hard' } }),
  )
})

test('an undefined facet never collides with an empty-string one', () => {
  assert.notEqual(
    createPaginationKey({ scope: 'x', gradeId: undefined }),
    createPaginationKey({ scope: 'x', gradeId: '' }),
  )
})

console.log(`queryKeys.test.js: ${passed} passed`)
