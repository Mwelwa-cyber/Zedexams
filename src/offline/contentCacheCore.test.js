/**
 * Tests for contentCacheCore — key/dedup, freshness, LRU+frequency eviction,
 * stale sweep, and the combined cleanup plan.
 * Run: node src/offline/contentCacheCore.test.js
 */

import {
  DEFAULT_CACHE_BUDGET,
  STALE_TTL,
  TMP_TTL,
  cacheKey,
  newEntry,
  touchEntry,
  needsRefresh,
  mergeEntries,
  selectStale,
  keepScore,
  selectEvictions,
  planCleanup,
} from './contentCacheCore.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

const NOW = 1_700_000_000_000

console.log('cacheKey — stable + dedup')
{
  assert(cacheKey('Quiz', 'abc') === 'quiz:abc', 'lowercases type, joins id')
  const k1 = cacheKey('quiz', 'abc')
  const k2 = cacheKey('Quiz', 'abc')
  assert(k1 === k2, 'same content (any casing) → same key (dedup)')
  assert(cacheKey('quiz', 'a') !== cacheKey('exam', 'a'), 'different types never collide')
}

console.log('\nnewEntry / touchEntry')
{
  const e = newEntry({ type: 'quiz', id: 'q1', version: 5, size: 100, now: NOW })
  assert(e.key === 'quiz:q1' && e.version === '5' && e.accessCount === 1, 'builds a normalized entry')
  const t = touchEntry(e, NOW + 1000)
  assert(t.lastAccessed === NOW + 1000 && t.accessCount === 2, 'touch bumps recency + frequency')
  assert(e.accessCount === 1, 'touch is pure (original untouched)')
}

console.log('\nneedsRefresh — version-based change detection')
{
  const e = newEntry({ type: 'quiz', id: 'q1', version: 5, now: NOW })
  assert(needsRefresh(null, 5) === true, 'uncached → needs fetch')
  assert(needsRefresh(e, 5) === false, 'same version → fresh')
  assert(needsRefresh(e, 6) === true, 'changed version → refresh')
  assert(needsRefresh(e, null) === false, 'no server signal → keep cached copy')
}

console.log('\nmergeEntries — dedup, preserve access stats')
{
  const hot = { ...newEntry({ type: 'quiz', id: 'q1', size: 10, now: NOW }), accessCount: 9, lastAccessed: NOW + 5000 }
  const redownload = newEntry({ type: 'quiz', id: 'q1', version: 2, size: 20, now: NOW })
  const merged = mergeEntries([hot], [redownload])
  assert(merged.length === 1, 'same key deduped to one entry')
  assert(merged[0].accessCount === 9, 'preserves higher access count on re-download')
  assert(merged[0].size === 20 && merged[0].version === '2', 'takes fresh size/version')
  assert(merged[0].createdAt === hot.createdAt, 'keeps original createdAt')
}

console.log('\nselectStale — idle non-pinned beyond TTL')
{
  const fresh = { ...newEntry({ type: 'quiz', id: 'a', now: NOW }), lastAccessed: NOW }
  const stale = { ...newEntry({ type: 'quiz', id: 'b', now: NOW }), lastAccessed: NOW - STALE_TTL - 1 }
  const pinnedOld = { ...newEntry({ type: 'quiz', id: 'c', pinned: true, now: NOW }), lastAccessed: NOW - STALE_TTL * 3 }
  const tmpOld = { ...newEntry({ type: 'quiz', id: 'd', tmp: true, now: NOW }), lastAccessed: NOW - TMP_TTL - 1 }
  const out = selectStale([fresh, stale, pinnedOld, tmpOld], NOW).map((e) => e.id)
  assert(out.includes('b'), 'stale non-pinned selected')
  assert(!out.includes('a'), 'fresh kept')
  assert(!out.includes('c'), 'pinned never swept even when very old')
  assert(out.includes('d'), 'temp file swept on the short TTL')
}

console.log('\nkeepScore + selectEvictions — LRU with frequency, pinned immune')
{
  const pinned = { ...newEntry({ type: 'quiz', id: 'p', size: 50, pinned: true, now: NOW }), lastAccessed: NOW - 999999 }
  assert(keepScore(pinned, NOW) === Infinity, 'pinned scores Infinity (never evicted)')

  const old = { ...newEntry({ type: 'quiz', id: 'old', size: 60, now: NOW }), lastAccessed: NOW - 100000, accessCount: 1 }
  const recent = { ...newEntry({ type: 'quiz', id: 'new', size: 60, now: NOW }), lastAccessed: NOW - 1000, accessCount: 1 }
  assert(keepScore(old, NOW) < keepScore(recent, NOW), 'older entry scores lower (evict-sooner)')

  // total 170 > budget 100 → must evict ≥70 bytes, and only from non-pinned.
  const evicted = selectEvictions([pinned, old, recent], 100, NOW).map((e) => e.id)
  assert(!evicted.includes('p'), 'pinned never evicted even over budget')
  assert(evicted.includes('old'), 'oldest evicted first')
  assert(selectEvictions([recent], DEFAULT_CACHE_BUDGET, NOW).length === 0, 'under budget → no eviction')
}

console.log('\nplanCleanup — stale + budget, deduped')
{
  const stale = { ...newEntry({ type: 'quiz', id: 's', size: 10, now: NOW }), lastAccessed: NOW - STALE_TTL - 1 }
  const big1 = { ...newEntry({ type: 'quiz', id: 'b1', size: 80, now: NOW }), lastAccessed: NOW - 5000 }
  const big2 = { ...newEntry({ type: 'quiz', id: 'b2', size: 80, now: NOW }), lastAccessed: NOW - 1000 }
  const plan = planCleanup([stale, big1, big2], { budget: 100, now: NOW })
  const removed = plan.remove.map((e) => e.id)
  assert(removed.includes('s'), 'stale removed')
  assert(plan.keep.length + plan.remove.length === 3, 'every entry accounted for once')
  const totalKeep = plan.keep.reduce((s, e) => s + e.size, 0)
  assert(totalKeep <= 100, 'survivors fit under budget')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll contentCacheCore tests passed.')
