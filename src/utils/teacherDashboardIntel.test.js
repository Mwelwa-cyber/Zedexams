/**
 * Plain-node assertions for the teacher dashboard intelligence helpers.
 * Run via `npm run test:dashboard-intel` (auto-discovered by run-all-tests).
 */
import assert from 'node:assert/strict'
import {
  greetingForHour,
  getTimeGreeting,
  buildAiMessage,
  buildInsights,
  rotateInsights,
  buildActivityStats,
  buildCelebrations,
  favouriteSubject,
} from './teacherDashboardIntel.js'

const NOW = Date.UTC(2026, 5, 28, 9, 0, 0) // fixed clock for determinism
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n) => NOW - n * DAY

function res(over = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'generation',
    tool: 'lesson_plan',
    subject: 'Mathematics',
    grade: 'Grade 4',
    topic: 'Fractions',
    createdAt: daysAgo(1),
    title: 'Fractions plan',
    to: '/teacher/library/x',
    status: 'ready',
    ...over,
  }
}

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

/* ── greeting ─────────────────────────────────────────────── */
check('greetingForHour buckets morning/afternoon/evening', () => {
  assert.equal(greetingForHour(7, 'Mwelwa').label, 'Good morning')
  assert.equal(greetingForHour(7, 'Mwelwa').emoji, '🌅')
  assert.equal(greetingForHour(7, 'Mwelwa').part, 'morning')
  assert.equal(greetingForHour(13, 'Mwelwa').label, 'Good afternoon')
  assert.equal(greetingForHour(13, 'Mwelwa').emoji, '☀️')
  assert.equal(greetingForHour(20, 'Mwelwa').label, 'Good evening')
  assert.equal(greetingForHour(20, 'Mwelwa').emoji, '🌙')
})

check('greeting interpolates the name and falls back', () => {
  assert.equal(greetingForHour(9, 'Mr. Mwelwa').text, 'Good morning, Mr. Mwelwa')
  assert.equal(greetingForHour(9, '').text, 'Good morning, there')
  assert.ok(getTimeGreeting(NOW, 'Z').text.includes('Z'))
})

/* ── AI message priority ──────────────────────────────────── */
check('AI message: out of generations wins', () => {
  const msg = buildAiMessage({ resources: [res()], usage: { daily: 30, today: 30 }, now: NOW })
  assert.match(msg, /reset at midnight/)
})

check('AI message: a single draft is surfaced by name', () => {
  const msg = buildAiMessage({
    resources: [res({ status: 'draft', title: 'Grade 4 Maths test' })],
    usage: { daily: 30, today: 0 },
    now: NOW,
  })
  assert.match(msg, /Grade 4 Maths test/)
  assert.match(msg, /waiting/)
})

check('AI message: multiple drafts counted', () => {
  const msg = buildAiMessage({
    resources: [res({ status: 'draft' }), res({ status: 'draft' }), res({ status: 'draft' })],
    now: NOW,
  })
  assert.match(msg, /3 unpublished test papers/)
})

check('AI message: stale subject', () => {
  const msg = buildAiMessage({
    resources: [
      res({ subject: 'Integrated Science', createdAt: daysAgo(6) }),
      res({ subject: 'Integrated Science', createdAt: daysAgo(8) }),
    ],
    now: NOW,
  })
  assert.match(msg, /Integrated Science hasn't been updated for \d+ days/)
})

check('AI message: remaining generations fallback', () => {
  const msg = buildAiMessage({ resources: [res()], usage: { daily: 30, today: 17 }, now: NOW })
  assert.match(msg, /13 AI generations remaining today/)
})

check('AI message: empty library welcome', () => {
  const msg = buildAiMessage({ resources: [], usage: null, now: NOW })
  assert.match(msg, /first lesson/)
})

/* ── insights ─────────────────────────────────────────────── */
check('insights surface lesson-plan count + scheme gap', () => {
  const list = buildInsights({
    resources: [
      res({ tool: 'lesson_plan', subject: 'Science', createdAt: daysAgo(2) }),
      res({ tool: 'lesson_plan', subject: 'Science', createdAt: daysAgo(3) }),
    ],
    now: NOW,
  })
  assert.ok(list.some((i) => /lesson plan/.test(i.text)))
  assert.ok(list.some((i) => /Science has no Scheme of Work/.test(i.text)))
})

check('rotateInsights returns at most `take` and stays in range', () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, icon: '📌', text: `t${i}` }))
  const picked = rotateInsights(many, NOW, 3)
  assert.equal(picked.length, 3)
  picked.forEach((p) => assert.ok(many.includes(p)))
  // short lists pass through untouched
  assert.equal(rotateInsights(many.slice(0, 2), NOW, 3).length, 2)
})

/* ── activity stats ───────────────────────────────────────── */
check('activity stats compute totals + an up trend', () => {
  const resources = [
    res({ tool: 'lesson_plan', createdAt: daysAgo(2) }),
    res({ tool: 'lesson_plan', createdAt: daysAgo(5) }),
    res({ tool: 'lesson_plan', createdAt: daysAgo(40) }), // previous window
    res({ tool: 'notes', createdAt: daysAgo(1) }),
    res({ kind: 'quiz', tool: 'assessment', createdAt: daysAgo(3) }),
  ]
  const stats = buildActivityStats({ resources, now: NOW })
  const plans = stats.find((s) => s.key === 'plans')
  assert.equal(plans.total, 3)
  assert.equal(plans.trend.dir, 'up') // 2 in last 30d vs 1 in prev 30d
  const lib = stats.find((s) => s.key === 'library')
  assert.equal(lib.total, 5)
  const week = stats.find((s) => s.key === 'week')
  assert.equal(week.total, 4) // four items within 30 days (default month range)
  // trend carries the human "vs last month" basis by default
  assert.equal(plans.trend.basis, 'vs last month')

  // week range compares last 7 days to the prior 7 and relabels
  const weekly = buildActivityStats({ resources, now: NOW, range: 'week' })
  const wk = weekly.find((s) => s.key === 'week')
  assert.equal(wk.label, 'New this week')
  assert.equal(wk.total, 4) // four items within 7 days
  assert.equal(weekly[0].trend.basis, 'vs last week')
})

/* ── celebrations ─────────────────────────────────────────── */
check('celebration fires exactly on first lesson plan', () => {
  const list = buildCelebrations({ resources: [res({ tool: 'lesson_plan' })] })
  assert.ok(list.some((c) => /First lesson plan/.test(c.text)))
})

check('no celebration off-milestone', () => {
  const resources = Array.from({ length: 7 }, () => res({ tool: 'notes' }))
  assert.equal(buildCelebrations({ resources }).length, 0)
})

check('library 500 milestone fires', () => {
  const resources = Array.from({ length: 500 }, () => res({ tool: 'notes' }))
  const list = buildCelebrations({ resources })
  assert.ok(list.some((c) => /500 resources/.test(c.text)))
})

/* ── favourite subject ────────────────────────────────────── */
check('favouriteSubject picks the most frequent', () => {
  const resources = [
    res({ subject: 'Mathematics' }),
    res({ subject: 'Mathematics' }),
    res({ subject: 'English' }),
  ]
  assert.equal(favouriteSubject(resources), 'Mathematics')
  assert.equal(favouriteSubject([]), null)
})

console.log(`\nteacherDashboardIntel: ${passed} checks passed`)
