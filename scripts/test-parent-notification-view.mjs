/**
 * The parent inbox's decisions — tiles, day buckets, age wording, tap targets.
 *
 * `node scripts/test-parent-notification-view.mjs` or
 * `npm run test:parent-notification-view`.
 *
 * The screen itself is covered by ParentNotificationsPage.spec.jsx under
 * Vitest. What is pinned here is everything that is a rule rather than a
 * rendering: a notification the product has not met yet still gets a tile, an
 * item we cannot date is not buried, and an `action.url` that leaves the
 * origin is not navigated to.
 */

import assert from 'node:assert/strict'
import {
  TILES, tileFor, toMillis, groupForInbox, ageLabel, inAppPath,
} from '../src/features/parentPortal/lib/parentNotificationView.js'

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
// A fixed clock in the middle of a day, so "today" has room on both sides.
const NOW = new Date('2026-08-17T14:00:00').getTime()

console.log('\nparent-notification-view')

/* ── tiles ──────────────────────────────────────────────────────── */

check('a live type gets its own tile, not its category default', () => {
  // Both are category `account`; only the type tells them apart, which is the
  // whole reason the override table exists.
  const ask = tileFor({ type: 'child_unlock_request', category: 'account' })
  const other = tileFor({ type: 'something_else', category: 'account' })
  assert.equal(ask.cls, TILES.ask.cls)
  assert.notEqual(ask.cls, other.cls)
})

check('a failed payment reads as an alert, a successful one as settled', () => {
  assert.equal(tileFor({ type: 'payment_failed', category: 'payments' }).cls, TILES.alert.cls)
  assert.equal(tileFor({ type: 'payment_success', category: 'payments' }).cls, TILES.money.cls)
})

check('an unknown type falls back to its category', () => {
  const tile = tileFor({ type: 'not_a_type_we_write', category: 'assessments' })
  assert.equal(tile.cls, TILES.dated.cls)
})

check('a notification with neither type nor category still renders a tile', () => {
  // The failure this forbids is a card with an empty 44px hole in it.
  for (const input of [{}, { type: 'x' }, { category: 'x' }, null, undefined]) {
    const tile = tileFor(input)
    assert.ok(tile.cls && tile.emoji, `no tile for ${JSON.stringify(input)}`)
  }
})

check('every category resolves', () => {
  const categories = [
    'learning', 'lessonPlans', 'assessments', 'payments', 'account', 'system', 'announcements',
  ]
  for (const category of categories) {
    const tile = tileFor({ category })
    assert.ok(tile.cls.startsWith('lhx-ni-'), `${category} → ${tile.cls}`)
  }
})

/* ── timestamps ─────────────────────────────────────────────────── */

check('toMillis reads every timestamp shape the feed can carry', () => {
  const ms = 1_700_000_000_000
  assert.equal(toMillis({ toMillis: () => ms }), ms)
  assert.equal(toMillis({ toDate: () => new Date(ms) }), ms)
  assert.equal(toMillis({ seconds: ms / 1000 }), ms)
  assert.equal(toMillis(new Date(ms)), ms)
  assert.equal(toMillis(ms), ms)
  assert.equal(toMillis(null), 0)
  assert.equal(toMillis({ toDate: () => new Date('nonsense') }), 0)
})

/* ── grouping ───────────────────────────────────────────────────── */

check('Today is the calendar day, not the last 24 hours', () => {
  // 02:00 this morning is 12 hours ago and belongs under Today; 23:00 last
  // night is 15 hours ago and belongs under Earlier. A rolling window gets
  // both of these wrong, in opposite directions.
  const thisMorning = new Date('2026-08-17T02:00:00').getTime()
  const lastNight = new Date('2026-08-16T23:00:00').getTime()
  const { today, earlier } = groupForInbox(
    [{ id: 'a', createdAt: thisMorning }, { id: 'b', createdAt: lastNight }],
    NOW,
  )
  assert.deepEqual(today.map((n) => n.id), ['a'])
  assert.deepEqual(earlier.map((n) => n.id), ['b'])
})

check('an undated notification surfaces rather than sinking', () => {
  const { today, earlier } = groupForInbox([{ id: 'a', createdAt: null }], NOW)
  assert.deepEqual(today.map((n) => n.id), ['a'])
  assert.equal(earlier.length, 0)
})

check('the feed order is preserved, not re-sorted', () => {
  const rows = [
    { id: 'a', createdAt: NOW - 1 * HOUR },
    { id: 'b', createdAt: NOW - 3 * HOUR },
    { id: 'c', createdAt: NOW - 2 * HOUR },
  ]
  assert.deepEqual(groupForInbox(rows, NOW).today.map((n) => n.id), ['a', 'b', 'c'])
})

check('an empty or missing feed groups to two empty buckets', () => {
  for (const input of [[], null, undefined]) {
    const { today, earlier } = groupForInbox(input, NOW)
    assert.deepEqual([today, earlier], [[], []])
  }
})

/* ── age wording ────────────────────────────────────────────────── */

check('the age ladder speaks the parent prototype, not the learner one', () => {
  assert.equal(ageLabel(NOW - 5_000, NOW), 'Just now')
  assert.equal(ageLabel(NOW - 20 * 60_000, NOW), '20m ago')
  assert.equal(ageLabel(NOW - 1 * HOUR, NOW), '1h ago')
  assert.equal(ageLabel(NOW - 3 * HOUR, NOW), '3h ago')
  assert.equal(ageLabel(new Date('2026-08-16T18:00:00').getTime(), NOW), 'Yesterday')
  assert.equal(ageLabel(new Date('2026-08-14T18:00:00').getTime(), NOW), '3 days ago')
})

check('an hours-ago label never crosses midnight', () => {
  // 15 hours before 14:00 is 23:00 the previous day. Reporting "15h ago"
  // under an "Earlier" head is the label disagreeing with the bucket above it.
  assert.equal(ageLabel(NOW - 15 * HOUR, NOW), 'Yesterday')
})

check('a week or older falls back to a date', () => {
  const old = new Date('2026-07-01T09:00:00').getTime()
  assert.equal(ageLabel(old, NOW), new Date(old).toLocaleDateString())
})

check('a missing timestamp is never rendered as a broken date', () => {
  assert.equal(ageLabel(null, NOW), 'Just now')
  assert.equal(ageLabel(undefined, NOW), 'Just now')
})

/* ── tap targets ────────────────────────────────────────────────── */

check('an in-app path is returned as written', () => {
  assert.equal(inAppPath({ action: { url: '/family/child/abc' } }), '/family/child/abc')
  assert.equal(inAppPath({ action: { url: '  /my-subscription  ' } }), '/my-subscription')
})

check('nothing that leaves the origin is navigable', () => {
  const hostile = [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'family/child/abc',
    '',
  ]
  for (const url of hostile) {
    assert.equal(inAppPath({ action: { url } }), null, `${url} was accepted`)
  }
})

check('a notification with no action has no tap target', () => {
  assert.equal(inAppPath({}), null)
  assert.equal(inAppPath({ action: null }), null)
  assert.equal(inAppPath({ action: { url: 42 } }), null)
  assert.equal(inAppPath(null), null)
})

console.log(`\nparent-notification-view: ${passed} checks passed\n`)
