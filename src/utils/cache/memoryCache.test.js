/**
 * Unit tests for MemoryCache — TTL, LRU eviction, in-flight dedup, and
 * stale-while-revalidate.
 *
 *   node src/utils/cache/memoryCache.test.js
 *
 * Plain-node assertion script (throws on failure). Time is fully controlled
 * via the `now` clock-injection option so nothing here depends on the wall
 * clock or real timers (AI_DEVELOPMENT_GUIDE.md §4.6).
 */
import assert from 'node:assert/strict'
import { MemoryCache, createMemoryCache } from './memoryCache.js'

let passed = 0
async function test(name, fn) {
  await fn()
  passed++
}

function fakeClock(start = 0) {
  let t = start
  const now = () => t
  now.advance = (ms) => { t += ms }
  return now
}

// ── basic get/set/has ────────────────────────────────────────────────────
await test('set then get returns the stored value', () => {
  const cache = new MemoryCache({ now: fakeClock() })
  cache.set('k', { a: 1 })
  assert.deepEqual(cache.get('k'), { a: 1 })
  assert.equal(cache.has('k'), true)
})

await test('get on a miss returns undefined and does not throw', () => {
  const cache = new MemoryCache({ now: fakeClock() })
  assert.equal(cache.get('missing'), undefined)
  assert.equal(cache.has('missing'), false)
})

// ── TTL expiry ───────────────────────────────────────────────────────────
await test('an entry expires after its TTL elapses', () => {
  const clock = fakeClock()
  const cache = new MemoryCache({ now: clock, ttlMs: 1000 })
  cache.set('k', 'v')
  clock.advance(999)
  assert.equal(cache.has('k'), true)
  clock.advance(2)
  assert.equal(cache.has('k'), false)
  assert.equal(cache.get('k'), undefined)
})

await test('a per-set ttlMs overrides the cache default', () => {
  const clock = fakeClock()
  const cache = new MemoryCache({ now: clock, ttlMs: 100000 })
  cache.set('k', 'v', { ttlMs: 10 })
  clock.advance(11)
  assert.equal(cache.has('k'), false)
})

// ── LRU eviction ─────────────────────────────────────────────────────────
await test('the least-recently-used entry is evicted once maxSize is exceeded', () => {
  const cache = new MemoryCache({ now: fakeClock(), maxSize: 2 })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('c', 3) // evicts 'a' (oldest, never re-touched)
  assert.equal(cache.has('a'), false)
  assert.equal(cache.has('b'), true)
  assert.equal(cache.has('c'), true)
  assert.equal(cache.stats.evictions, 1)
})

await test('reading an entry protects it from LRU eviction (moves it to MRU)', () => {
  const cache = new MemoryCache({ now: fakeClock(), maxSize: 2 })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.get('a') // 'a' is now more-recently-used than 'b'
  cache.set('c', 3) // evicts 'b', not 'a'
  assert.equal(cache.has('a'), true)
  assert.equal(cache.has('b'), false)
  assert.equal(cache.has('c'), true)
})

await test('cache size never exceeds maxSize across many writes', () => {
  const cache = new MemoryCache({ now: fakeClock(), maxSize: 5 })
  for (let i = 0; i < 50; i++) cache.set(`k${i}`, i)
  assert.equal(cache.size <= 5, true)
})

// ── manual + prefix invalidation ─────────────────────────────────────────
await test('delete removes exactly one entry', () => {
  const cache = new MemoryCache({ now: fakeClock() })
  cache.set('a', 1)
  cache.set('b', 2)
  assert.equal(cache.delete('a'), true)
  assert.equal(cache.has('a'), false)
  assert.equal(cache.has('b'), true)
})

await test('invalidatePrefix removes every matching key and nothing else', () => {
  const cache = new MemoryCache({ now: fakeClock() })
  cache.set('search:u1:x', 1)
  cache.set('search:u1:y', 2)
  cache.set('search:u2:x', 3)
  const removed = cache.invalidatePrefix('search:u1:')
  assert.equal(removed, 2)
  assert.equal(cache.has('search:u1:x'), false)
  assert.equal(cache.has('search:u1:y'), false)
  assert.equal(cache.has('search:u2:x'), true)
})

await test('clear empties the whole cache', () => {
  const cache = new MemoryCache({ now: fakeClock() })
  cache.set('a', 1)
  cache.set('b', 2)
  assert.equal(cache.clear(), 2)
  assert.equal(cache.size, 0)
})

// ── getOrSet: miss / hit / dedup ─────────────────────────────────────────
await test('getOrSet on a miss calls the fetcher exactly once and caches the result', async () => {
  const cache = new MemoryCache({ now: fakeClock() })
  let calls = 0
  const fetcher = async () => { calls++; return 'fresh' }
  const v1 = await cache.getOrSet('k', fetcher)
  const v2 = await cache.getOrSet('k', fetcher)
  assert.equal(v1, 'fresh')
  assert.equal(v2, 'fresh')
  assert.equal(calls, 1)
})

