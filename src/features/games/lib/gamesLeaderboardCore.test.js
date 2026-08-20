/**
 * test:games-leaderboard — the weekly board's view logic, under plain node.
 *
 * Weighted towards the cases the old board got wrong or could not express:
 * ties, a learner outside the visible list, fewer than three players, a
 * failed read reported as an empty board, and a name that should never have
 * been printed.
 */
import assert from 'node:assert/strict'
import * as core from './gamesLeaderboardCore.js'

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('games leaderboard core (view)')

const entry = (uid, points, extra = {}) => ({
  uid, points, displayName: `${uid.toUpperCase()} B.`, plays: 3, lastPlayedAt: null, ...extra,
})

/* ── ranking ─────────────────────────────────────────────────────────── */

test('rows come back highest first with sequential ranks', () => {
  const { rows } = core.rankEntries([entry('c', 118), entry('a', 198), entry('b', 172)])
  assert.deepEqual(rows.map((r) => r.uid), ['a', 'b', 'c'])
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3])
})

test('a tie is COMPETITION ranking — 1, 2, 2, 4', () => {
  const { rows } = core.rankEntries([
    entry('a', 200), entry('b', 140), entry('c', 140), entry('d', 90),
  ])
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 2, 4])
})

test('a three-way tie at the top gives three rank-1 rows and the next is 4th', () => {
  const { rows } = core.rankEntries([
    entry('a', 100), entry('b', 100), entry('c', 100), entry('d', 50),
  ])
  assert.deepEqual(rows.map((r) => r.rank), [1, 1, 1, 4])
})

test('tied learners are ORDERED deterministically, never by input order', () => {
  // Same points; b played fewer rounds to get there, so b is listed first —
  // and it is the same answer whichever order Firestore hands them back in.
  const a = entry('a', 140, { plays: 9 })
  const b = entry('b', 140, { plays: 2 })
  const one = core.rankEntries([a, b]).rows.map((r) => r.uid)
  const two = core.rankEntries([b, a]).rows.map((r) => r.uid)
  assert.deepEqual(one, ['b', 'a'])
  assert.deepEqual(one, two)
})

test('with points and plays equal, the earlier arrival goes first', () => {
  const a = entry('a', 100, { plays: 2, lastPlayedAt: { seconds: 2000 } })
  const b = entry('b', 100, { plays: 2, lastPlayedAt: { seconds: 1000 } })
  assert.deepEqual(core.rankEntries([a, b]).rows.map((r) => r.uid), ['b', 'a'])
})

test('a missing timestamp sorts LAST among equals, never first', () => {
  // A missing value must not be an advantage, or it becomes worth having.
  const a = entry('a', 100, { plays: 2, lastPlayedAt: null })
  const b = entry('b', 100, { plays: 2, lastPlayedAt: { seconds: 9_000_000 } })
  assert.deepEqual(core.rankEntries([a, b]).rows.map((r) => r.uid), ['b', 'a'])
})

test('a Firestore Timestamp-like value is read through toMillis', () => {
  const a = entry('a', 100, { plays: 1, lastPlayedAt: { toMillis: () => 5000 } })
  const b = entry('b', 100, { plays: 1, lastPlayedAt: { toMillis: () => 1000 } })
  assert.deepEqual(core.rankEntries([a, b]).rows.map((r) => r.uid), ['b', 'a'])
})

test('the viewer is found and flagged, and nobody else is', () => {
  const { rows, viewer } = core.rankEntries([entry('a', 10), entry('me', 5)], 'me')
  assert.equal(viewer.uid, 'me')
  assert.equal(viewer.rank, 2)
  assert.equal(rows.filter((r) => r.isViewer).length, 1)
})

test('with no viewer uid nobody is flagged — a signed-out reader is not a learner', () => {
  const { viewer, rows } = core.rankEntries([entry('a', 10)], null)
  assert.equal(viewer, null)
  assert.equal(rows.every((r) => !r.isViewer), true)
})

test('a row with no uid is dropped rather than rendered', () => {
  const { rows } = core.rankEntries([entry('a', 10), { points: 99 }, null])
  assert.deepEqual(rows.map((r) => r.uid), ['a'])
})

