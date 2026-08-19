// src/features/dailyExams/lib/learnerLeaderboardCore.test.js
//
// Plain-node tests (npm run test:learner-leaderboard). Everything the
// weekly board decides is pure, so all of it is checkable without a
// browser, Firebase or a rendered component.

import assert from 'node:assert/strict'
import {
  dateKey, startOfWeek, endOfWeek, weekId, weekWindow, previousWeekWindow,
  boardName, avatarLetter,
  aggregateWeek, rankBoard, withMyRow, splitBoard, buildBoard, championOf,
  PODIUM_SIZE,
} from './learnerLeaderboardCore.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}`)
    throw err
  }
}

// ── date keys + week boundaries ──────────────────────────────────────────────

// 2026-08-17 is a Monday; 2026-08-23 the Sunday that closes that week.
const MON = new Date(2026, 7, 17, 9, 0, 0)
const WED = new Date(2026, 7, 19, 15, 30, 0)
const SUN = new Date(2026, 7, 23, 23, 0, 0)

test('dateKey uses local time, not UTC', () => {
  // 23:00 local in a positive-offset zone is already "tomorrow" in UTC.
  // The key must still name the local day or the board rolls over early.
  assert.equal(dateKey(new Date(2026, 7, 19, 23, 30, 0)), '2026-08-19')
  assert.equal(dateKey(new Date(2026, 0, 1, 0, 0, 0)), '2026-01-01')
})

test('startOfWeek returns the Monday for every day of the week', () => {
  for (const d of [MON, WED, SUN]) {
    assert.equal(dateKey(startOfWeek(d)), '2026-08-17')
  }
})

test('Sunday belongs to the week that started six days earlier', () => {
  // The off-by-one that puts Sunday in the NEXT week is the classic bug
  // here: it would reset a learner's board a day early, every week.
  assert.equal(dateKey(startOfWeek(SUN)), '2026-08-17')
  assert.notEqual(dateKey(startOfWeek(SUN)), '2026-08-24')
})

test('startOfWeek is local midnight', () => {
  const s = startOfWeek(WED)
  assert.equal(s.getHours(), 0)
  assert.equal(s.getMinutes(), 0)
  assert.equal(s.getSeconds(), 0)
})

test('endOfWeek is the following Monday', () => {
  assert.equal(dateKey(endOfWeek(WED)), '2026-08-24')
})

test('weekId names the week by its Monday', () => {
  assert.equal(weekId(WED), '2026-08-17')
  assert.equal(weekId(SUN), weekId(MON))
})

test('week window spans Monday to Sunday inclusive', () => {
  const w = weekWindow(WED)
  assert.equal(w.startKey, '2026-08-17')
  assert.equal(w.endKey, '2026-08-23')
  assert.equal(w.weekId, '2026-08-17')
})

test('daysToReset counts down and is never zero', () => {
  // Monday morning: a whole fresh week ahead.
  assert.equal(weekWindow(MON).daysToReset, 7)
  // Wednesday afternoon: Thu, Fri, Sat, Sun remain → rounds UP to 5.
  assert.equal(weekWindow(WED).daysToReset, 5)
  // An hour before the reset still reads "1 day", never "0 days".
  assert.equal(weekWindow(new Date(2026, 7, 23, 23, 30)).daysToReset, 1)
})

test('previousWeekWindow steps back exactly one week', () => {
  const prev = previousWeekWindow(WED)
  assert.equal(prev.startKey, '2026-08-10')
  assert.equal(prev.endKey, '2026-08-16')
})

test('week maths crosses a month and a year boundary', () => {
  // Fri 2027-01-01 sits in the week that began Mon 2026-12-28.
  assert.equal(weekId(new Date(2027, 0, 1, 12, 0)), '2026-12-28')
  const w = weekWindow(new Date(2027, 0, 1, 12, 0))
  assert.equal(w.startKey, '2026-12-28')
  assert.equal(w.endKey, '2027-01-03')
})

