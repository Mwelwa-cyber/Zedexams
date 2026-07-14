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
  formatTrend,
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
  // The reset is the server's UTC boundary rendered as a LOCAL clock time
  // (02:00 in Zambia) — never described as "midnight".
  assert.match(msg, /reset at \d{2}:\d{2}/)
  assert.doesNotMatch(msg, /midnight/i)
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

check('AI message: multiple drafts counted with updated copy', () => {
  const msg = buildAiMessage({
    resources: [res({ status: 'draft' }), res({ status: 'draft' }), res({ status: 'draft' })],
    now: NOW,
  })
  assert.match(msg, /3 test papers still in progress/)
})

check('AI message: ready assessments do not trigger the in-progress nag', () => {
  // Papers with questionCount > 0 are classified as status:'ready' by TeacherDashboard;
  // the intel layer must not count them as drafts.
  const msg = buildAiMessage({
    resources: [
      res({ status: 'ready', kind: 'assessment', tool: 'assessment' }),
      res({ status: 'ready', kind: 'assessment', tool: 'assessment' }),
    ],
    now: NOW,
  })
  assert.doesNotMatch(msg, /in progress/)
  assert.doesNotMatch(msg, /unpublished/)
})

check('AI message: empty assessment drafts still trigger the nag', () => {
  // Papers with no questions remain status:'draft'; one paper uses the title variant.
  const single = buildAiMessage({
    resources: [res({ status: 'draft', kind: 'assessment', tool: 'assessment', title: 'Grade 5 test' })],
    now: NOW,
  })
  assert.match(single, /waiting/)

  const multi = buildAiMessage({
    resources: [
      res({ status: 'draft', kind: 'assessment', tool: 'assessment' }),
      res({ status: 'draft', kind: 'assessment', tool: 'assessment' }),
    ],
    now: NOW,
  })
  assert.match(multi, /in progress/)
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
check('activity stats: headline is the period count, total is lifetime', () => {
  const resources = [
    res({ tool: 'lesson_plan', createdAt: daysAgo(2) }),
    res({ tool: 'lesson_plan', createdAt: daysAgo(5) }),
    res({ tool: 'lesson_plan', createdAt: daysAgo(40) }), // previous window
    res({ tool: 'notes', createdAt: daysAgo(1) }),
    res({ kind: 'quiz', tool: 'assessment', createdAt: daysAgo(3) }),
  ]
  const stats = buildActivityStats({ resources, now: NOW })
  const plans = stats.find((s) => s.key === 'plans')
  assert.equal(plans.total, 3) // lifetime lesson plans
  assert.equal(plans.period, 2) // created in the last 30 days
  assert.equal(plans.prev, 1) // created in the 30 days before that
  assert.equal(plans.trend.dir, 'up') // 2 this period vs 1 previous
  // basis now lives on the stat, not the trend object
  assert.equal(plans.basis, 'vs last month')

  const lib = stats.find((s) => s.key === 'library')
  assert.equal(lib.total, 5) // all-time library count is unchanged

  const week = stats.find((s) => s.key === 'week')
  assert.equal(week.total, 5) // lifetime everything
  assert.equal(week.period, 4) // four items within 30 days (default month range)

  // week range compares last 7 days to the prior 7 and relabels
  const weekly = buildActivityStats({ resources, now: NOW, range: 'week' })
  const wk = weekly.find((s) => s.key === 'week')
  assert.equal(wk.label, 'New this week')
  assert.equal(wk.period, 4) // four items within 7 days
  assert.equal(weekly[0].basis, 'vs last week')
})

check('trend: 0 → n is "New", not a fake 100%', () => {
  const resources = [res({ tool: 'lesson_plan', createdAt: daysAgo(2) })] // none in prior window
  const plans = buildActivityStats({ resources, now: NOW }).find((s) => s.key === 'plans')
  assert.equal(plans.trend.dir, 'new')
  assert.equal(plans.trend.mode, 'new')
  assert.equal(formatTrend(plans.trend, plans.basis), '↑ New vs last month')
})

check('trend: n → 0 reports how many fewer, not 100%', () => {
  const resources = [res({ tool: 'lesson_plan', createdAt: daysAgo(40) })] // only in prior window
  const plans = buildActivityStats({ resources, now: NOW }).find((s) => s.key === 'plans')
  assert.equal(plans.period, 0)
  assert.equal(plans.trend.dir, 'down')
  assert.equal(plans.trend.mode, 'gone')
  assert.equal(formatTrend(plans.trend, plans.basis), '↓ 1 fewer vs last month')
})

check('trend: small base shows the absolute change, not an inflated %', () => {
  // 1 in the prior window, 5 in the current window → "+4", never "+400%"
  const resources = [
    res({ tool: 'lesson_plan', createdAt: daysAgo(40) }),
    ...Array.from({ length: 5 }, () => res({ tool: 'lesson_plan', createdAt: daysAgo(3) })),
  ]
  const plans = buildActivityStats({ resources, now: NOW }).find((s) => s.key === 'plans')
  assert.equal(plans.trend.mode, 'abs')
  assert.equal(formatTrend(plans.trend, plans.basis), '↑ +4 vs last month')
})

check('trend: large base keeps a real percentage', () => {
  // 10 prior, 15 current → +50%
  const resources = [
    ...Array.from({ length: 10 }, () => res({ tool: 'lesson_plan', createdAt: daysAgo(40) })),
    ...Array.from({ length: 15 }, () => res({ tool: 'lesson_plan', createdAt: daysAgo(3) })),
  ]
  const plans = buildActivityStats({ resources, now: NOW }).find((s) => s.key === 'plans')
  assert.equal(plans.trend.mode, 'pct')
  assert.equal(plans.trend.pct, 50)
  assert.equal(formatTrend(plans.trend, plans.basis), '↑ 50% vs last month')
})

check('formatTrend: no activity in either window reads as no change', () => {
  assert.equal(formatTrend({ dir: 'flat', mode: 'none', delta: 0, pct: 0 }, 'vs last week'), '— No change')
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
