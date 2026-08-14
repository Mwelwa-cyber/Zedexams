/**
 * adminHomeCore — the admin dashboard's review-queue and results rules.
 *
 * Plain-node assertions (`npm run test:admin-home`). These rules were inline in
 * `AdminDashboard.jsx` and untested until the Wave 4 slice-4 migration lifted
 * them; the suite pins the behaviour AS FOUND so the move is provably a move.
 */
import assert from 'node:assert/strict'
import {
  LOW_SCORE_THRESHOLD,
  buildAttentionItems,
  countLowScores,
  formatResultDate,
  scoreBand,
} from './adminHomeCore.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('adminHomeCore')

// ── scoreBand ──────────────────────────────────────────────────────────────
test('scoreBand splits at 70 and 50, inclusive at the boundary', () => {
  assert.equal(scoreBand(100), 'green')
  assert.equal(scoreBand(70), 'green')
  assert.equal(scoreBand(69.9), 'amber')
  assert.equal(scoreBand(50), 'amber')
  assert.equal(scoreBand(49.9), 'red')
  assert.equal(scoreBand(0), 'red')
})

// ── countLowScores ─────────────────────────────────────────────────────────
test('countLowScores counts strictly below the threshold', () => {
  const results = [{ percentage: 39 }, { percentage: 40 }, { percentage: 0 }, { percentage: 41 }]
  assert.equal(countLowScores(results), 2)
  assert.equal(LOW_SCORE_THRESHOLD, 40)
})

test('a result with no numeric percentage is unknown, not low', () => {
  // The distinction the component made and the reason it used typeof: a
  // document missing the field must not page an admin about a score it does
  // not have. `null` and `undefined` are NOT zero here.
  assert.equal(countLowScores([{ percentage: null }, { percentage: undefined }, {}]), 0)
  assert.equal(countLowScores([{ percentage: '12' }]), 0)
  assert.equal(countLowScores([null, undefined]), 0)
})

test('countLowScores tolerates a non-array', () => {
  assert.equal(countLowScores(undefined), 0)
  assert.equal(countLowScores(null), 0)
  assert.equal(countLowScores({ length: 3 }), 0)
})

// ── buildAttentionItems ────────────────────────────────────────────────────
test('an all-zero platform produces an empty queue', () => {
  assert.deepEqual(buildAttentionItems({}), [])
  assert.deepEqual(
    buildAttentionItems({ gensFlagged: 0, gensFailed: 0, pending: 0, pendingPayments: 0, lowScores: 0 }),
    [],
  )
})

test('high-priority generation failures sort ahead of the medium three', () => {
  const items = buildAttentionItems({
    gensFlagged: 2, gensFailed: 1, pending: 3, pendingPayments: 4, lowScores: 5,
  })
  assert.equal(items.length, 5)
  assert.deepEqual(items.map(i => i.level), ['high', 'high', 'medium', 'medium', 'medium'])
  assert.deepEqual(items.map(i => i.to), [
    '/admin/generations', '/admin/generations', '/admin/approvals', '/admin/payments', '/admin/results',
  ])
})

test('each item is singular at one and plural above it', () => {
  const [one] = buildAttentionItems({ gensFlagged: 1 })
  assert.equal(one.title, '1 AI generation flagged')
  const [many] = buildAttentionItems({ gensFlagged: 2 })
  assert.equal(many.title, '2 AI generations flagged')

  assert.equal(buildAttentionItems({ pending: 1 })[0].title, '1 content item awaiting approval')
  assert.equal(buildAttentionItems({ pending: 2 })[0].title, '2 content items awaiting approval')
  assert.equal(buildAttentionItems({ pendingPayments: 1 })[0].title, '1 payment pending')
  assert.equal(buildAttentionItems({ pendingPayments: 2 })[0].title, '2 payments pending')
  assert.equal(buildAttentionItems({ gensFailed: 1 })[0].title, '1 AI generation failed')
  assert.equal(buildAttentionItems({ lowScores: 1 })[0].title, '1 recent score below 40%')
  assert.equal(buildAttentionItems({ lowScores: 3 })[0].title, '3 recent scores below 40%')
})

test('every item carries the fields the card renders', () => {
  for (const item of buildAttentionItems({ gensFlagged: 1, gensFailed: 1, pending: 1, pendingPayments: 1, lowScores: 1 })) {
    for (const field of ['to', 'icon', 'title', 'detail', 'level', 'action']) {
      assert.ok(item[field], `${item.title} is missing ${field}`)
    }
  }
})

test('a queue built twice from the same stats is identical', () => {
  const stats = { gensFlagged: 2, pending: 1 }
  assert.deepEqual(buildAttentionItems(stats), buildAttentionItems(stats))
})

// ── formatResultDate ───────────────────────────────────────────────────────
test('formatResultDate reads a Firestore timestamp through toDate()', () => {
  const stamp = { toDate: () => new Date('2026-03-09T10:00:00Z') }
  assert.equal(formatResultDate(stamp), '09 Mar 2026')
})

test('formatResultDate reads a Date and a date string', () => {
  assert.equal(formatResultDate(new Date('2026-12-25T00:00:00Z')), '25 Dec 2026')
  assert.equal(formatResultDate('2026-01-02T00:00:00Z'), '02 Jan 2026')
})

test('anything unreadable becomes the em-dash rather than throwing', () => {
  // The dashboard must stay mounted: a row whose date is unknown is still a
  // row worth showing, and a throw here would take the whole table with it.
  assert.equal(formatResultDate(null), '—')
  assert.equal(formatResultDate(undefined), '—')
  assert.equal(formatResultDate(''), '—')
  assert.equal(formatResultDate('not a date'), '—')
  assert.equal(formatResultDate({ toDate: () => { throw new Error('offline') } }), '—')
  assert.equal(formatResultDate({ toDate: () => 'not a date' }), '—')
})

console.log(`\n${passed} assertions passed\n`)