// ── names (child-privacy rule) ───────────────────────────────────────────────

test('boardName reduces a surname to an initial', () => {
  assert.equal(boardName('Chanda Mwale'), 'Chanda M.')
  assert.equal(boardName('Taonga Banda'), 'Taonga B.')
})

test('boardName never leaks a full surname, however many names there are', () => {
  const out = boardName('Mapalo Chanda Mwale Phiri')
  assert.equal(out, 'Mapalo P.')
  assert.ok(!out.includes('Mwale'))
  assert.ok(!out.includes('Chanda'))
  assert.ok(!out.includes('Phiri'))
})

test('boardName copes with messy and missing input', () => {
  assert.equal(boardName('  Chanda   Mwale  '), 'Chanda M.')
  assert.equal(boardName('Chanda'), 'Chanda')
  assert.equal(boardName(''), 'Learner')
  assert.equal(boardName(null), 'Learner')
  assert.equal(boardName(undefined), 'Learner')
})

test('avatarLetter is a single upper-case character', () => {
  assert.equal(avatarLetter('chanda mwale'), 'C')
  assert.equal(avatarLetter(''), 'L')
})

// ── aggregation ──────────────────────────────────────────────────────────────

const WEEK = [
  { userId: 'u1', displayName: 'Chanda Mwale', score: 8, percentage: 80, attemptDate: '2026-08-17' },
  { userId: 'u1', displayName: 'Chanda Mwale', score: 10, percentage: 100, attemptDate: '2026-08-18' },
  { userId: 'u2', displayName: 'Taonga Banda', score: 9, percentage: 90, attemptDate: '2026-08-17' },
  { userId: 'u3', displayName: 'Mutale Kunda', score: 5, percentage: 50, attemptDate: '2026-08-17' },
]

test('aggregateWeek sums marks per learner', () => {
  const rows = aggregateWeek(WEEK)
  const u1 = rows.find((r) => r.userId === 'u1')
  assert.equal(u1.points, 18)
  assert.equal(u1.attempts, 2)
  assert.equal(u1.activeDays, 2)
})

test('aggregateWeek counts distinct days, not attempts', () => {
  const rows = aggregateWeek([
    { userId: 'u1', score: 5, percentage: 50, attemptDate: '2026-08-17' },
    { userId: 'u1', score: 5, percentage: 50, attemptDate: '2026-08-17' },
  ])
  assert.equal(rows[0].attempts, 2)
  assert.equal(rows[0].activeDays, 1)
})

test('aggregateWeek drops unattributable attempts', () => {
  const rows = aggregateWeek([...WEEK, { score: 100, percentage: 100 }])
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.userId))
})

test('aggregateWeek tolerates missing and non-numeric scores', () => {
  const rows = aggregateWeek([
    { userId: 'u1', attemptDate: '2026-08-17' },
    { userId: 'u1', score: '7', percentage: '70', attemptDate: '2026-08-18' },
  ])
  assert.equal(rows[0].points, 7)
  assert.ok(Number.isFinite(rows[0].points))
})

test('aggregateWeek keeps the fullest display name seen', () => {
  const rows = aggregateWeek([
    { userId: 'u1', displayName: '', score: 1, attemptDate: '2026-08-17' },
    { userId: 'u1', displayName: 'Chanda Mwale', score: 1, attemptDate: '2026-08-18' },
  ])
  assert.equal(rows[0].displayName, 'Chanda Mwale')
})

test('aggregateWeek handles an empty week', () => {
  assert.deepEqual(aggregateWeek([]), [])
  assert.deepEqual(aggregateWeek(), [])
})

// ── ranking ──────────────────────────────────────────────────────────────────

test('rankBoard orders by points descending', () => {
  const ranked = rankBoard(aggregateWeek(WEEK))
  assert.deepEqual(ranked.map((r) => r.userId), ['u1', 'u2', 'u3'])
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3])
})

