/**
 * Tests for storageStatsCore — byte formatting, the storage breakdown, and the
 * relative-time helper.
 * Run: node src/offline/storageStatsCore.test.js
 */

import { formatBytes, summarizeStorage, formatRelativeTime } from './storageStatsCore.js'
import { newEntry } from './contentCacheCore.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

const NOW = 1_700_000_000_000

console.log('formatBytes')
{
  assert(formatBytes(0) === '0 B', 'zero bytes')
  assert(formatBytes(512) === '512 B', 'sub-KB stays in bytes')
  assert(formatBytes(1024) === '1 KB', 'exactly 1 KB')
  assert(formatBytes(1536) === '1.5 KB', 'one decimal for fractional')
  assert(formatBytes(5 * 1024 * 1024) === '5 MB', 'MB')
  assert(formatBytes(3 * 1024 * 1024 * 1024) === '3 GB', 'GB')
}

console.log('\nsummarizeStorage — three buckets + totals')
{
  const entries = [
    { ...newEntry({ type: 'quiz', id: 'a', size: 100, now: NOW }), lastAccessed: NOW - 1000 },
    { ...newEntry({ type: 'note', id: 'b', size: 200, pinned: true, now: NOW }), lastAccessed: NOW - 500 },
    { ...newEntry({ type: 'image', id: 'c', size: 50, tmp: true, now: NOW }), lastAccessed: NOW - 100 },
  ]
  const s = summarizeStorage(entries, { lastSyncAt: NOW - 60000 })
  assert(s.count === 3, 'counts all entries')
  assert(s.cacheBytes === 100, 'auto-cache bucket')
  assert(s.downloadedBytes === 200, 'pinned → downloaded bucket')
  assert(s.tmpBytes === 50, 'temp bucket')
  assert(s.totalBytes === 350, 'total is the sum')
  assert(s.downloadedCount === 1 && s.tmpCount === 1, 'per-bucket counts')
  assert(s.byType.quiz === 100 && s.byType.note === 200, 'per-type breakdown')
  assert(s.lastActivityAt === NOW - 100, 'newest access time')
  assert(s.lastSyncAt === NOW - 60000, 'last sync passed through')
}

console.log('\nsummarizeStorage — empty')
{
  const s = summarizeStorage([])
  assert(s.count === 0 && s.totalBytes === 0 && s.lastActivityAt === null, 'empty is well-formed')
}

console.log('\nformatRelativeTime')
{
  assert(formatRelativeTime(null) === 'Never', 'null → Never')
  assert(formatRelativeTime(NOW - 30000, NOW) === 'Just now', 'under a minute')
  assert(formatRelativeTime(NOW - 5 * 60000, NOW) === '5 mins ago', 'minutes')
  assert(formatRelativeTime(NOW - 60000, NOW) === '1 min ago', 'singular minute')
  assert(formatRelativeTime(NOW - 3 * 3600000, NOW) === '3 hours ago', 'hours')
  assert(formatRelativeTime(NOW - 2 * 86400000, NOW) === '2 days ago', 'days')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll storageStatsCore tests passed.')
