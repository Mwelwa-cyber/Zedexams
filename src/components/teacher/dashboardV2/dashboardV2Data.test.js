/* Plain-node tests for dashboardV2Data (npm run test:dashboard-v2-data). */
import assert from 'node:assert/strict'
import {
  relTime,
  shortDate,
  firstNameOf,
  initialsOf,
  toolLabel,
  documentsFromResources,
  lastOpenedFromResources,
  savedCountsFromSummary,
  checklistFromWeekPrep,
  feedFromState,
  activityFromResources,
  activitySeriesFromResources,
  termChipLabel,
} from './dashboardV2Data.js'

const DAY = 24 * 60 * 60 * 1000
// Fixed reference clock (a Wednesday) so nothing depends on the wall clock.
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0)

// ── time formatting ──────────────────────────────────────────────────
assert.equal(relTime(NOW - 2 * 60 * 60 * 1000, NOW), 'today')
assert.equal(relTime(NOW - 5 * DAY, NOW), '5d ago')
assert.equal(relTime(NOW - 20 * DAY, NOW), shortDate(NOW - 20 * DAY))
assert.equal(relTime(0, NOW), '')
// shortDate formats in local time — assert shape, not a fixed day, so the
// test passes in any CI timezone.
assert.match(shortDate(NOW), /^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/)

// ── names ────────────────────────────────────────────────────────────
assert.equal(firstNameOf('Mahenga Mwelwa'), 'Mahenga')
assert.equal(firstNameOf('Mr. Mwelwa'), 'Mr. Mwelwa')
assert.equal(firstNameOf(''), 'Teacher')
assert.equal(initialsOf('Mahenga Mwelwa'), 'MM')
assert.equal(initialsOf('Mr. Mwelwa'), 'M')
assert.equal(initialsOf(''), 'T')

// ── documents / last opened ──────────────────────────────────────────
const resources = [
  {
    id: 'a1', tool: 'assessment', subject: 'integrated_science', grade: 'Grade 4',
    title: 'End of Term 2 Test', createdAt: NOW - 5 * DAY, modifiedAt: 0,
    to: '/teacher/assessment-papers/a1/edit', status: 'ready', questionCount: 20,
  },
  {
    id: 'g1', tool: 'lesson_plan', subject: 'english', grade: 'Grade 6',
    title: 'Reading Comprehension', createdAt: NOW - 6 * DAY, modifiedAt: 0,
    to: '/teacher/library/g1', status: 'ready', questionCount: 0,
  },
  {
    id: 'a2', tool: 'assessment', subject: 'mathematics', grade: 'Grade 4',
    title: 'Empty draft paper', createdAt: NOW - 8 * DAY, modifiedAt: 0,
    to: '/teacher/assessment-papers/a2/edit', status: 'draft', questionCount: 0,
  },
]

const docs = documentsFromResources(resources, { limit: 2, now: NOW })
assert.equal(docs.length, 2)
assert.equal(docs[0].title, 'End of Term 2 Test')
assert.equal(docs[0].meta, 'Test Paper • Grade 4 • integrated science')
assert.equal(docs[0].date, '5d ago')
assert.equal(docs[0].status, 'Ready')
assert.equal(docs[0].to, '/teacher/assessment-papers/a1/edit')

const last = lastOpenedFromResources(resources, NOW)
assert.equal(last.subject, 'integrated science')
assert.equal(last.grade, 'Grade 4')
assert.equal(last.ago, '5d ago')
assert.equal(last.agoDays, 5)
assert.equal(lastOpenedFromResources([], NOW), null)
// Touched two hours ago → 0 whole days ("today" in the hero subline)
assert.equal(
  lastOpenedFromResources([{ ...resources[0], createdAt: NOW - 2 * 60 * 60 * 1000 }], NOW).agoDays,
  0,
)

// ── saved counts ─────────────────────────────────────────────────────
assert.deepEqual(
  savedCountsFromSummary({ scheme_of_work: 2, lesson_plan: 11, worksheet: 3 }),
  { scheme_of_work: 2, weekly_forecast: 0, lesson_plan: 11, record_of_work: 0 },
)

// ── checklist from buildWeekPrep rows ────────────────────────────────
const weekPrep = {
  rows: [
    { key: 'focus', label: 'Weekly Focus: 2 of 5 days prepared', done: 2, target: 5, to: '/x' },
    { key: 'lessons', label: 'Lesson plans: 1 of 6 completed', done: 1, target: 6, to: '/y' },
    { key: 'broken', label: 'No target row', done: 0, target: 0 },
  ],
}
const checklist = checklistFromWeekPrep(weekPrep)
assert.equal(checklist.length, 2)
assert.deepEqual(checklist[0], { id: 'focus', label: 'Weekly Focus: 2 of 5 days prepared', done: 2, total: 5, to: '/x' })
assert.deepEqual(checklistFromWeekPrep({ empty: true, rows: [] }), [])
assert.deepEqual(checklistFromWeekPrep(null), [])

// done can never exceed total in the view model
const overdone = checklistFromWeekPrep({ rows: [{ key: 'k', label: 'l', done: 9, target: 5 }] })
assert.equal(overdone[0].done, 5)

// ── feed ─────────────────────────────────────────────────────────────
const feed = feedFromState({ resources, gensError: true, now: NOW })
assert.equal(feed.length, 3)
assert.equal(feed[0].kind, 'success')
assert.ok(feed[0].body.includes('End of Term 2 Test'))
assert.equal(feed[1].kind, 'warning')
assert.ok(feed[1].title.includes('draft'))
assert.equal(feed[2].kind, 'error')
assert.equal(feed[2].retry, true)
assert.deepEqual(feedFromState({ resources: [], gensError: false, now: NOW }), [])

// ── activity rows + weekly series ────────────────────────────────────
const activity = activityFromResources(resources, { limit: 3, now: NOW })
assert.equal(activity[0].title, 'Test Paper created')
assert.equal(activity[1].title, 'Lesson Plan created')
assert.equal(toolLabel('nonexistent_tool'), 'Document')

const series = activitySeriesFromResources(resources, { now: NOW, weeks: 3 })
assert.equal(series.length, 3)
// createdAt 5d/6d ago land in the newest week bucket; 8d ago in the previous.
assert.equal(series[2].created, 2)
assert.equal(series[1].created, 1)
assert.equal(series[0].created, 0)

// ── term chip ────────────────────────────────────────────────────────
assert.equal(termChipLabel({ termNumber: 2, weekNumber: 10 }, NOW), `${shortDate(NOW)} — Term 2 • Week 10`)
assert.equal(termChipLabel({ termNumber: 2 }, NOW), `${shortDate(NOW)} — Term 2`)
assert.equal(termChipLabel(null, NOW), '')
assert.equal(termChipLabel({}, NOW), '')

console.log('dashboardV2Data: all assertions passed')