test('zero points is a real row, not an absent one', () => {
  const { rows } = core.rankEntries([entry('a', 10), entry('b', 0)])
  assert.equal(rows.length, 2)
  assert.equal(rows[1].points, 0)
  assert.equal(rows[1].rank, 2)
})

test('an empty board ranks to nothing rather than throwing', () => {
  assert.deepEqual(core.rankEntries([]).rows, [])
  assert.deepEqual(core.rankEntries(null).rows, [])
  assert.deepEqual(core.rankEntries(undefined).viewer, null)
})

/* ── podium ──────────────────────────────────────────────────────────── */

test('the podium takes the top three and everyone else follows', () => {
  const { rows } = core.rankEntries(
    ['a', 'b', 'c', 'd', 'e'].map((u, i) => entry(u, 100 - i * 10)),
  )
  const { podium, rest } = core.splitBoard(rows)
  assert.deepEqual(podium.map((r) => r.uid), ['a', 'b', 'c'])
  assert.deepEqual(rest.map((r) => r.uid), ['d', 'e'])
  assert.deepEqual(rest.map((r) => r.rank), [4, 5])
})

test('a five-way tie does not put five blocks on the podium', () => {
  // Everyone is rank 1; the podium is still three blocks and the other two
  // head "Everyone else" still reading 1, which is true.
  const { rows } = core.rankEntries(['a', 'b', 'c', 'd', 'e'].map((u) => entry(u, 100)))
  const { podium, rest } = core.splitBoard(rows)
  assert.equal(podium.length, 3)
  assert.equal(rest.length, 2)
  assert.equal(rest[0].rank, 1)
})

test('one and two players make a shorter podium, not a broken one', () => {
  const one = core.splitBoard(core.rankEntries([entry('a', 10)]).rows)
  assert.equal(one.podium.length, 1)
  assert.deepEqual(one.rest, [])

  const two = core.splitBoard(core.rankEntries([entry('a', 10), entry('b', 5)]).rows)
  assert.equal(two.podium.length, 2)
})

test('three blocks are drawn 2nd · 1st · 3rd', () => {
  const { rows } = core.rankEntries([entry('a', 30), entry('b', 20), entry('c', 10)])
  const { podium } = core.splitBoard(rows)
  assert.deepEqual(core.podiumLayout(podium).map((r) => r.uid), ['b', 'a', 'c'])
})

test('two blocks are drawn 1st · 2nd — silver never stands alone beside a gap', () => {
  const { rows } = core.rankEntries([entry('a', 30), entry('b', 20)])
  const { podium } = core.splitBoard(rows)
  assert.deepEqual(core.podiumLayout(podium).map((r) => r.uid), ['a', 'b'])
})

test('podiumLayout survives an empty podium', () => {
  assert.deepEqual(core.podiumLayout([]), [])
  assert.deepEqual(core.podiumLayout(undefined), [])
})

test('medals stop at three, and each carries an accessible label', () => {
  assert.equal(core.medalFor(1).emoji, '🥇')
  assert.equal(core.medalFor(2).label, 'Second place')
  assert.equal(core.medalFor(3).tone, 'bronze')
  assert.equal(core.medalFor(4), null)
  assert.equal(core.medalFor(undefined), null)
})

/* ── names, avatars, privacy ─────────────────────────────────────────── */

test('the viewer reads as "You", never as their own name', () => {
  assert.equal(core.labelFor({ isViewer: true, displayName: 'Chanda M.' }), 'You')
  assert.equal(core.labelFor({ isViewer: true }, { emphatic: true }), 'You — that’s you!')
})

test('anyone else reads as the safe name the server wrote', () => {
  assert.equal(core.labelFor({ displayName: 'Chanda M.' }), 'Chanda M.')
})

test('an email address is refused even if a legacy row carries one', () => {
  // The client cannot FIX a bad name — the server owns the format — but it
  // can refuse to print one.
  assert.equal(core.stripUnsafeName('elisha.c@zedexams.com'), 'Learner')
  assert.equal(core.stripUnsafeName('Elisha C at zedexams.com'), 'Learner')
  assert.equal(core.labelFor({ displayName: 'someone@example.com' }), 'Learner')
})

test('a missing name never renders blank', () => {
  assert.equal(core.stripUnsafeName(''), 'Learner')
  assert.equal(core.stripUnsafeName(null), 'Learner')
  assert.equal(core.labelFor({}), 'Learner')
})

