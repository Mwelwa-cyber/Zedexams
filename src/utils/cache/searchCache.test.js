/**
 * Unit tests for searchCache — scoped search caching, invalidation, and the
 * logout-time clear-everything hatch.
 *
 *   node src/utils/cache/searchCache.test.js
 */
import assert from 'node:assert/strict'
import {
  getSearchCache, cachedSearch, invalidateSearchScope, clearAllSearchCaches,
  _resetSearchCachesForTests, CACHE_TTL,
} from './searchCache.js'

let passed = 0
async function test(name, fn) { await fn(); passed++ }

await test('getSearchCache returns the same instance for the same scope', () => {
  _resetSearchCachesForTests()
  const a = getSearchCache('question-bank')
  const b = getSearchCache('question-bank')
  assert.equal(a, b)
})

await test('different scopes get independent cache instances', () => {
  _resetSearchCachesForTests()
  const a = getSearchCache('question-bank')
  const b = getSearchCache('syllabus-search')
  assert.notEqual(a, b)
})

await test('cachedSearch requires keyFields.scope', () => {
  _resetSearchCachesForTests()
  assert.throws(() => cachedSearch({}, async () => []), /scope/)
})

await test('cachedSearch on a fresh key calls the fetcher once; a repeat call hits the cache', async () => {
  _resetSearchCachesForTests()
  let calls = 0
  const fetcher = async () => { calls++; return ['Mathematics'] }
  const keyFields = { scope: 'question-bank', userId: 'u1', query: 'math' }
  const r1 = await cachedSearch(keyFields, fetcher)
  const r2 = await cachedSearch(keyFields, fetcher)
  assert.deepEqual(r1, ['Mathematics'])
  assert.deepEqual(r2, ['Mathematics'])
  assert.equal(calls, 1)
})

await test('different users searching the same scope+query never share a cached result', async () => {
  _resetSearchCachesForTests()
  const fetcherFor = (uid) => async () => [`${uid}-result`]
  const r1 = await cachedSearch({ scope: 'question-bank', userId: 'u1', query: 'math' }, fetcherFor('u1'))
  const r2 = await cachedSearch({ scope: 'question-bank', userId: 'u2', query: 'math' }, fetcherFor('u2'))
  assert.deepEqual(r1, ['u1-result'])
  assert.deepEqual(r2, ['u2-result'])
})

await test('a rejected search is never cached as an empty success', async () => {
  _resetSearchCachesForTests()
  let calls = 0
  const failThenSucceed = async () => {
    calls++
    if (calls === 1) throw new Error('Firestore unavailable')
    return ['recovered']
  }
  const keyFields = { scope: 'question-bank', userId: 'u1', query: 'math' }
  await assert.rejects(() => cachedSearch(keyFields, failThenSucceed))
  const result = await cachedSearch(keyFields, failThenSucceed)
  assert.deepEqual(result, ['recovered'])
  assert.equal(calls, 2)
})

await test('invalidateSearchScope(scope, {userId, schoolId}) only removes that tenant\'s entries', async () => {
  _resetSearchCachesForTests()
  await cachedSearch({ scope: 'assessment-list', userId: 'u1', schoolId: 'sch1', query: 'a' }, async () => ['x'])
  await cachedSearch({ scope: 'assessment-list', userId: 'u2', schoolId: 'sch1', query: 'a' }, async () => ['y'])

  const removed = invalidateSearchScope('assessment-list', { userId: 'u1', schoolId: 'sch1' })
  assert.equal(removed, 1)

  let u1Calls = 0
  await cachedSearch({ scope: 'assessment-list', userId: 'u1', schoolId: 'sch1', query: 'a' }, async () => { u1Calls++; return ['x2'] })
  assert.equal(u1Calls, 1) // had to refetch — was invalidated

  let u2Calls = 0
  await cachedSearch({ scope: 'assessment-list', userId: 'u2', schoolId: 'sch1', query: 'a' }, async () => { u2Calls++; return ['y2'] })
  assert.equal(u2Calls, 0) // still cached — untouched by u1's invalidation
})

await test('invalidateSearchScope with no prefixFields clears the whole scope', async () => {
  _resetSearchCachesForTests()
  await cachedSearch({ scope: 'dashboard-summary', userId: 'u1', query: 'a' }, async () => ['x'])
  await cachedSearch({ scope: 'dashboard-summary', userId: 'u2', query: 'a' }, async () => ['y'])
  const removed = invalidateSearchScope('dashboard-summary')
  assert.equal(removed, 2)
})

await test('clearAllSearchCaches (logout) empties every scope', async () => {
  _resetSearchCachesForTests()
  await cachedSearch({ scope: 'question-bank', userId: 'u1', query: 'a' }, async () => ['x'])
  await cachedSearch({ scope: 'syllabus-search', userId: 'u1', query: 'a' }, async () => ['y'])
  const removed = clearAllSearchCaches()
  assert.equal(removed, 2)

  let calls = 0
  await cachedSearch({ scope: 'question-bank', userId: 'u1', query: 'a' }, async () => { calls++; return ['x2'] })
  assert.equal(calls, 1) // cache is gone, had to refetch
})

await test('CACHE_TTL exposes the documented recommended durations, all positive', () => {
  for (const [name, ms] of Object.entries(CACHE_TTL)) {
    assert.ok(Number.isFinite(ms) && ms > 0, `${name} should be a positive ms duration`)
  }
  // Sanity ordering: static framework data should outlive a user search.
  assert.ok(CACHE_TTL.STATIC_FRAMEWORK > CACHE_TTL.USER_SEARCH)
  assert.ok(CACHE_TTL.USER_SEARCH > CACHE_TTL.DASHBOARD_SUMMARY)
})

console.log(`✓ searchCache.test.js — ${passed} tests passed`)
