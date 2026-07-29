#!/usr/bin/env node
/**
 * Tests for src/utils/classListCore.js — which learners the Class List shows,
 * in what order, on which page, and how much of it is worth mounting.
 * Pure logic; no Firebase, no DOM.
 * Run: npm run test:class-list-core  (also via npm run test:all)
 */

const {
  compareAdmissionNumbers,
  sortLearners,
  learnerMatchesQuery,
  filterLearners,
  learnerIsMissingInfo,
  buildClassListView,
  pageForLearnerNumber,
  windowRange,
  planBulkStatusChange,
  activeLearnerCount,
  repeatedNameCount,
} = await import('../src/utils/classListCore.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail += 1
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

const learner = (i, over = {}) => ({
  id: `l${i}`,
  order: i,
  learnerNumber: String(i),
  admissionNumber: `ADM-${String(i).padStart(3, '0')}`,
  fullName: `Learner ${i}`,
  gender: i % 2 ? 'M' : 'F',
  parentPhone: `097712${String(i).padStart(4, '0')}`,
  status: 'active',
  needsReview: false,
  ...over,
})

const CLASS = [
  learner(1, { fullName: 'Alex Lobela' }),
  learner(2, { fullName: 'Bright Kapaso' }),
  learner(3, { fullName: 'Naomi Chipeta', needsReview: true, admissionNumber: null }),
  learner(4, { fullName: 'Chanda Mulenga' }),
  learner(5, { fullName: 'Ruth Mwila', status: 'transferred' }),
  learner(6, { fullName: 'Kelvin Banda', gender: null }),
]

// ── sorting ──────────────────────────────────────────────────────

console.log('\nsorting')

test('admission numbers sort the way a person reads them', () => {
  const sorted = ['ADM-10', 'ADM-2', 'ADM-1'].sort(compareAdmissionNumbers)
  eq(sorted.join(','), 'ADM-1,ADM-2,ADM-10', 'ADM-2 must come before ADM-10')
})

test('a learner with no admission number sorts last, not interleaved', () => {
  const sorted = ['ADM-3', '', 'ADM-1'].sort(compareAdmissionNumbers)
  eq(sorted.join('|'), 'ADM-1|ADM-3|')
})

test('list order is stable — equal orders break by name', () => {
  const tied = [
    { id: 'a', order: 1, fullName: 'Zulu Samuel' },
    { id: 'b', order: 1, fullName: 'Banda Kelvin' },
  ]
  eq(sortLearners(tied, 'list_order').map((l) => l.id).join(''), 'ba')
  // Sorting the same input again gives the same answer.
  eq(sortLearners(tied, 'list_order').map((l) => l.id).join(''), 'ba')
})

test('name sorts run both ways and never mutate the input', () => {
  const before = CLASS.map((l) => l.id).join(',')
  eq(sortLearners(CLASS, 'name_asc')[0].fullName, 'Alex Lobela')
  eq(sortLearners(CLASS, 'name_desc')[0].fullName, 'Ruth Mwila')
  eq(CLASS.map((l) => l.id).join(','), before, 'sortLearners must not reorder the caller’s array')
})

// ── searching ────────────────────────────────────────────────────

console.log('\nsearching')

test('search matches name, admission number, list number and phone', () => {
  const l = learner(7, { fullName: 'Naomi Chipeta', admissionNumber: 'ADM-024', parentPhone: '0977123456' })
  assert(learnerMatchesQuery(l, 'naomi'))
  assert(learnerMatchesQuery(l, 'chipeta'))
  assert(learnerMatchesQuery(l, 'adm-024'))
  assert(learnerMatchesQuery(l, '7'), 'the list number matches exactly')
  assert(learnerMatchesQuery(l, '123456'))
  assert(!learnerMatchesQuery(l, 'mulenga'))
})

test('search survives surname-first typing and accents', () => {
  const l = learner(8, { fullName: 'Nakazwé Mwape' })
  assert(learnerMatchesQuery(l, 'mwape nakazwe'))
  assert(learnerMatchesQuery(l, 'nakazwe'))
})

test('a blank query matches everyone', () => {
  assert(learnerMatchesQuery(learner(1), ''))
  assert(learnerMatchesQuery(learner(1), '   '))
})

// ── filtering ────────────────────────────────────────────────────

console.log('\nfiltering')

test('filters combine rather than replace each other', () => {
  const rows = filterLearners(CLASS, { statuses: ['active'], needsReview: true })
  eq(rows.length, 1)
  eq(rows[0].fullName, 'Naomi Chipeta')
})

test('status filter respects the retired "inactive" spelling', () => {
  const legacy = [...CLASS, learner(9, { fullName: 'Old Record', status: 'inactive' })]
  eq(filterLearners(legacy, { statuses: ['withdrawn'] }).length, 1)
})

test('missing-information filter finds gaps a teacher must fill', () => {
  assert(learnerIsMissingInfo(learner(1, { admissionNumber: null })))
  assert(learnerIsMissingInfo(learner(1, { gender: null })))
  assert(!learnerIsMissingInfo(learner(1)))
  const rows = filterLearners(CLASS, { missingInfo: true })
  eq(rows.length, 2, 'Naomi (no admission number) and Kelvin (no gender)')
})

test('duplicate filter shows both sides of a pair', () => {
  const withDup = [...CLASS, learner(10, { fullName: 'Chanda M. Mulenga', admissionNumber: null })]
  const rows = filterLearners(withDup, { duplicates: true })
  const names = rows.map((r) => r.fullName).sort()
  eq(names.join('|'), 'Chanda M. Mulenga|Chanda Mulenga')
})

// ── the view ─────────────────────────────────────────────────────

console.log('\nthe view')

test('counts come from the whole roster, not the filtered page', () => {
  const view = buildClassListView(CLASS, { filters: { query: 'alex' }, pageSize: 25 })
  eq(view.rows.length, 1)
  eq(view.counts.total, 6, 'the headline must not change when a filter is applied')
  eq(view.counts.active, 5)
  eq(view.counts.transferred, 1)
  eq(view.counts.needsReview, 1)
})

test('a filter that shrinks the list clamps the page instead of blanking it', () => {
  const view = buildClassListView(CLASS, { filters: { query: 'alex' }, page: 4, pageSize: 2 })
  eq(view.page, 1)
  eq(view.rows.length, 1)
})

test('paging reports an honest range', () => {
  const view = buildClassListView(CLASS, { pageSize: 4, page: 2 })
  eq(view.pageCount, 2)
  eq(view.rangeStart, 5)
  eq(view.rangeEnd, 6)
  eq(view.rows.length, 2)
})

test('"all" shows every learner on one page', () => {
  const view = buildClassListView(CLASS, { pageSize: 'all' })
  eq(view.rows.length, 6)
  eq(view.pageCount, 1)
})

test('an empty class list produces an empty, valid view', () => {
  const view = buildClassListView([], {})
  eq(view.rows.length, 0)
  eq(view.page, 1)
  eq(view.pageCount, 1)
  eq(view.rangeStart, 0)
})

test('a 120-learner class builds in well under a frame budget', () => {
  const big = Array.from({ length: 120 }, (_, i) => learner(i + 1))
  const started = Date.now()
  const view = buildClassListView(big, { sort: 'name_asc', pageSize: 25 })
  const elapsed = Date.now() - started
  eq(view.total, 120)
  eq(view.rows.length, 25)
  assert(elapsed < 500, `120-learner view took ${elapsed}ms`)
})

// ── jump to learner ──────────────────────────────────────────────

console.log('\njump to learner')

test('jump finds the page a printed number lands on', () => {
  const view = buildClassListView(CLASS, { pageSize: 2 })
  const jump = pageForLearnerNumber(view.visible, '5', 2)
  eq(jump.page, 3)
  eq(jump.learner.fullName, 'Ruth Mwila')
})

test('a number nobody carries returns null rather than jumping somewhere', () => {
  const view = buildClassListView(CLASS, { pageSize: 2 })
  eq(pageForLearnerNumber(view.visible, '999', 2), null)
  eq(pageForLearnerNumber(view.visible, '', 2), null)
})

// ── windowing ────────────────────────────────────────────────────

console.log('\nwindowed rendering')

test('only the visible slice plus overscan is mounted', () => {
  const w = windowRange({ total: 120, rowHeight: 56, viewportHeight: 600, scrollTop: 0, overscan: 5 })
  eq(w.startIndex, 0)
  assert(w.endIndex <= 22, `mounted ${w.endIndex} rows of 120`)
  eq(w.paddingTop, 0)
  eq(w.totalHeight, 120 * 56)
})

test('scrolling shifts the window and keeps the total height constant', () => {
  const w = windowRange({ total: 120, rowHeight: 56, viewportHeight: 600, scrollTop: 2800, overscan: 5 })
  eq(w.startIndex, 45)
  eq(w.paddingTop, 45 * 56)
  eq(w.paddingTop + (w.endIndex - w.startIndex) * 56 + w.paddingBottom, 120 * 56,
    'padding + mounted rows must always add up to the full scroll height')
})

test('the window never runs past the end of the list', () => {
  const w = windowRange({ total: 10, rowHeight: 56, viewportHeight: 600, scrollTop: 99999 })
  assert(w.endIndex <= 10)
  eq(w.paddingBottom, 0)
})

test('an empty list windows to nothing', () => {
  const w = windowRange({ total: 0, rowHeight: 56, viewportHeight: 600 })
  eq(w.endIndex, 0)
  eq(w.totalHeight, 0)
})

// ── bulk actions ─────────────────────────────────────────────────

console.log('\nbulk actions')

test('a bulk change reports what it will actually change', () => {
  const plan = planBulkStatusChange(
    [learner(1), learner(2, { status: 'transferred' }), learner(3)],
    'transferred',
  )
  eq(plan.changing.length, 2)
  eq(plan.unchanged.length, 1)
  eq(plan.unchanged[0].reason, 'already_set')
})

// ── headline numbers ─────────────────────────────────────────────

console.log('\nheadline numbers')

test('active count matches what the register expects to mark', () => {
  eq(activeLearnerCount(CLASS), 5)
})

test('repeated names are counted on an exact match a teacher can verify', () => {
  eq(repeatedNameCount(CLASS), 0)
  eq(repeatedNameCount([...CLASS, learner(11, { fullName: 'Alex Lobela' })]), 2)
})

// ── summary ──────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