test('a very long name is bounded so one row cannot break the layout', () => {
  assert.ok(core.stripUnsafeName('Chandamukulu'.repeat(10)).length <= 24)
})

test('the avatar letter comes from the name and the colour from the uid', () => {
  assert.equal(core.avatarFor({ uid: 'x', displayName: 'Luyando S.' }).letter, 'L')
  // Two learners with no publishable name are still visually distinct.
  const a = core.avatarFor({ uid: 'uid-one', displayName: 'Learner' })
  const b = core.avatarFor({ uid: 'uid-two', displayName: 'Learner' })
  assert.notEqual(a.tone, b.tone)
  // And the colour is stable across renders.
  assert.equal(core.avatarFor({ uid: 'uid-one', displayName: 'Learner' }).tone, a.tone)
  assert.ok(core.AVATAR_TONES.includes(a.tone))
})

test('a nameless row still gets an avatar rather than an empty circle', () => {
  assert.equal(core.avatarFor({ uid: 'x', displayName: '' }).letter, '?')
})

/* ── the week ────────────────────────────────────────────────────────── */

test('the reset countdown is derived, never hard-coded', () => {
  // 2026-08-20 is a Thursday: Fri, Sat, Sun, then Monday — 4 days.
  const thu = core.buildResetPill(new Date('2026-08-20T09:00:00Z'))
  assert.equal(thu.days, 4)
  assert.equal(thu.detail, '4 days')
  assert.equal(thu.label, 'Resets Monday')
})

test('Sunday says "1 day", singular', () => {
  const sun = core.buildResetPill(new Date('2026-08-23T09:00:00Z'))
  assert.equal(sun.days, 1)
  assert.equal(sun.detail, '1 day')
})

test('Monday says a whole week, never zero — the board just reset', () => {
  const mon = core.buildResetPill(new Date('2026-08-24T09:00:00Z'))
  assert.equal(mon.days, 7)
})

test('the countdown is on the LUSAKA clock, not the device UTC one', () => {
  // 23:30 UTC on Sunday is 01:30 Monday in Lusaka: the board has already
  // reset, so the next one is a full week away.
  assert.equal(core.buildResetPill(new Date('2026-08-23T23:30:00Z')).days, 7)
  assert.equal(core.buildResetPill(new Date('2026-08-23T21:30:00Z')).days, 1)
})

test('the week id rolls over at Lusaka midnight, matching where points were written', () => {
  const sunday = core.weekIdFor(new Date('2026-08-23T21:30:00Z')) // 23:30 Sun Lusaka
  const monday = core.weekIdFor(new Date('2026-08-23T23:30:00Z')) // 01:30 Mon Lusaka
  assert.notEqual(sunday, monday)
  assert.equal(core.previousWeekId(monday === sunday ? sunday : new Date('2026-08-24T09:00:00Z')), sunday)
})

test('previousWeekId crosses a year boundary the way ISO does', () => {
  assert.equal(core.previousWeekId('2027-01-01'), '2026-W52')
})

/* ── last week's winner ──────────────────────────────────────────────── */

test('last week resolves to the top learner, safely named', () => {
  const win = core.resolveLastWeekWinner([entry('b', 150), entry('a', 300, { displayName: 'Chanda M.' })])
  assert.equal(win.uid, 'a')
  assert.equal(win.name, 'Chanda M.')
  assert.equal(win.points, 300)
})

test('no previous week means NO crown — never a placeholder or invented name', () => {
  assert.equal(core.resolveLastWeekWinner([]), null)
  assert.equal(core.resolveLastWeekWinner(null), null)
  // A week where entries exist but nobody scored is also no winner.
  assert.equal(core.resolveLastWeekWinner([entry('a', 0), entry('b', 0)]), null)
})

test('a tied previous week is broken the same way the live board broke it', () => {
  const a = entry('a', 200, { plays: 8 })
  const b = entry('b', 200, { plays: 2 })
  assert.equal(core.resolveLastWeekWinner([a, b]).uid, 'b')
  assert.equal(core.resolveLastWeekWinner([b, a]).uid, 'b')
})

/* ── header stats and the pinned card ────────────────────────────────── */