test('ties break on accuracy, then on fewer attempts', () => {
  const rows = [
    { userId: 'a', displayName: 'A A', points: 10, percentageTotal: 100, attempts: 2 },
    { userId: 'b', displayName: 'B B', points: 10, percentageTotal: 180, attempts: 2 },
    { userId: 'c', displayName: 'C C', points: 10, percentageTotal: 180, attempts: 1 },
  ]
  // b and c match on points AND accuracy; c did it in one sitting.
  assert.deepEqual(rankBoard(rows).map((r) => r.userId), ['c', 'b', 'a'])
})

test('elapsed time breaks a tie, and only after points, accuracy and attempts', () => {
  const rows = [
    { userId: 'slow', displayName: 'S S', points: 10, percentageTotal: 100, attempts: 1, timeTakenSeconds: 900 },
    { userId: 'fast', displayName: 'F F', points: 10, percentageTotal: 100, attempts: 1, timeTakenSeconds: 300 },
  ]
  assert.deepEqual(rankBoard(rows).map((r) => r.userId), ['fast', 'slow'])
})

test('a slower learner who scored better still wins — time is never a bonus', () => {
  // The whole point of removing the countdown: taking longer and answering
  // better must beat hurrying. Time is read fourth, after points, accuracy
  // and attempts, so it can only separate learners who are otherwise level.
  const rows = [
    { userId: 'careful', displayName: 'C C', points: 12, percentageTotal: 90, attempts: 1, timeTakenSeconds: 1800 },
    { userId: 'hurried', displayName: 'H H', points: 11, percentageTotal: 95, attempts: 1, timeTakenSeconds: 120 },
  ]
  assert.deepEqual(rankBoard(rows).map((r) => r.userId), ['careful', 'hurried'])

  // Level on points but not on accuracy — accuracy still decides, not speed.
  const level = [
    { userId: 'accurate', displayName: 'A A', points: 10, percentageTotal: 180, attempts: 1, timeTakenSeconds: 1800 },
    { userId: 'quick', displayName: 'Q Q', points: 10, percentageTotal: 100, attempts: 1, timeTakenSeconds: 60 },
  ]
  assert.deepEqual(rankBoard(level).map((r) => r.userId), ['accurate', 'quick'])
})

test('a missing duration counts as zero rather than pushing a learner down', () => {
  // An attempt graded before durations were recorded must not be penalised.
  const rows = [
    { userId: 'unknown', displayName: 'U U', points: 10, percentageTotal: 100, attempts: 1 },
    { userId: 'known', displayName: 'K K', points: 10, percentageTotal: 100, attempts: 1, timeTakenSeconds: 400 },
  ]
  assert.deepEqual(rankBoard(rows).map((r) => r.userId), ['unknown', 'known'])
})

test('aggregateWeek sums durations for the tie-break and nothing else', () => {
  const rows = aggregateWeek([
    { userId: 'u1', displayName: 'One', score: 5, percentage: 50, attemptDate: '2026-08-17', timeTakenSeconds: 200 },
    { userId: 'u1', displayName: 'One', score: 5, percentage: 50, attemptDate: '2026-08-18', timeTakenSeconds: 300 },
  ])
  assert.equal(rows[0].timeTakenSeconds, 500)
  // It is not folded into the points a learner is ranked on.
  assert.equal(rows[0].points, 10)
})

test('ranking is total — identical rows keep a stable order', () => {
  const rows = [
    { userId: 'z', displayName: 'Z Z', points: 5, percentageTotal: 50, attempts: 1 },
    { userId: 'a', displayName: 'A A', points: 5, percentageTotal: 50, attempts: 1 },
  ]
  const once = rankBoard(rows).map((r) => r.userId)
  const twice = rankBoard([...rows].reverse()).map((r) => r.userId)
  assert.deepEqual(once, twice, 'equal rows must not swap between renders')
})

