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
  launcherWarningsFromResources,
  savedCountsFromSummary,
  studioSavedCounts,
  checklistFromWeekPrep,
  recommendationCardsFrom,
  feedFromState,
  activityFromResources,
  teachingDaysLeft,
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

// ── grade labels are resolved on read ────────────────────────────────
// Regression: the dashboard printed whatever shape the writing studio stored,
// so Recent Documents listed "Test Paper • 4 • …" beside "Test Paper • G4 • …"
// for the same grade, and the hero's LAST OPENED card printed a bare "4".
// Every stored shape must render as its one official label.
const gradeShapes = [
  ['4', 'Grade 4'],           // Assessment Studio
  ['G4', 'Grade 4'],          // server generators / Teaching Profile
  ['Grade 4', 'Grade 4'],     // Lesson Plan Studio
  ['ECE_N', 'Nursery'],       // level picker — never the raw code
  ['G8', 'Form 1'],           // CBC secondary
]
for (const [stored, label] of gradeShapes) {
  const row = { ...resources[0], grade: stored }
  assert.equal(
    documentsFromResources([row], { limit: 1, now: NOW })[0].meta,
    `Test Paper • ${label} • integrated science`,
    `Recent Documents must render grade ${JSON.stringify(stored)} as ${label}`,
  )
  assert.equal(
    lastOpenedFromResources([row], NOW).grade,
    label,
    `LAST OPENED must render grade ${JSON.stringify(stored)} as ${label}`,
  )
}
// A missing grade stays empty (and is dropped from the meta line) rather than
// growing a placeholder label.
assert.equal(lastOpenedFromResources([{ ...resources[0], grade: '' }], NOW).grade, '')
assert.equal(
  documentsFromResources([{ ...resources[0], grade: '' }], { limit: 1, now: NOW })[0].meta,
  'Test Paper • integrated science',
)

// ── saved counts ─────────────────────────────────────────────────────
assert.deepEqual(
  savedCountsFromSummary({ scheme_of_work: 2, lesson_plan: 11, worksheet: 3 }),
  { scheme_of_work: 2, weekly_forecast: 0, lesson_plan: 11, record_of_work: 0 },
)

// studioSavedCounts: full byTool map (positive only) + assessment total
assert.deepEqual(
  studioSavedCounts({ scheme_of_work: 2, lesson_plan: 11, worksheet: 0 }, 5),
  { scheme_of_work: 2, lesson_plan: 11, assessment: 5 },
)
// zero assessment total is omitted so no "0 saved" badge ever shows
assert.deepEqual(studioSavedCounts({ notes: 1 }, 0), { notes: 1 })
assert.deepEqual(studioSavedCounts({}, 0), {})

// launcher warnings: draft papers flag the Assessment Paper Studio
assert.deepEqual(
  launcherWarningsFromResources([
    { tool: 'assessment', status: 'draft' },
    { tool: 'lesson_plan', status: 'ready' },
  ]),
  ['assessment-papers'],
)
assert.deepEqual(launcherWarningsFromResources([{ tool: 'assessment', status: 'ready' }]), [])
assert.deepEqual(launcherWarningsFromResources([]), [])

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

// papersError — assessment read failure surfaces as a retryable error card
const papersFeed = feedFromState({ resources: [], papersError: true, now: NOW })
assert.equal(papersFeed.length, 1)
assert.equal(papersFeed[0].kind, 'error')
assert.equal(papersFeed[0].id, 'feed-papers-error')
assert.equal(papersFeed[0].retry, true)
assert.ok(papersFeed[0].title.includes('assessment'))

// both errors → two error cards (gensError first, papersError second)
const bothFeed = feedFromState({ resources: [], gensError: true, papersError: true, now: NOW })
assert.equal(bothFeed.length, 2)
assert.equal(bothFeed[0].id, 'feed-error')
assert.equal(bothFeed[1].id, 'feed-papers-error')

// papersError with no gensError → no "library" error card
const papersOnlyFeed = feedFromState({ resources: [], gensError: false, papersError: true, now: NOW })
assert.ok(!papersOnlyFeed.some((i) => i.id === 'feed-error'))

// ── activity rows ────────────────────────────────────────────────────
const activity = activityFromResources(resources, { limit: 3, now: NOW })
assert.equal(activity[0].title, 'Test Paper created')
assert.equal(activity[1].title, 'Lesson Plan created')
assert.equal(toolLabel('nonexistent_tool'), 'Document')

