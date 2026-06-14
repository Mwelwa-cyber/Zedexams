#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the Class Timetable studio's deterministic core
 * (src/utils/classTimetable.js): period/time construction, capacity,
 * round-robin token spreading, the balanced auto-fill, and the XLSX
 * workbook parts (src/utils/classTimetableToXlsx.js).
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:class-timetable   (also via npm run test:all)
 */
import {
  buildPeriods,
  lessonPeriods,
  lessonCapacity,
  curriculumSubjectsForGrade,
  defaultPeriodsPerWeek,
  recommendedLessonPeriods,
  roundRobinTokens,
  autoFillTimetable,
  validateTimetable,
  totalAllocated,
  filledCount,
  buildTimetableArtifact,
  DEFAULT_DAYS,
} from '../src/utils/classTimetable.js'
import {
  getFrameworkForGrade,
  bandForGrade,
  subjectLoad,
} from '../src/utils/curriculumFramework.js'
import { buildClassTimetableWorkbookFiles } from '../src/utils/classTimetableToXlsx.js'

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
function assert(cond, msg) { if (!cond) throw new Error(msg) }

/* ── buildPeriods ─────────────────────────────────────────────── */

test('buildPeriods computes lesson times and inserts breaks at the right spot', () => {
  const periods = buildPeriods({
    startTime: '07:30',
    periodMinutes: 40,
    lessonPeriods: 4,
    breaks: [{ afterPeriod: 2, minutes: 20, name: 'BREAK' }],
  })
  const lessons = lessonPeriods(periods)
  assert(lessons.length === 4, `expected 4 lesson rows, got ${lessons.length}`)
  assert(periods.length === 5, `expected 5 rows (4 lessons + 1 break), got ${periods.length}`)

  assert(lessons[0].start === '07:30' && lessons[0].end === '08:10', `p1 times wrong: ${lessons[0].start}-${lessons[0].end}`)
  assert(lessons[1].end === '08:50', `p2 end wrong: ${lessons[1].end}`)

  const brk = periods.find((p) => p.kind === 'break')
  assert(brk, 'no break row produced')
  assert(brk.start === '08:50' && brk.end === '09:10', `break times wrong: ${brk.start}-${brk.end}`)
  // The lesson after the break starts when the break ends.
  assert(lessons[2].start === '09:10', `p3 should follow the break: ${lessons[2].start}`)
})

test('buildPeriods honours disabled breaks and clamps the lesson count', () => {
  const periods = buildPeriods({
    lessonPeriods: 3,
    breaks: [{ afterPeriod: 1, minutes: 15, name: 'BREAK', enabled: false }],
  })
  assert(periods.every((p) => p.kind === 'lesson'), 'disabled break should not appear')
  assert(lessonPeriods(periods).length === 3, 'lesson count mismatch')
})

/* ── capacity / curriculum ────────────────────────────────────── */

test('lessonCapacity = lesson rows × teaching days', () => {
  const periods = buildPeriods({ lessonPeriods: 6, breaks: [] })
  assert(lessonCapacity(periods, DEFAULT_DAYS) === 30, 'expected 6×5 = 30')
})

test('curriculumSubjectsForGrade pulls the CBC upper-primary list for G5', () => {
  const subjects = curriculumSubjectsForGrade('G5')
  assert(subjects.length === 8, `expected 8 CBC upper-primary subjects, got ${subjects.length}`)
  assert(subjects.every((s) => s.id && s.label && Number.isFinite(s.periodsPerWeek)),
    'each seeded subject needs id/label/periodsPerWeek')
  const maths = subjects.find((s) => /math/i.test(s.label))
  assert(maths && maths.periodsPerWeek === defaultPeriodsPerWeek(maths.label), 'maths default allocation mismatch')
})

/* ── round robin ──────────────────────────────────────────────── */

test('roundRobinTokens interleaves subjects and preserves counts', () => {
  const tokens = roundRobinTokens([
    { id: 'a', label: 'A', periodsPerWeek: 3 },
    { id: 'b', label: 'B', periodsPerWeek: 2 },
  ])
  assert(tokens.length === 5, `expected 5 tokens, got ${tokens.length}`)
  assert(tokens.map((t) => t.id).join('') === 'ababa', `bad interleave: ${tokens.map((t) => t.id).join('')}`)
})

/* ── auto-fill ────────────────────────────────────────────────── */

const SUBJECTS = [
  { id: 'm', label: 'Mathematics', periodsPerWeek: 5 },
  { id: 'e', label: 'English', periodsPerWeek: 5 },
  { id: 's', label: 'Science', periodsPerWeek: 4 },
  { id: 'o', label: 'Social Studies', periodsPerWeek: 3 },
]