await test('concurrent getOrSet calls for the same key share one in-flight request', async () => {
  const cache = new MemoryCache({ now: fakeClock() })
  let calls = 0
  let resolveFetch
  const fetcher = () => {
    calls++
    return new Promise((resolve) => { resolveFetch = resolve })
  }
  const p1 = cache.getOrSet('k', fetcher)
  const p2 = cache.getOrSet('k', fetcher)
  const p3 = cache.getOrSet('k', fetcher)
  // getOrSet invokes the fetcher one microtask tick later (Promise.resolve().then(...)),
  // so resolveFetch isn't assigned yet on this synchronous line — flush that tick first.
  await new Promise((resolve) => setTimeout(resolve, 0))
  resolveFetch('shared-value')
  const results = await Promise.all([p1, p2, p3])
  assert.equal(calls, 1)
  assert.deepEqual(results, ['shared-value', 'shared-value', 'shared-value'])
  assert.equal(cache.stats.dedup >= 2, true)
})

await test('a rejected fetcher propagates and is never cached as a valid result', async () => {
  const cache = new MemoryCache({ now: fakeClock() })
  let calls = 0
  const fetcher = async () => { calls++; throw new Error('boom') }
  await assert.rejects(() => cache.getOrSet('k', fetcher), /boom/)
  assert.equal(cache.has('k'), false)
  // A retry must call the fetcher again — the failure was not cached.
  await assert.rejects(() => cache.getOrSet('k', fetcher), /boom/)
  assert.equal(calls, 2)
})

await test('an expired entry triggers exactly one fresh fetch, not a stale return', async () => {
  const clock = fakeClock()
  const cache = new MemoryCache({ now: clock, ttlMs: 10 })
  await cache.getOrSet('k', async () => 'v1')
  clock.advance(11)
  const v2 = await cache.getOrSet('k', async () => 'v2')
  assert.equal(v2, 'v2')
})

// ── stale-while-revalidate ───────────────────────────────────────────────
await test('a stale-but-live entry is returned immediately and refreshed in the background', async () => {
  const clock = fakeClock()
  const cache = new MemoryCache({ now: clock, ttlMs: 1000 })
  await cache.getOrSet('k', async () => 'v1', { staleAfterMs: 100 })
  clock.advance(101) // past staleAt, still under expiresAt

  let backgroundCalls = 0
  let freshValue = null
  const value = await cache.getOrSet('k', async () => { backgroundCalls++; return 'v2' }, {
    staleAfterMs: 100,
    onFresh: (v) => { freshValue = v },
  })
  assert.equal(value, 'v1') // stale value served instantly, no await on the refresh
  // Let the background refresh's microtasks flush.
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(backgroundCalls, 1)
  assert.equal(freshValue, 'v2')
  assert.equal(cache.get('k'), 'v2')
})

await test('a failed background refresh keeps serving the still-valid stale value', async () => {
  const clock = fakeClock()
  const cache = new MemoryCache({ now: clock, ttlMs: 1000 })
  await cache.getOrSet('k', async () => 'v1', { staleAfterMs: 100 })
  clock.advance(101)

  let backgroundError = null
  await cache.getOrSet('k', async () => { throw new Error('refresh failed') }, {
    staleAfterMs: 100,
    onBackgroundError: (err) => { backgroundError = err },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(backgroundError)
  assert.equal(cache.get('k'), 'v1') // the original value survives
})

await test('only one background refresh runs even if getOrSet is called repeatedly while stale', async () => {
  const clock = fakeClock()
  const cache = new MemoryCache({ now: clock, ttlMs: 1000 })
  await cache.getOrSet('k', async () => 'v1', { staleAfterMs: 100 })
  clock.advance(101)

  let backgroundCalls = 0
  const fetcher = async () => { backgroundCalls++; return 'v2' }
  await cache.getOrSet('k', fetcher, { staleAfterMs: 100 })
  await cache.getOrSet('k', fetcher, { staleAfterMs: 100 })
  await cache.getOrSet('k', fetcher, { staleAfterMs: 100 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(backgroundCalls, 1)
})

// ── in-flight invalidation guard ─────────────────────────────────────────
await test('a getOrSet in flight when the key is deleted does not repopulate the cache', async () => {
  const cache = new MemoryCache({ now: fakeClock(), ttlMs: 1000 })
  let release
  const gate = new Promise((r) => { release = r })
  const fetcher = async () => { await gate; return 'stale' }

  const inflight = cache.getOrSet('k', fetcher)
  cache.delete('k') // invalidation lands while the fetch is still pending
  release()
  const value = await inflight
  assert.equal(value, 'stale') // the awaiting caller still receives the value…
  assert.equal(cache.get('k'), undefined) // …but it was NOT written back to the cache
})

await test('a getOrSet in flight when the scope is cleared does not repopulate the cache', async () => {
  const cache = new MemoryCache({ now: fakeClock(), ttlMs: 1000 })
  let release
  const gate = new Promise((r) => { release = r })
  const inflight = cache.getOrSet('k', async () => { await gate; return 'stale' })
  cache.clear()
  release()
  await inflight
  assert.equal(cache.get('k'), undefined)
})

await test('a normal getOrSet with no intervening invalidation still caches', async () => {
  const cache = new MemoryCache({ now: fakeClock(), ttlMs: 1000 })
  await cache.getOrSet('k', async () => 'v1')
  assert.equal(cache.get('k'), 'v1') // guard must not suppress the normal write
})

// ── createMemoryCache factory ────────────────────────────────────────────
await test('createMemoryCache returns a working MemoryCache instance', () => {
  const cache = createMemoryCache({ now: fakeClock() })
  assert.ok(cache instanceof MemoryCache)
  cache.set('a', 1)
  assert.equal(cache.get('a'), 1)
})

console.log(`✓ memoryCache.test.js — ${passed} tests passed`)
