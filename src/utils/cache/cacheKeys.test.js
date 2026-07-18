/**
 * Unit tests for cache key builders — the "never mix tenants" guarantee.
 *
 *   node src/utils/cache/cacheKeys.test.js
 */
import assert from 'node:assert/strict'
import {
  createCacheKey, createCacheKeyPrefix, createSearchCacheKey, createSearchCacheKeyPrefix,
  normalizeSearchText, normalizeFilters,
} from './cacheKeys.js'

let passed = 0
function test(name, fn) { fn(); passed++ }

// ── normalizeSearchText ──────────────────────────────────────────────────
test('normalizeSearchText trims, collapses whitespace, and lowercases', () => {
  assert.equal(normalizeSearchText('  Mathematics   Grade 7  '), 'mathematics grade 7')
  assert.equal(normalizeSearchText(undefined), '')
  assert.equal(normalizeSearchText(null), '')
})

// ── normalizeFilters ─────────────────────────────────────────────────────
test('normalizeFilters sorts keys and drops empty/undefined/null values', () => {
  assert.equal(normalizeFilters({ b: '2', a: '1', c: undefined, d: null, e: '' }), 'a=1&b=2')
  assert.equal(normalizeFilters({}), '')
  assert.equal(normalizeFilters(null), '')
})

test('normalizeFilters is order-independent', () => {
  assert.equal(
    normalizeFilters({ type: 'mcq', difficulty: 'easy' }),
    normalizeFilters({ difficulty: 'easy', type: 'mcq' }),
  )
})

// ── createCacheKey / createCacheKeyPrefix ────────────────────────────────
test('createCacheKey encodes missing parts distinctly from empty-string parts', () => {
  const withUndefined = createCacheKey(['a', undefined, 'c'])
  const withEmpty = createCacheKey(['a', '', 'c'])
  assert.notEqual(withUndefined, withEmpty)
})

test('createCacheKeyPrefix never matches an unrelated key with a longer shared prefix', () => {
  const prefix = createCacheKeyPrefix(['scope', 'u1'])
  assert.equal('scope:u1:rest'.startsWith(prefix), true)
  assert.equal('scope:u12:rest'.startsWith(prefix), false)
})

// ── createSearchCacheKey: tenant isolation (CLAUDE.md #13.2/#13.16) ──────
test('createSearchCacheKey requires a scope', () => {
  assert.throws(() => createSearchCacheKey({}), /scope/)
})

test('different users produce different keys, all else equal', () => {
  const base = { scope: 'question-bank', gradeId: '7', subjectId: 'Math' }
  const k1 = createSearchCacheKey({ ...base, userId: 'u1' })
  const k2 = createSearchCacheKey({ ...base, userId: 'u2' })
  assert.notEqual(k1, k2)
})

test('different schools produce different keys, all else equal', () => {
  const base = { scope: 'dashboard-summary', userId: 'u1' }
  const k1 = createSearchCacheKey({ ...base, schoolId: 's1' })
  const k2 = createSearchCacheKey({ ...base, schoolId: 's2' })
  assert.notEqual(k1, k2)
})

test('different curricula (id + version) produce different keys', () => {
  const base = { scope: 'syllabus-search', gradeId: '7', subjectId: 'Science' }
  const k1 = createSearchCacheKey({ ...base, curriculumId: 'cbc' })
  const k2 = createSearchCacheKey({ ...base, curriculumId: 'obc' })
  assert.notEqual(k1, k2)
  const k3 = createSearchCacheKey({ ...base, curriculumId: 'cbc', curriculumVersion: 'v1' })
  const k4 = createSearchCacheKey({ ...base, curriculumId: 'cbc', curriculumVersion: 'v2' })
  assert.notEqual(k3, k4)
})

test('different grades and subjects produce different keys', () => {
  const base = { scope: 'syllabus-search', curriculumId: 'cbc' }
  assert.notEqual(
    createSearchCacheKey({ ...base, gradeId: '7' }),
    createSearchCacheKey({ ...base, gradeId: '8' }),
  )
  assert.notEqual(
    createSearchCacheKey({ ...base, gradeId: '7', subjectId: 'Math' }),
    createSearchCacheKey({ ...base, gradeId: '7', subjectId: 'Science' }),
  )
})

test('different filters produce different keys', () => {
  const base = { scope: 'question-bank', userId: 'u1' }
  const k1 = createSearchCacheKey({ ...base, filters: { type: 'mcq' } })
  const k2 = createSearchCacheKey({ ...base, filters: { type: 'essay' } })
  assert.notEqual(k1, k2)
})

test('different queries produce different keys, but the same query normalises to the same key', () => {
  const base = { scope: 'question-bank', userId: 'u1' }
  const k1 = createSearchCacheKey({ ...base, query: 'photosynthesis' })
  const k2 = createSearchCacheKey({ ...base, query: 'mitosis' })
  assert.notEqual(k1, k2)
  const k3 = createSearchCacheKey({ ...base, query: '  Photosynthesis  ' })
  assert.equal(k1, k3)
})

test('the example from CLAUDE.md #13.2 style key stays stable and scoped', () => {
  const key = createSearchCacheKey({
    scope: 'syllabus-search', curriculumId: 'cbc', gradeId: '4', subjectId: 'science', query: 'photosynthesis',
  })
  assert.equal(typeof key, 'string')
  assert.ok(key.includes('syllabus-search'))
})

// ── createSearchCacheKeyPrefix: invalidation reach ───────────────────────
test('a user+school prefix invalidates entries regardless of downstream fields', () => {
  const full = createSearchCacheKey({
    scope: 'assessment-list', userId: 'u1', schoolId: 'sch1', curriculumId: 'cbc', gradeId: '7', query: 'anything',
  })
  const prefix = createSearchCacheKeyPrefix({ scope: 'assessment-list', userId: 'u1', schoolId: 'sch1' })
  assert.equal(full.startsWith(prefix), true)
})

test('a prefix for a different user does not match another user\'s key', () => {
  const full = createSearchCacheKey({ scope: 'assessment-list', userId: 'u1', schoolId: 'sch1' })
  const prefix = createSearchCacheKeyPrefix({ scope: 'assessment-list', userId: 'u2', schoolId: 'sch1' })
  assert.equal(full.startsWith(prefix), false)
})

test('createSearchCacheKeyPrefix requires a scope', () => {
  assert.throws(() => createSearchCacheKeyPrefix({ userId: 'u1' }), /scope/)
})

console.log(`✓ cacheKeys.test.js — ${passed} tests passed`)
