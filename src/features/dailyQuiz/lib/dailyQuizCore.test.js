/**
 * src/features/dailyQuiz/lib/dailyQuizCore.test.js → test:daily-quiz-view
 *
 * The card-state tests are the load-bearing ones. The bug this whole feature
 * replaces was a Home card that said "No quiz today" with nothing to tap, so
 * the assertion that matters most is a negative one: no input produces that
 * state.
 */
import assert from 'node:assert/strict'
import {
  DAILY_CARD_STATE,
  buildDailyCard,
  buildPips,
  buildResultSummary,
  canPlay,
  buildWeekSummary,
  rankEntries,
} from './dailyQuizCore.js'

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

console.log('daily-quiz view core')

const READY = {
  ranked: true,
  alreadyPlayed: false,
  questions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
}

// ── the card ─────────────────────────────────────────────────────────

test('a ready day offers Play', () => {
  const card = buildDailyCard(READY)
  assert.equal(card.state, DAILY_CARD_STATE.READY)
  assert.equal(card.cta, 'Play')
  assert.match(card.sub, /5 questions/)
})

test('a played day shows the score and points to the ranks', () => {
  const card = buildDailyCard({
    ...READY,
    alreadyPlayed: true,
    result: { credited: 4, total: 5, points: 40, ranked: true },
  })
  assert.equal(card.state, DAILY_CARD_STATE.DONE)
  assert.equal(card.cta, 'Ranks')
  assert.match(card.sub, /4 out of 5/)
  assert.match(card.sub, /\+40 points/)
})

test('a played PRACTICE set never claims points', () => {
  const card = buildDailyCard({
    ...READY,
    ranked: false,
    alreadyPlayed: true,
    result: { credited: 3, total: 5, points: 0, ranked: false },
  })
  assert.equal(card.state, DAILY_CARD_STATE.DONE)
  assert.equal(card.cta, 'Review')
  assert.match(card.sub, /practice/)
  assert.ok(!/points/.test(card.sub))
})

test('a thin bank becomes a labelled practice offer, not an empty card', () => {
  const card = buildDailyCard({ ...READY, ranked: false })
  assert.equal(card.state, DAILY_CARD_STATE.PRACTICE)
  assert.equal(card.cta, 'Play')
  assert.match(card.sub, /don’t count/)
})

test('a failed read is honest and still offers somewhere to go', () => {
  const card = buildDailyCard(null, { error: new Error('offline') })
  assert.equal(card.state, DAILY_CARD_STATE.UNAVAILABLE)
  assert.ok(card.cta, 'an unavailable card must still be tappable')
})

test('NO input produces a dead-end "No quiz today" card', () => {
  // The regression this feature exists to prevent. Every state either
  // offers a quiz, a review, or a retry — never a card with nothing behind it.
  const inputs = [
    [null, {}],
    [null, { error: new Error('x') }],
    [undefined, { loading: true }],
    [{ ...READY, ranked: false }, {}],
    [{ ...READY, questions: [] }, {}],
    [{ ...READY, alreadyPlayed: true, result: { credited: 0, total: 5, points: 0, ranked: true } }, {}],
  ]
  for (const [payload, opts] of inputs) {
    const card = buildDailyCard(payload, opts)
    assert.ok(!/no quiz today/i.test(card.sub), `dead end for ${JSON.stringify(opts)}`)
    assert.ok(card.title, 'every card has a title')
  }
})

// ── pips ─────────────────────────────────────────────────────────────

test('an unanswered question is idle, not wrong', () => {
  // Collapsing "not reached" into "wrong" would show five red pips before
  // the learner had answered anything.
  const pips = buildPips(5, [], 0)
  assert.deepEqual(pips, ['on', 'idle', 'idle', 'idle', 'idle'])
})

test('answered questions colour by outcome', () => {
  assert.deepEqual(buildPips(5, [1, 0], 2), ['good', 'bad', 'on', 'idle', 'idle'])
})

// ── the result screen ────────────────────────────────────────────────

test('the summary reads the server numbers rather than recomputing them', () => {
  const s = buildResultSummary({ credited: 5, total: 5, points: 60, allCorrect: true, ranked: true })
  assert.equal(s.headline, '5 out of 5')
  assert.equal(s.points, 60)
  assert.equal(s.bonus, true)
})

test('a practice result says it does not count instead of showing zero points', () => {
  const s = buildResultSummary({ credited: 3, total: 5, points: 0, ranked: false })
  assert.match(s.pointsLine, /doesn’t count/)
  assert.equal(s.bonus, false)
})

test('no result yields null rather than a zeroed summary', () => {
  assert.equal(buildResultSummary(null), null)
})

// ── play gate ────────────────────────────────────────────────────────

test('an already-played day cannot be replayed for points', () => {
  assert.equal(canPlay({ ...READY, alreadyPlayed: true }), false)
  assert.equal(canPlay({ ...READY, questions: [] }), false)
  assert.equal(canPlay(READY), true)
  assert.equal(canPlay(null), false)
})

// ── the week ─────────────────────────────────────────────────────────

test('the week shows days played, never a resettable streak', () => {
  const w = buildWeekSummary({ daysPlayed: 4, points: 180 })
  assert.equal(w.label, '4/7')
  assert.equal(w.points, 180)
})

test('days played is clamped to the week and never negative', () => {
  assert.equal(buildWeekSummary({ daysPlayed: 99 }).daysPlayed, 7)
  assert.equal(buildWeekSummary(null).daysPlayed, 0)
})

// ── the board ────────────────────────────────────────────────────────

test('the board ranks by points, then by time as the quiet tie-break', () => {
  const { rows } = rankEntries([
    { uid: 'a', points: 300, totalElapsedMs: 90000 },
    { uid: 'b', points: 300, totalElapsedMs: 60000 },
    { uid: 'c', points: 410, totalElapsedMs: 120000 },
  ], 'b')
  assert.deepEqual(rows.map((r) => r.uid), ['c', 'b', 'a'])
  assert.deepEqual(rows.map((r) => r.position), [1, 2, 3])
})

test('a learner with no recorded time sorts last among equals, not first', () => {
  // Absence of evidence is not speed.
  const { rows } = rankEntries([
    { uid: 'noTime', points: 100 },
    { uid: 'fast', points: 100, totalElapsedMs: 30000 },
  ], null)
  assert.deepEqual(rows.map((r) => r.uid), ['fast', 'noTime'])
})

test('the viewer is found and flagged', () => {
  const { viewer } = rankEntries([{ uid: 'x', points: 10 }, { uid: 'me', points: 5 }], 'me')
  assert.equal(viewer.uid, 'me')
  assert.equal(viewer.position, 2)
  assert.equal(viewer.isViewer, true)
})

test('an empty board is empty rather than throwing', () => {
  const { rows, viewer } = rankEntries([], 'me')
  assert.deepEqual(rows, [])
  assert.equal(viewer, null)
})

if (failures) {
  console.error(`daily-quiz view core — ${failures} failed`)
  process.exit(1)
}
console.log('daily-quiz view core — all passed')