// ── teaching days left (mobile hero) ─────────────────────────────────
// Term open/close parse as LOCAL dates; use local-midnight clocks too.
const TERM = { open: '2026-05-11', close: '2026-08-07', holidays: [] }
const WED_JUL_15 = new Date(2026, 6, 15).getTime()
// Wed 15 Jul → Fri 7 Aug: 3 + 5 + 5 + 5 weekdays
assert.equal(teachingDaysLeft(TERM, WED_JUL_15), 18)
// A weekday holiday inside the window is not a teaching day
assert.equal(
  teachingDaysLeft({ ...TERM, holidays: [{ date: '2026-07-20', name: 'Holiday' }] }, WED_JUL_15),
  17,
)
// A weekend holiday changes nothing
assert.equal(
  teachingDaysLeft({ ...TERM, holidays: [{ date: '2026-07-18', name: 'Sat' }] }, WED_JUL_15),
  18,
)
// From a Saturday, counting starts the following Monday
assert.equal(teachingDaysLeft(TERM, new Date(2026, 6, 18).getTime()), 15)
// Term over → 0; unusable term → null
assert.equal(teachingDaysLeft(TERM, new Date(2026, 7, 10).getTime()), 0)
assert.equal(teachingDaysLeft(null, WED_JUL_15), null)
assert.equal(teachingDaysLeft({}, WED_JUL_15), null)
// Before the term opens, the whole term counts (13 Mon–Fri weeks = 65 days)
assert.equal(teachingDaysLeft(TERM, new Date(2026, 4, 1).getTime()), 65)

// ── term chip ────────────────────────────────────────────────────────
assert.equal(termChipLabel({ termNumber: 2, weekNumber: 10 }, NOW), `${shortDate(NOW)} — Term 2 • Week 10`)
assert.equal(termChipLabel({ termNumber: 2 }, NOW), `${shortDate(NOW)} — Term 2`)
assert.equal(termChipLabel(null, NOW), '')
assert.equal(termChipLabel({}, NOW), '')

// ── AI recommendation chips ──────────────────────────────────────────
// Regression: the chips were re-derived from the teacher's ACTIVE assignment
// rather than read off the card, so a teacher taking more than one subject saw
// a card titled "English is not planned yet" chipped "technology studies" —
// while the card's own button correctly linked to English.
const recs = [
  {
    id: 'scheme-english', title: 'English is not planned yet', text: 'Create a scheme.',
    actionLabel: 'Create Scheme', to: '/teacher/generate/scheme-of-work?grade=G4&subject=english',
    gradeLabel: 'Grade 4', subjectName: 'English',
  },
  {
    id: 'scheme-mathematics', title: 'Mathematics is not planned yet', text: 'Create a scheme.',
    actionLabel: 'Create Scheme', to: '/teacher/generate/scheme-of-work?grade=G6&subject=mathematics',
    gradeLabel: 'Grade 6', subjectName: 'Mathematics',
  },
  // A global card (draft-papers) reads the whole paper list — it has no single
  // grade or subject, so it must carry no chip at all.
  {
    id: 'draft-papers', title: 'Test papers are still drafts', text: 'Review them.',
    actionLabel: 'Review drafts', to: '/teacher/assessment-papers',
  },
  { id: 'overflow', title: 'Never shown', text: '', actionLabel: '', to: '/x' },
]

const cards = recommendationCardsFrom(recs)
assert.equal(cards.length, 3, 'only the top 3 recommendations are shown')
// Each card is chipped with ITS OWN scope…
assert.deepEqual(cards[0].context, { grade: 'Grade 4', subject: 'English' })
// …including the second and third, which the old `i === 0` gate never chipped.
assert.deepEqual(cards[1].context, { grade: 'Grade 6', subject: 'Mathematics' })
// A card with no scope of its own borrows nothing.
assert.equal(cards[2].context, null)
// The CTA the chip sits beside is untouched.
assert.equal(cards[0].to, '/teacher/generate/scheme-of-work?grade=G4&subject=english')
assert.equal(cards[0].actionLabel, 'Create Scheme')
// A partially-scoped card shows only the half it actually knows.
assert.deepEqual(
  recommendationCardsFrom([{ id: 's', title: 't', subjectName: 'English' }])[0].context,
  { grade: null, subject: 'English' },
)
assert.deepEqual(recommendationCardsFrom([]), [])

console.log('dashboardV2Data: all assertions passed')