test('rankBoard does not mutate its input', () => {
  const rows = aggregateWeek(WEEK)
  const before = rows.map((r) => r.userId)
  rankBoard(rows)
  assert.deepEqual(rows.map((r) => r.userId), before)
})

test('the viewer is labelled "You" and starred, never by name', () => {
  const ranked = rankBoard(aggregateWeek(WEEK), 'u2')
  const me = ranked.find((r) => r.me)
  assert.equal(me.userId, 'u2')
  assert.equal(me.name, 'You')
  assert.equal(me.letter, '⭐')
  assert.equal(ranked.filter((r) => r.me).length, 1)
})

test('other learners are shown with an initial only', () => {
  const ranked = rankBoard(aggregateWeek(WEEK), 'u2')
  const other = ranked.find((r) => r.userId === 'u1')
  assert.equal(other.name, 'Chanda M.')
  assert.ok(!ranked.some((r) => String(r.name).includes('Mwale')))
})

// ── the viewer always has a row ──────────────────────────────────────────────

test('withMyRow adds a zero row for a learner who has not played', () => {
  const rows = withMyRow(aggregateWeek(WEEK), { userId: 'u9', displayName: 'New Learner' })
  const mine = rows.find((r) => r.userId === 'u9')
  assert.ok(mine, 'the viewer must appear on their own board')
  assert.equal(mine.points, 0)
})

test('withMyRow does not duplicate a learner who has played', () => {
  const rows = withMyRow(aggregateWeek(WEEK), { userId: 'u1', displayName: 'Chanda Mwale' })
  assert.equal(rows.filter((r) => r.userId === 'u1').length, 1)
})

test('withMyRow is a no-op when signed out', () => {
  const base = aggregateWeek(WEEK)
  assert.equal(withMyRow(base, null).length, base.length)
})

// ── podium + pin ─────────────────────────────────────────────────────────────

test('podium comes back in display order: silver, gold, bronze', () => {
  const { podium } = buildBoard({ attempts: WEEK })
  assert.deepEqual(podium.map((p) => p.rank), [2, 1, 3], 'the winner stands in the middle')
})

test('the list below the podium starts at rank 4', () => {
  const many = []
  for (let i = 1; i <= 6; i++) {
    many.push({ userId: `u${i}`, displayName: `L${i} X`, score: 100 - i, percentage: 50, attemptDate: '2026-08-17' })
  }
  const { rest } = buildBoard({ attempts: many })
  assert.deepEqual(rest.map((r) => r.rank), [4, 5, 6])
})

test('a short board is not padded with placeholders', () => {
  const two = WEEK.filter((a) => a.userId !== 'u3')
  const { podium, rest } = buildBoard({ attempts: two })
  assert.equal(podium.length, 2)
  assert.ok(podium.every(Boolean), 'no holes in the podium')
  assert.equal(rest.length, 0)
})

test('a single-player board renders one podium column', () => {
  const { podium, rest } = buildBoard({ attempts: [WEEK[0]] })
  assert.equal(podium.length, 1)
  assert.equal(podium[0].rank, 1)
  assert.equal(rest.length, 0)
})

test('the pin shows only when the viewer is below the podium', () => {
  const many = []
  for (let i = 1; i <= 8; i++) {
    many.push({ userId: `u${i}`, displayName: `L${i} X`, score: 100 - i, percentage: 50, attemptDate: '2026-08-17' })
  }
  // Rank 6 → pinned.
  assert.equal(buildBoard({ attempts: many, me: { userId: 'u6' } }).showPin, true)
  // On the podium → not pinned; the learner can already see themselves.
  for (const uid of ['u1', 'u2', 'u3']) {
    assert.equal(buildBoard({ attempts: many, me: { userId: uid } }).showPin, false, `${uid} is on the podium`)
  }
  // Rank 4 is the first pinned rank.
  assert.equal(buildBoard({ attempts: many, me: { userId: 'u4' } }).showPin, true)
})