test('the header shows the learner\'s real rank, points and streak', () => {
  const stats = core.buildHeaderStats({
    viewerEntry: { uid: 'me', points: 96 }, viewerRank: 10, streak: 3,
  })
  assert.deepEqual(stats.map((s) => s.value), ['#10', '96', '3'])
})

test('a learner with no entry has NO rank — not zero, not last', () => {
  const stats = core.buildHeaderStats({ viewerEntry: null, viewerRank: null, streak: 0 })
  assert.equal(stats[0].value, '—')
  assert.equal(stats[1].value, '0')   // points genuinely are zero
  assert.equal(stats[2].value, '0')
})

test('a failed rank count shows an em dash rather than a guess', () => {
  const stats = core.buildHeaderStats({ viewerEntry: { uid: 'me', points: 40 }, viewerRank: null, streak: 1 })
  assert.equal(stats[0].value, '—')
  assert.equal(stats[1].value, '40')
})

test('the pinned card exists whenever the learner is on the board', () => {
  const card = core.buildPinnedCard({ viewerEntry: { uid: 'me', points: 24 }, viewerRank: 47 })
  assert.equal(card.rankLabel, '#47')
  assert.equal(card.pointsLabel, '24 pts')
})

test('a learner who has not played this week gets no pinned card', () => {
  assert.equal(core.buildPinnedCard({ viewerEntry: null, viewerRank: null }), null)
})

test('points format identically wherever they are shown', () => {
  assert.equal(core.formatPoints(96), '96 pts')
  assert.equal(core.formatPoints(0), '0 pts')
  assert.equal(core.formatPoints(-5), '0 pts')
  assert.equal(core.formatPoints(1234), '1,234 pts')
  assert.equal(core.formatPoints(null), '0 pts')
})

/* ── page state ──────────────────────────────────────────────────────── */

test('a failed read is an ERROR, never an empty board', () => {
  // The old service called back with `{rows: [], error}`, so a subscription
  // failure and "nobody has played" were the same value.
  assert.equal(
    core.resolveBoardState({ loading: false, signedIn: true, error: new Error('x'), rowCount: 0 }),
    core.BOARD_STATE.ERROR,
  )
})

test('the states cover every combination and none renders nothing', () => {
  const s = core.BOARD_STATE
  assert.equal(core.resolveBoardState({ loading: true, signedIn: false, error: null, rowCount: 0 }), s.SIGNED_OUT)
  assert.equal(core.resolveBoardState({ loading: true, signedIn: true, error: null, rowCount: 0 }), s.LOADING)
  assert.equal(core.resolveBoardState({ loading: false, signedIn: true, error: null, rowCount: 0 }), s.EMPTY)
  assert.equal(core.resolveBoardState({ loading: false, signedIn: true, error: null, rowCount: 3 }), s.READY)
  // Loading with rows already in hand is READY, not a flash back to skeletons.
  assert.equal(core.resolveBoardState({ loading: false, signedIn: true, error: null, rowCount: 1 }), s.READY)
})

/* ── copy + accessibility ────────────────────────────────────────────── */

test('the footer names the learner\'s actual grade', () => {
  assert.match(core.buildFooterNote(7)[0], /Grade 7/)
  assert.match(core.buildFooterNote(5)[0], /Grade 5/)
  assert.match(core.buildFooterNote(null)[0], /your grade/)
  assert.match(core.buildFooterNote(7)[1], /every Monday/)
})

test('a screen reader hears rank, name and points in that order', () => {
  assert.equal(
    core.describeRow({ rank: 4, displayName: 'Luyando S.', points: 161 }),
    'Rank 4, Luyando S., 161 points.',
  )
})

test('the podium does not rely on colour — a medal is announced by name', () => {
  assert.match(core.describeRow({ rank: 1, displayName: 'Chanda M.', points: 198 }), /^First place, /)
  assert.match(core.describeRow({ rank: 3, displayName: 'Mutale K.', points: 172 }), /^Third place, /)
})

test('the viewer\'s own row announces as "You"', () => {
  assert.equal(core.describeRow({ rank: 10, isViewer: true, points: 96 }), 'Rank 10, You, 96 points.')
})

if (failures) {
  console.error(`games leaderboard core (view) — ${failures} failed`)
  process.exit(1)
}
console.log('games leaderboard core (view) — all passed')