test('autoFill places exactly the allocated number of lessons when under capacity', () => {
  const periods = buildPeriods({ lessonPeriods: 6, breaks: [] }) // 6×5 = 30 slots
  const slots = autoFillTimetable({ subjects: SUBJECTS, days: DEFAULT_DAYS, periods })
  assert(filledCount(slots, periods, DEFAULT_DAYS) === totalAllocated(SUBJECTS),
    `placed ${filledCount(slots, periods, DEFAULT_DAYS)} but allocated ${totalAllocated(SUBJECTS)}`)
})

test('autoFill never puts a subject twice in one day while capacity allows', () => {
  const periods = buildPeriods({ lessonPeriods: 6, breaks: [] })
  const slots = autoFillTimetable({ subjects: SUBJECTS, days: DEFAULT_DAYS, periods })
  for (const day of DEFAULT_DAYS) {
    const seen = new Set()
    for (const p of lessonPeriods(periods)) {
      const subj = slots?.[p.id]?.[day]
      if (!subj) continue
      assert(!seen.has(subj), `subject "${subj}" appears twice on ${day}`)
      seen.add(subj)
    }
  }
})

test('autoFill caps at grid capacity when over-allocated', () => {
  const periods = buildPeriods({ lessonPeriods: 2, breaks: [] }) // 2×5 = 10 slots
  const heavy = [{ id: 'x', label: 'X', periodsPerWeek: 40 }]
  const slots = autoFillTimetable({ subjects: heavy, days: DEFAULT_DAYS, periods })
  assert(filledCount(slots, periods, DEFAULT_DAYS) === 10, 'should fill exactly the 10 available slots')
})

/* ── artifact + xlsx ──────────────────────────────────────────── */

test('buildClassTimetableWorkbookFiles emits a valid single-sheet workbook', () => {
  const periods = buildPeriods({ lessonPeriods: 3, breaks: [{ afterPeriod: 2, minutes: 20, name: 'BREAK' }] })
  const slots = autoFillTimetable({ subjects: SUBJECTS, days: DEFAULT_DAYS, periods })
  const artifact = buildTimetableArtifact({
    header: { school: 'Demo Primary', grade: 'G5', className: 'Grade 5 Blue', term: 1, year: '2026' },
    days: DEFAULT_DAYS,
    periods,
    slots,
  })
  const files = buildClassTimetableWorkbookFiles(artifact)
  assert(files['[Content_Types].xml'], 'missing content types part')
  assert(files['xl/workbook.xml'].includes('Timetable'), 'sheet not named Timetable')
  const sheet = files['xl/worksheets/sheet1.xml']
  assert(sheet.includes('MONDAY') && sheet.includes('FRIDAY'), 'day headers missing')
  assert(sheet.includes('CLASS TIMETABLE'), 'title missing')
  assert(sheet.includes('<mergeCells'), 'expected merged title/break cells')
  assert(sheet.includes('Mathematics'), 'a placed subject should appear in the sheet')
})

/* ── 2023 framework allocations ───────────────────────────────── */

test('bandForGrade maps grades to the framework bands', () => {
  assert(bandForGrade('G2') === 'lower_primary', 'G2 should be lower primary')
  assert(bandForGrade('Grade 5') === 'upper_primary', 'Grade 5 should be upper primary')
  assert(bandForGrade('G9') === null, 'secondary grades have no framework band yet')
})

test('getFrameworkForGrade returns the official upper-primary allocation (42/wk)', () => {
  const fw = getFrameworkForGrade('G5')
  assert(fw, 'expected a framework for G5')
  assert(fw.periodMinutes === 40, `upper primary periods are 40 min, got ${fw.periodMinutes}`)
  assert(fw.totalPeriods === 42, `expected 42 periods/week, got ${fw.totalPeriods}`)
  const maths = fw.subjects.find((s) => s.label === 'Mathematics')
  assert(maths && maths.periodsPerWeek === 6, 'Mathematics should be 6 periods/week')
  const tech = fw.subjects.find((s) => s.label === 'Technology Studies')
  assert(tech && tech.periodsPerWeek === 7, 'Technology Studies should be 7 periods/week')
  // Expressive Arts OR Home Economics — the alternative is seeded at 0.
  const he = fw.subjects.find((s) => s.label === 'Home Economics')
  assert(he && he.periodsPerWeek === 0 && he.choiceGroup === 'practical', 'Home Economics is the seeded-0 choice alternative')
})

test('getFrameworkForGrade returns the lower-primary allocation (42/wk, 30-min)', () => {
  const fw = getFrameworkForGrade('G2')
  assert(fw && fw.periodMinutes === 30, 'lower primary periods are 30 min')
  assert(fw.totalPeriods === 42, `expected 42 periods/week, got ${fw.totalPeriods}`)
  assert(fw.subjects.length === 4, `expected 4 combined learning areas, got ${fw.subjects.length}`)
})