test('a signed-out viewer gets no pin', () => {
  assert.equal(buildBoard({ attempts: WEEK }).showPin, false)
})

test('the pinned row and the list row report the same rank and points', () => {
  const many = []
  for (let i = 1; i <= 9; i++) {
    many.push({ userId: `u${i}`, displayName: `L${i} X`, score: 100 - i, percentage: 50, attemptDate: '2026-08-17' })
  }
  const board = buildBoard({ attempts: many, me: { userId: 'u7' } })
  const inList = board.rest.find((r) => r.me)
  // The pin is a sticky repeat of the learner's own row — if the two ever
  // disagreed the screen would be telling a child two different ranks.
  assert.equal(board.me.rank, inList.rank)
  assert.equal(board.me.points, inList.points)
})

test('an empty board reports itself empty rather than crashing', () => {
  const board = buildBoard({ attempts: [] })
  assert.equal(board.isEmpty, true)
  assert.deepEqual(board.podium, [])
  assert.deepEqual(board.rest, [])
  assert.equal(board.me, null)
})

test('a learner alone on an unplayed week is NOT crowned champion', () => {
  // withMyRow guarantees the viewer a row, so before this rule a learner
  // opening the board on Monday morning was the only row on it — rank 1,
  // on a gold podium, with 0 points. An unplayed week has no champion.
  const board = buildBoard({ attempts: [], me: { userId: 'u9', displayName: 'New Learner' } })
  assert.equal(board.isEmpty, true)
  assert.deepEqual(board.podium, [])
  assert.equal(board.showPin, false)
})

test('a week in which everyone scored zero is empty, not a ranking', () => {
  const board = buildBoard({
    attempts: [
      { userId: 'u1', displayName: 'A B', score: 0, percentage: 0, attemptDate: '2026-08-17' },
      { userId: 'u2', displayName: 'C D', score: 0, percentage: 0, attemptDate: '2026-08-17' },
    ],
  })
  assert.equal(board.isEmpty, true)
})

test('one scoring learner is enough to make a board', () => {
  const board = buildBoard({
    attempts: [{ userId: 'u1', displayName: 'A B', score: 3, percentage: 30, attemptDate: '2026-08-17' }],
    me: { userId: 'u9', displayName: 'New Learner' },
  })
  assert.equal(board.isEmpty, false)
  // Two rows, so a two-column podium: the scorer takes gold and the
  // yet-to-play viewer is genuinely second of two. That is honest, and it
  // resolves the moment a classmate plays.
  assert.equal(board.podium.length, 2)
  assert.equal(board.me.rank, 2)
  assert.equal(board.showPin, false, 'rank 2 is on the podium, so it is not pinned as well')
})

test('a never-played viewer sits last on an otherwise live board', () => {
  const board = buildBoard({ attempts: WEEK, me: { userId: 'u9', displayName: 'New Learner' } })
  assert.equal(board.me.rank, 4)
  assert.equal(board.me.points, 0)
  assert.equal(board.showPin, true)
  assert.equal(board.isEmpty, false)
})

test('PODIUM_SIZE governs both the podium and the pin threshold', () => {
  assert.equal(PODIUM_SIZE, 3)
})

// ── last week's champion ─────────────────────────────────────────────────────

test('championOf names the top learner with an initial', () => {
  const champ = championOf(WEEK)
  assert.equal(champ.name, 'Chanda M.')
  assert.equal(champ.points, 18)
})

test('championOf returns null when nobody played', () => {
  assert.equal(championOf([]), null)
})

test('championOf returns null when every score is zero', () => {
  // A week where attempts exist but nothing was earned has no champion —
  // crowning a 0-point learner would be a hollow award.
  assert.equal(championOf([{ userId: 'u1', displayName: 'A B', score: 0, percentage: 0 }]), null)
})

console.log(`✓ learnerLeaderboardCore — ${passed} tests passed`)
