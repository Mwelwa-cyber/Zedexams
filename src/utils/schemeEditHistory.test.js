/**
 * Unit tests for schemeEditHistory — edit trail inside output.meta.
 * Run: node src/utils/schemeEditHistory.test.js
 */

import {
  stampEditHistory,
  lastEditedAt,
  editHistoryOf,
  editCountOf,
} from './schemeEditHistory.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

console.log('stampEditHistory — first edit')
{
  const out = { header: { grade: '5' }, weeks: [] }
  const stamped = stampEditHistory(out, 'edited in studio', { now: '2026-07-03T10:00:00.000Z' })
  assert(lastEditedAt(stamped) === '2026-07-03T10:00:00.000Z', 'records lastEditedAt')
  assert(editCountOf(stamped) === 1, 'editCount = 1')
  assert(editHistoryOf(stamped).length === 1, 'one history entry')
  assert(editHistoryOf(stamped)[0].summary === 'edited in studio', 'summary stored')
  assert(out.meta === undefined, 'input output not mutated')
  assert(stamped.header.grade === '5', 'preserves other output fields')
}

console.log('stampEditHistory — subsequent edits accumulate')
{
  let out = { weeks: [] }
  out = stampEditHistory(out, 'a', { now: '2026-01-01T00:00:00.000Z' })
  out = stampEditHistory(out, 'b', { now: '2026-01-02T00:00:00.000Z' })
  assert(editCountOf(out) === 2, 'editCount increments')
  assert(lastEditedAt(out) === '2026-01-02T00:00:00.000Z', 'lastEditedAt tracks latest')
  assert(editHistoryOf(out).map((e) => e.summary).join(',') === 'a,b', 'history is newest-last')
}

console.log('stampEditHistory — history is capped at 20')
{
  let out = { weeks: [] }
  for (let i = 0; i < 25; i++) {
    out = stampEditHistory(out, `edit ${i}`, { now: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z` })
  }
  assert(editHistoryOf(out).length === 20, 'capped at 20 entries')
  assert(editCountOf(out) === 25, 'editCount still counts all edits')
  assert(editHistoryOf(out)[19].summary === 'edit 24', 'keeps the most recent')
  assert(editHistoryOf(out)[0].summary === 'edit 5', 'drops the oldest')
}

console.log('accessors on un-edited output')
{
  assert(lastEditedAt({ weeks: [] }) === null, 'lastEditedAt null when never edited')
  assert(editHistoryOf(null).length === 0, 'editHistoryOf null → []')
  assert(editCountOf(undefined) === 0, 'editCountOf undefined → 0')
  assert(stampEditHistory(null, 'x') === null, 'stamping null is a no-op')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll schemeEditHistory tests passed')