test('curriculumSubjectsForGrade seeds the framework period counts for primary', () => {
  const subjects = curriculumSubjectsForGrade('G5')
  assert(totalAllocated(subjects) === 42, `seeded week should total 42, got ${totalAllocated(subjects)}`)
  assert(subjects.every((s) => s.load), 'every seeded subject carries a cognitive load')
})

test('subjectLoad classifies core academic subjects as heavy', () => {
  assert(subjectLoad('Mathematics') === 'heavy', 'Maths is heavy')
  assert(subjectLoad('Integrated Science') === 'heavy', 'Science is heavy')
  assert(subjectLoad('Expressive Arts') === 'light', 'Expressive Arts is light')
  assert(subjectLoad('Social Studies') === 'medium', 'Social Studies is medium')
})

test('recommendedLessonPeriods right-sizes the grid for the weekly load', () => {
  assert(recommendedLessonPeriods(42, DEFAULT_DAYS) === 9, '42 over 5 days → 9 periods/day')
  assert(recommendedLessonPeriods(42, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) === 7, '42 over 6 days → 7/day')
})

/* ── assembly / closing rows ──────────────────────────────────── */

test('buildPeriods emits assembly before Period 1 and closing after the last lesson', () => {
  const periods = buildPeriods({
    startTime: '07:30',
    periodMinutes: 40,
    lessonPeriods: 3,
    breaks: [
      { afterPeriod: 0, minutes: 15, name: 'ASSEMBLY', event: 'assembly' },
      { afterPeriod: 'end', minutes: 10, name: 'CLOSING', event: 'closing' },
    ],
  })
  assert(periods[0].event === 'assembly' && periods[0].start === '07:30', 'assembly should be the first row, at the start time')
  assert(periods[1].kind === 'lesson' && periods[1].start === '07:45', 'Period 1 starts after the 15-min assembly')
  const last = periods[periods.length - 1]
  assert(last.event === 'closing', 'closing should be the final row')
  assert(lessonPeriods(periods).length === 3, 'still three lesson rows')
})

/* ── balanced distribution ────────────────────────────────────── */

test('autoFill spreads heavy subjects so no day is overloaded', () => {
  const periods = buildPeriods({ lessonPeriods: 9, breaks: [] }) // 9×5 = 45 slots
  const subjects = curriculumSubjectsForGrade('G5')               // 42 framework periods
  const slots = autoFillTimetable({ subjects, days: DEFAULT_DAYS, periods })
  // Count heavy lessons per day; the spread should keep them within the limit.
  for (const day of DEFAULT_DAYS) {
    let heavy = 0
    for (const p of lessonPeriods(periods)) {
      const subj = slots?.[p.id]?.[day]
      if (subj && subjectLoad(subj) === 'heavy') heavy += 1
    }
    assert(heavy <= 4, `${day} carries ${heavy} heavy subjects — should be ≤ 4`)
  }
})

/* ── validation ───────────────────────────────────────────────── */

test('validateTimetable flags a missing subject and counts placements', () => {
  const periods = buildPeriods({ lessonPeriods: 6, breaks: [] })
  const subjects = [
    { id: 'm', label: 'Mathematics', periodsPerWeek: 5, load: 'heavy' },
    { id: 'e', label: 'English', periodsPerWeek: 5, load: 'heavy' },
  ]
  // Place only Mathematics, leave English empty.
  const slots = autoFillTimetable({ subjects: [subjects[0]], days: DEFAULT_DAYS, periods })
  const report = validateTimetable({ slots, subjects, periods, days: DEFAULT_DAYS })
  assert(!report.ok, 'report should not be ok when English is missing')
  assert(report.errors.some((m) => /English/.test(m)), 'English should be flagged missing')
  const maths = report.bySubject.find((r) => r.label === 'Mathematics')
  assert(maths && maths.placed === 5 && maths.status === 'ok', 'Mathematics should be fully placed')
})

test('validateTimetable passes a correctly-allocated week', () => {
  const periods = buildPeriods({ lessonPeriods: 9, breaks: [] })
  const subjects = curriculumSubjectsForGrade('G5')
  const slots = autoFillTimetable({ subjects, days: DEFAULT_DAYS, periods })
  const report = validateTimetable({ slots, subjects, periods, days: DEFAULT_DAYS })
  assert(report.totalPlaced === 42, `expected all 42 framework periods placed, got ${report.totalPlaced}`)
  assert(report.errors.length === 0, `expected no errors, got: ${report.errors.join('; ')}`)
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
