#!/usr/bin/env node
/**
 * scripts/test-progress-core.mjs
 *
 * My Progress + Study Plan. The claim that matters most: nothing is shown
 * that is not measured. The app records no time at all, so there is no
 * "minutes learned" here to test — the chart counts finished activities,
 * and these pin that it counts them correctly and says nothing when there
 * is nothing to say.
 */

import assert from 'node:assert/strict'
import {
  examReadiness, weeklyActivity, buildStudyPlan, focusReason, daysUntil, toMillis,
} from '../src/features/learnerProgress/lib/progressCore.js'

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`) }

// A fixed Wednesday, 14:00 local, so bucketing is deterministic.
const NOW = new Date(2026, 7, 12, 14, 0, 0).getTime()
const day = (offset, h = 10) => new Date(2026, 7, 12 - offset, h, 0, 0).getTime()

test('readiness is the mean of the subject rows shown beneath it', () => {
  assert.equal(examReadiness([{ percent: 60 }, { percent: 40 }]), 50)
  assert.equal(examReadiness([{ percent: 62 }, { percent: 48 }, { percent: 35 }, { percent: 54 }]), 50)
})

test('readiness is null — not 0% — when there is nothing to average', () => {
  // A confident "0%" to a learner who has simply not started yet is a
  // judgement the data does not support.
  assert.equal(examReadiness([]), null)
  assert.equal(examReadiness(null), null)
  assert.equal(examReadiness([{ percent: 'x' }, {}]), null)
})

test('readiness clamps nonsense rather than propagating it', () => {
  assert.equal(examReadiness([{ percent: 300 }, { percent: -50 }]), 50)
})

test('the week is seven days, oldest first, today last', () => {
  const week = weeklyActivity([], NOW)
  assert.equal(week.length, 7)
  assert.equal(week[6].isToday, true)
  assert.equal(week.filter((d) => d.isToday).length, 1)
  assert.ok(week[0].at < week[6].at)
})

test('events land on their own local day, including late-evening ones', () => {
  // 21:00 in Lusaka must be today's bar, not tomorrow's.
  const week = weeklyActivity([
    { completedAt: day(0, 21) },
    { completedAt: day(0, 6) },
    { completedAt: day(3) },
  ], NOW)
  assert.equal(week[6].count, 2)
  assert.equal(week[3].count, 1)
  assert.equal(week[0].count, 0)
})

test('anything older than the window is ignored, not clamped onto day one', () => {
  const week = weeklyActivity([{ completedAt: day(30) }], NOW)
  assert.deepEqual(week.map((d) => d.count), [0, 0, 0, 0, 0, 0, 0])
})

test('bars are relative to the busiest day, and an empty day stays empty', () => {
  const week = weeklyActivity([
    { completedAt: day(0) }, { completedAt: day(0) }, { completedAt: day(0) }, { completedAt: day(0) },
    { completedAt: day(2) },
  ], NOW)
  assert.equal(week[6].percent, 100)
  assert.equal(week[4].percent, 25)
  // A day with nothing is not given a token sliver it did not earn.
  assert.equal(week[1].percent, 0)
})

test('every timestamp shape the app stores is read', () => {
  const ms = day(1)
  for (const v of [ms, { seconds: Math.floor(ms / 1000) }, { toMillis: () => ms }, new Date(ms).toISOString()]) {
    assert.equal(weeklyActivity([{ completedAt: v }], NOW)[5].count, 1, `unread shape: ${JSON.stringify(v)}`)
  }
  // Undated rows never count — they cannot be placed on a day.
  assert.equal(weeklyActivity([{}, { completedAt: null }], NOW)[6].count, 0)
  assert.equal(toMillis('not a date'), null)
})

test('the study plan is worst-first and capped', () => {
  const plan = buildStudyPlan([
    { topic: 'Spelling', subject: 'english', percent: 55, correct: 6, total: 8 },
    { topic: 'Fractions', subject: 'mathematics', percent: 20, correct: 2, total: 10 },
    { topic: 'Punctuation', subject: 'english', percent: 40, correct: 4, total: 10 },
  ], { limit: 2 })
  assert.deepEqual(plan.map((p) => p.topic), ['Fractions', 'Punctuation'])
})

test('the plan drops rows with no topic rather than rendering a blank card', () => {
  const plan = buildStudyPlan([{ percent: 10 }, null, { topic: '' }, { topic: 'Spelling', percent: 50 }])
  assert.deepEqual(plan.map((p) => p.topic), ['Spelling'])
  assert.deepEqual(buildStudyPlan(null), [])
})

test('the reason says what was counted, never a judgement', () => {
  assert.equal(
    focusReason({ subjectLabel: 'English', missed: 3 }),
    'English · missed 3 recently',
  )
  // No numbers behind it → no claim. "Needs work" would be an opinion
  // dressed as data.
  assert.equal(focusReason({ subjectLabel: 'English', missed: null }), 'English')
  assert.equal(focusReason({ subjectLabel: 'English', missed: 0 }), 'English')
  assert.equal(focusReason(null), '')
})

test('daysUntil counts whole days and never goes negative', () => {
  assert.equal(daysUntil(day(-12), NOW), 12)
  assert.equal(daysUntil(day(0, 23), NOW), 0)
  assert.equal(daysUntil(day(5), NOW), 0, 'a past date is 0, not -5')
  assert.equal(daysUntil(null, NOW), null)
})

console.log(`\nprogress-core: ${passed} tests passed`)
