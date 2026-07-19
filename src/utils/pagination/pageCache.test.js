/**
 * Unit tests for the pagination page cache.
 *
 *   node src/utils/pagination/pageCache.test.js
 */
import assert from 'node:assert/strict'
import {
  getPageCache, pageCacheKey, fetchPageCached, invalidatePageScope,
  clearAllPageCaches, _resetPageCachesForTests,
} from './pageCache.js'

let passed = 0
async function test(name, fn) { await fn(); passed++ }

async function main() {
  await test('pageCacheKey encodes the start sentinel and cursor id', () => {
    assert.equal(pageCacheKey('page:a', null), 'page:a::start')
    assert.equal(pageCacheKey('page:a', { id: 'd1' }), 'page:a::d1')
  })

  await test('a cached page is served without re-reading', async () => {
    _resetPageCachesForTests()
    let calls = 0
    const fetcher = async () => { calls += 1; return { items: [{ id: 'a' }], hasNextPage: false } }
    const a = await fetchPageCached('scope1', 'page:k', null, fetcher, { ttlMs: 60000 })
    const b = await fetchPageCached('scope1', 'page:k', null, fetcher, { ttlMs: 60000 })
    assert.equal(calls, 1)
    assert.equal(a, b)
    assert.deepEqual(a.items.map(x => x.id), ['a'])
  })

  await test('concurrent identical page requests share one in-flight read (dedup)', async () => {
    _resetPageCachesForTests()
    let calls = 0
    const fetcher = () => { calls += 1; return new Promise(r => setTimeout(() => r({ items: [], hasNextPage: false }), 10)) }
    const [x, y] = await Promise.all([
      fetchPageCached('scope2', 'page:k', null, fetcher),
      fetchPageCached('scope2', 'page:k', null, fetcher),
    ])
    assert.equal(calls, 1)
    assert.equal(x, y)
  })

  await test('different cursors are cached independently', async () => {
    _resetPageCachesForTests()
    let calls = 0
    const fetcher = async () => { calls += 1; return { items: [{ id: `c${calls}` }], hasNextPage: true } }
    await fetchPageCached('scope3', 'page:k', null, fetcher)
    await fetchPageCached('scope3', 'page:k', { id: 'd1' }, fetcher)
    assert.equal(calls, 2)
  })

  await test('bypass forces a fresh read but repopulates the cache', async () => {
    _resetPageCachesForTests()
    let calls = 0
    const fetcher = async () => { calls += 1; return { items: [{ id: `v${calls}` }], hasNextPage: false } }
    await fetchPageCached('scope4', 'page:k', null, fetcher)
    const fresh = await fetchPageCached('scope4', 'page:k', null, fetcher, { bypass: true })
    assert.equal(calls, 2)
    assert.deepEqual(fresh.items.map(x => x.id), ['v2'])
    // now cached again — no third call
    await fetchPageCached('scope4', 'page:k', null, fetcher)
    assert.equal(calls, 2)
  })

  await test('a rejected fetch is never cached', async () => {
    _resetPageCachesForTests()
    let calls = 0
    const fetcher = async () => { calls += 1; throw new Error('boom') }
    await assert.rejects(() => fetchPageCached('scope5', 'page:k', null, fetcher))
    await assert.rejects(() => fetchPageCached('scope5', 'page:k', null, fetcher))
    assert.equal(calls, 2) // retried, not served from a poisoned cache
  })

  await test('invalidatePageScope with a queryKey clears only that session', async () => {
    _resetPageCachesForTests()
    let calls = 0
    const fetcher = async () => { calls += 1; return { items: [], hasNextPage: false } }
    await fetchPageCached('scope6', 'page:A', null, fetcher)
    await fetchPageCached('scope6', 'page:B', null, fetcher)
    invalidatePageScope('scope6', 'page:A')
    await fetchPageCached('scope6', 'page:A', null, fetcher) // re-read (invalidated)
    await fetchPageCached('scope6', 'page:B', null, fetcher) // still cached
    assert.equal(calls, 3)
  })

  await test('a read in flight when its scope is invalidated does not repopulate the cache', async () => {
    _resetPageCachesForTests()
    let calls = 0
    let resolveFirst
    const gate = new Promise((r) => { resolveFirst = r })
    const slowFetcher = async () => { calls += 1; await gate; return { items: [{ id: 'stale' }], hasNextPage: false } }

    // Kick off a page read and, WHILE it is still in flight, invalidate the scope
    // (as a create/update/delete would).
    const inflight = fetchPageCached('scope-inflight', 'page:k', null, slowFetcher, { ttlMs: 60000 })
    invalidatePageScope('scope-inflight')
    resolveFirst()
    await inflight // the in-flight caller still gets its value…

    // …but the stale pre-invalidation page must NOT have been written to the
    // cache, so the next read re-fetches instead of serving the stale row.
    const fresh = await fetchPageCached('scope-inflight', 'page:k', null, slowFetcher, { ttlMs: 60000 })
    assert.equal(calls, 2, 'the post-invalidation read must hit the fetcher, not a repopulated stale entry')
    assert.deepEqual(fresh.items.map(x => x.id), ['stale']) // second call's value, freshly read
  })

  await test('clearAllPageCaches empties every scope', async () => {
    _resetPageCachesForTests()
    const fetcher = async () => ({ items: [], hasNextPage: false })
    await fetchPageCached('scope7', 'page:k', null, fetcher)
    const cache = getPageCache('scope7')
    assert.ok(cache.size >= 1)
    clearAllPageCaches()
    assert.equal(cache.size, 0)
  })

  console.log(`pageCache.test.js: ${passed} passed`)
}

main().catch((e) => { console.error(e); process.exit(1) })
